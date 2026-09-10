import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { BaseService } from "../../framework/services/BaseService.js";
import { isWithinDirectory } from "../../framework/http/fileResponse.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import { IMPORT_FILE_RETENTION_YEARS, IMPORT_JOB_TERMINAL_STATUSES } from "../../modules/item/itemConstants.js";

/**
 * 清理已經終結、滿 1 年保留期嘅 Import Job 嘅原始／結果檔案。設計說明見
 * docs/items_management/design_spec.md §5.13、§8.6、§12.1。
 *
 * 只刪受控 import root 之內嘅實體檔，`item_import_jobs`／`item_import_rows`／
 * audit 完全唔受影響、永久保留——呢個 job 淨係負責標記 `files_purged_at`。
 *
 * scope: "cluster"：import root 係所有實例共用嘅儲存磁碟區，同
 * `ItemMediaCleanupJob` 對 cluster scope 嘅理由一致。
 *
 * 「未滿一年」由呼叫端（呢個檔）用普通 `Date` UTC 年份運算判斷，唔喺 SQL
 * 度做日期運算——閏年等邊界情況嘅邏輯集中喺一處、用 JS `Date` 一樣計得啱、
 * 亦容易寫單元測試。
 */
export class ItemImportFileCleanupJob extends BaseService {
  static service = Object.freeze({
    name: "job.itemImportFileCleanup",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"],
    eager: true
  });

  static jobs = Object.freeze([
    {
      // 獨立嘅 job 名稱，同 itemImport.validate／itemImport.execute 分開
      // （見 config/scheduler.js 頂部說明：cluster scope 嘅工作唔可以共用
      // lock key）。保留期本身係 1 年，每日執行一次已經足夠，唔使更密。
      name: "itemImport.fileCleanup",
      method: "cleanup",
      scope: "cluster",
      intervalMs: 86_400_000,
      timeoutMs: 120_000
    }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
    this.importDirectory = config.item.importDirectory;
    this.importService = new ItemImportService({
      database: services.require("mysqldatabase"),
      logger: this.logger,
      time: this.time
    });
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async cleanup(signal) {
    const nowMs = this.time.nowMs();
    const candidates = await this.importService.listRetentionCandidateJobs({
      statuses: [...IMPORT_JOB_TERMINAL_STATUSES]
    });

    let purged = 0;
    let notYetDue = 0;
    let failed = 0;
    let racedAway = 0;

    for (const job of candidates) {
      if (signal?.aborted) {
        break;
      }

      const baseMs = job.completedAt ?? job.updatedAt;
      const eligibleAtMs = addUtcYears(baseMs, IMPORT_FILE_RETENTION_YEARS);
      if (nowMs < eligibleAtMs) {
        notYetDue += 1;
        continue;
      }

      const fileNames = [job.fileStoredName, job.resultStoredName].filter(Boolean);
      let allDeleted = true;

      for (const fileName of fileNames) {
        const ok = await this.#deleteControlledFile(fileName);
        if (!ok) {
          allDeleted = false;
        }
      }

      if (!allDeleted) {
        failed += 1;
        continue;
      }

      const marked = await this.importService.markImportFilesPurged({ jobId: job.id, purgedAtMs: nowMs });
      if (marked) {
        purged += 1;
        void this.logger.info("item.import_files_purged", "Purged retention-expired import files", {
          jobId: job.id,
          fileCount: fileNames.length
        });
      } else {
        // 另一個 cluster instance 喺呢一輪之前已經標記咗——檔案可能已經俾
        // 嗰個 instance 刪走，亦可能係呢一輪先俾我哋刪多次（unlink 對已經
        // 唔存在嘅檔案本身就係安全嘅 no-op，見 #deleteControlledFile()）。
        racedAway += 1;
      }
    }

    return { purged, notYetDue, failed, racedAway, candidateCount: candidates.length };
  }

  /**
   * 刪除一個受控 import root 之內、由檔名指定嘅檔案。回 `true`：真係刪咗、
   * 或者本來就已經唔存在（idempotent，安全重跑）；回 `false`：路徑逃出
   * root、唔係普通檔案（例如 symlink）、或者 unlink 本身失敗——呢幾種情況
   * 都要留返個 job 喺下一輪先再試，唔可以標記 `files_purged_at`。
   */
  async #deleteControlledFile(fileName) {
    const root = path.resolve(this.importDirectory);
    const resolved = path.resolve(root, fileName);

    if (!isWithinDirectory(root, resolved)) {
      void this.logger.error(
        "item.import_file_purge_failed",
        "Resolved file path escapes the controlled import root",
        { fileName }
      );
      return false;
    }

    let stats;
    try {
      // lstat（唔係 stat）：symlink 本身嘅 isFile() 一定係 false，唔會被
      // 誤導去跟蹤 symlink 指去邊度先判斷。
      stats = await lstat(resolved);
    } catch (error) {
      if (error.code === "ENOENT") {
        return true;
      }
      void this.logger.error("item.import_file_purge_failed", "Failed to stat a controlled import file", {
        fileName,
        error: { name: error.name, code: error.code ?? null, message: error.message }
      });
      return false;
    }

    if (!stats.isFile()) {
      void this.logger.error(
        "item.import_file_purge_failed",
        "Refusing to delete a non-regular file (e.g. a symlink) in the controlled import root",
        { fileName }
      );
      return false;
    }

    try {
      await unlink(resolved);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        return true;
      }
      void this.logger.error("item.import_file_purge_failed", "Failed to delete a controlled import file", {
        fileName,
        error: { name: error.name, code: error.code ?? null, message: error.message }
      });
      return false;
    }
  }
}

function addUtcYears(epochMs, years) {
  const date = new Date(epochMs);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime();
}
