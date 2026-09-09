import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { BaseService } from "../../framework/services/BaseService.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";

/**
 * 掃描受控 Item media 根目錄，刪除已經超過 grace period、DB 已經沒有任何
 * `item_media` 記錄引用的 orphan 檔案。設計說明見
 * docs/items_management/design_spec.md §7.3、§8.5、§12.1。
 *
 * 存在的理由：DB 刪除同實體檔案 unlink 不能共用一個交易（見
 * ItemMediaService.delete()、deleteItemMediaHandler.js 的說明），失敗時
 * metadata 已經刪走但檔案還在——這件工作負責把那些檔案最終清走。Grace
 * period（`config.item.mediaOrphanGraceMs`）保護的是另一種過渡狀態：剛好在
 * `ItemMediaService.attach()` 的交易 commit 之前、`req.files` 尚未被讀進
 * DB 那極短的窗口，此時磁碟上已經有檔案但 DB 未必已經看得到——不足齡的檔案
 * 一律先跳過，下一輪才重新考慮。
 *
 * scope: "cluster"：media 根目錄是所有實例共用的儲存磁碟區（下載請求可能被
 * 導到任何一個實例，所以檔案本來就不可能是各實例的本機磁碟），跟
 * DeviceBindingPurgeJob 對 cluster scope 的理由一致——每個實例各掃一次只是
 * 重複讀同一個目錄同同一張表，不會產生錯誤結果，但沒有必要。
 *
 * 只掃這一層目錄、不遞迴、不跟隨 symlink：`entry.isFile()`（來自
 * `readdir(..., { withFileTypes: true })`）對 symlink 一律回傳 false，天生
 * 就會跳過它們，不需要另外用 `realpath` 比對。
 */
export class ItemMediaCleanupJob extends BaseService {
  static service = Object.freeze({
    name: "job.itemMediaCleanup",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"],
    eager: true
  });

  static jobs = Object.freeze([
    {
      name: "itemMedia.cleanupOrphans",
      method: "cleanupOrphans",
      scope: "cluster",
      // 每日一次；grace period 才是真正保護正確性的參數，這個頻率只影響
      // orphan 檔案最長留存多久，見 config/item.js 對 mediaOrphanGraceMs 的
      // 說明。
      intervalMs: 86_400_000,
      timeoutMs: 120_000
    }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
    this.mediaDirectory = config.item.mediaDirectory;
    this.graceMs = config.item.mediaOrphanGraceMs;
    this.itemMedia = new ItemMediaService({
      database: services.require("mysqldatabase"),
      logger: this.logger,
      time: this.time,
      imageMaxBytes: config.item.imageMaxBytes,
      attachmentMaxBytes: config.item.attachmentMaxBytes
    });
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async cleanupOrphans(signal) {
    const referenced = await this.#loadReferencedStoredNames(signal);
    const entries = await readdir(this.mediaDirectory, { withFileTypes: true }).catch((error) => {
      // 目錄要到第一次成功上傳先會建立（見 uploadMiddleware.js 的
      // mkdir(..., { recursive: true })），部署初期完全冇上傳過屬正常狀態。
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    });

    const cutoffMs = this.time.nowMs() - this.graceMs;
    let cleaned = 0;
    let failed = 0;

    for (const entry of entries) {
      if (signal?.aborted) {
        break;
      }
      if (!entry.isFile() || referenced.has(entry.name)) {
        continue;
      }

      const filePath = path.join(this.mediaDirectory, entry.name);
      let stats;
      try {
        stats = await lstat(filePath);
      } catch {
        // 掃描期間被其他 process（例如同一輪的另一個 unlink）搬走，忽略。
        continue;
      }

      if (!stats.isFile() || stats.mtimeMs > cutoffMs) {
        continue;
      }

      try {
        await unlink(filePath);
        cleaned += 1;
        void this.logger.info("item.media_orphan_cleaned", "Removed an orphaned media file", {
          fileName: entry.name
        });
      } catch (error) {
        failed += 1;
        void this.logger.error(
          "item.media_delete_failed",
          "Failed to remove an orphaned media file during cleanup",
          {
            fileName: entry.name,
            error: { name: error.name, code: error.code ?? null, message: error.message }
          }
        );
      }
    }

    return { cleaned, failed, referencedCount: referenced.size };
  }

  async #loadReferencedStoredNames(signal) {
    const referenced = new Set();
    let afterId = 0;
    const pageSize = 1000;

    for (;;) {
      if (signal?.aborted) {
        break;
      }

      const page = await this.itemMedia.findStoredNames({ afterId, limit: pageSize });
      if (page.length === 0) {
        break;
      }

      for (const row of page) {
        referenced.add(row.storedName);
        afterId = row.id;
      }

      if (page.length < pageSize) {
        break;
      }
    }

    return referenced;
  }
}
