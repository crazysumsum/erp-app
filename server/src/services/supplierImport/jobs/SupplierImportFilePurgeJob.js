import { BaseService } from "../../../framework/services/BaseService.js";
import { SupplierImportService } from "../../../modules/supplier/SupplierImportService.js";
import {
  listSupplierImportFiles, removeVerifiedSupplierImportFile, SUPPLIER_IMPORT_JOB_NAMES, supplierImportDirectory
} from "../supplierImportFiles.js";

const DAY_MS = 86_400_000;
const BATCH = 200;
// ponytail: 每輪最多處理 50 批（10,000 個 job）；積壓多過呢個就分幾日做完，唔會一輪跑到 timeout。
const MAX_BATCHES = 50;

/**
 * Supplier import 檔案保留期（T48；設計 §12.5；HD-071 B）。每日一次，cluster scope：所有實例共用同一個 root。
 *
 * 1. 到期嘅 job：已執行嘅由完成日起 `fileRetentionDays`；從未確認嘅由上載日起 `unconfirmedRetentionDays`，
 *    順手取消（`SUPPLIER_IMPORT_EXPIRED`，系統稽核）。先喺 DB 記 `files_purged_at`，再刪檔。
 * 2. 冇人用嘅檔：冇任何「`files_purged_at` 未記」嘅 job 指住、而且超過一日冇改過（HD-044／050／053）。
 *    上載寫咗檔但未入 job 就死機、或者之前刪唔到嘅檔，都喺呢度清；所以刪唔到嘅檔下一輪自然會再試。
 *
 * 每次刪之前再驗目錄同檔案（`removeVerifiedSupplierImportFile`，REV-059 L-6）。刪唔到只記 errno 代碼
 * （`supplier.import.purge_failed`）；job、逐列結果同稽核全部保留。
 *
 * Scheduler 唔會保存 job 嘅回傳值（REV-076 M-1），所以有檔刪唔到就喺記低摘要之後拋
 * `SUPPLIER_IMPORT_PURGE_INCOMPLETE`：scheduler 記呢輪做失敗、`consecutiveFailures` 遞增，可以靠佢告警。
 */
export class SupplierImportFilePurgeJob extends BaseService {
  static service = Object.freeze({
    name: "job.supplierImportFilePurge",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time", "job.supplierImportWorker"],
    eager: true
  });

  static jobs = Object.freeze([
    { name: SUPPLIER_IMPORT_JOB_NAMES.purge, method: "purge", scope: "cluster", intervalMs: DAY_MS, timeoutMs: 600_000 }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
    this.worker = services.require("job.supplierImportWorker");
    this.retention = {
      executedDays: config?.supplier?.import?.fileRetentionDays ?? 365,
      unconfirmedDays: config?.supplier?.import?.unconfirmedRetentionDays ?? 30
    };
    this.importService = options.importService
      ?? new SupplierImportService({ database: services.require("mysqldatabase"), time: this.time, logger: this.logger });
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async purge(signal) {
    // Root 由 worker 開機時驗過；未部署 import 就乜都唔做。
    const root = this.worker.preparedRoot;
    if (!root) return { skipped: true };
    const nowMs = this.time.nowMs();
    const directories = {
      source: await supplierImportDirectory(root, "source"),
      result: await supplierImportDirectory(root, "result")
    };
    const counts = { expired: 0, retained: 0, raced: 0, filesDeleted: 0, orphansDeleted: 0, failed: 0 };

    const remove = async (kind, storedName, context, options) => {
      if (!directories[kind]) return "missing";
      try {
        return await removeVerifiedSupplierImportFile(directories[kind], storedName, options);
      } catch (error) {
        counts.failed += 1;
        void this.logger?.error?.("supplier.import.purge_failed", "Supplier import file could not be purged; the next run retries",
          { ...context, kind, code: error?.code ?? null });
        return "failed";
      }
    };

    for (let batch = 0; batch < MAX_BATCHES && !signal?.aborted; batch += 1) {
      const due = await this.importService.purgeCandidates({
        executedBefore: nowMs - this.retention.executedDays * DAY_MS,
        unconfirmedBefore: nowMs - this.retention.unconfirmedDays * DAY_MS,
        limit: BATCH
      });
      if (due.length === 0) break;
      for (const job of due) {
        if (signal?.aborted) break;
        const executed = !["uploaded", "ready", "ready_with_errors"].includes(job.status);
        const files = executed
          ? await this.importService.markExecutedFilesPurged({ id: job.id, nowMs })
          : await this.importService.expireUnconfirmed({ id: job.id, nowMs });
        if (!files) {
          counts.raced += 1;
          continue;
        }
        counts[executed ? "retained" : "expired"] += 1;
        for (const { kind, storedName } of files) {
          if (await remove(kind, storedName, { jobId: job.id }) === "deleted") counts.filesDeleted += 1;
        }
      }
      if (due.length < BATCH) break;
    }

    if (!signal?.aborted) {
      const referenced = await this.importService.referencedStoredNames();
      for (const kind of ["source", "result"]) {
        if (!directories[kind]) continue;
        for (const { storedName } of await listSupplierImportFiles(root, kind)) {
          if (signal?.aborted) break;
          if (referenced.has(storedName)) continue;
          if (await remove(kind, storedName, { storedName }, { notNewerThanMs: nowMs - DAY_MS }) === "deleted") counts.orphansDeleted += 1;
        }
      }
    }

    void this.logger?.info?.("supplier.import.purged", "Supplier import retention run finished", counts);
    if (counts.failed > 0) {
      // 只帶代碼同數字：scheduler 會將 message 寫入 system log 同 fr_job_stats。
      throw Object.assign(new Error(`Supplier import purge left ${counts.failed} file(s) behind`),
        { code: "SUPPLIER_IMPORT_PURGE_INCOMPLETE", counts });
    }
    return counts;
  }
}
