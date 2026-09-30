import { randomUUID } from "node:crypto";

import { BaseService } from "../../framework/services/BaseService.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { precheckSupplierCsv } from "../../modules/supplier/import/SupplierImportProcessor.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierImportService } from "../../modules/supplier/SupplierImportService.js";
import {
  prepareSupplierImportRoot, readSupplierImportSource, removeSupplierImportFile, SUPPLIER_IMPORT_JOB_NAMES
} from "./supplierImportFiles.js";

const LEASE_MS = 660_000;
const PRECHECK_LEASE_MS = 180_000;
const CATALOG_PAGE_SIZE = 100;
// 讀檔失敗嘅原因 → 對用家嘅訊息。其他錯誤（資料庫、Business Master 未 ready）唔係檔嘅問題，
// 留 lease 過期再做。
const SOURCE_ERRORS = Object.freeze({
  SUPPLIER_IMPORT_SOURCE_UNAVAILABLE: "匯入來源檔案無法讀取，請重新上載",
  SUPPLIER_IMPORT_FILE_TOO_LARGE: "CSV 檔案超過大小上限"
});

/**
 * 將 scheduler 接到 Supplier import 執行（T42；設計 §2 「Worker adapter：不放業務規則」）。
 *
 * - 只領取 `queued` 或 lease 過期嘅 job，按 row_number 逐列做（規則喺 SupplierImportService）。
 * - 收到 abort 或者 service 開始 shutdown，就喺兩列之間停低，唔再領新 job。停低嘅 job 保留
 *   lease，過期之後由下一個 worker 接手續做（resume）。
 * - Precheck（T43）：領取 `uploaded` 或 lease 過期嘅 `validating` job，讀來源檔、逐列預檢、寫 rows。
 * - 未設定 import root 就乜都唔做，開機寫一條 warning：import 未部署，upload 回 503（HD-050）。
 * - 真正寫 Supplier 嘅 `applyRow` 由 T45 接入；未接入之前 worker 唔領取任何 job，免得將
 *   job 領咗又做唔到。
 */
export class SupplierImportWorkerService extends BaseService {
  static service = Object.freeze({
    name: "job.supplierImportWorker",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"],
    eager: true
  });

  static jobs = Object.freeze([
    { name: SUPPLIER_IMPORT_JOB_NAMES.precheck, method: "runPrecheck", intervalMs: 5_000, timeoutMs: PRECHECK_LEASE_MS - 30_000 },
    { name: SUPPLIER_IMPORT_JOB_NAMES.worker, method: "runExecution", intervalMs: 5_000, timeoutMs: LEASE_MS - 60_000 }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.root = config?.supplier?.import?.root ?? null;
    // 開機驗過嘅真實路徑；upload handler 只用呢個（HD-050：null 即係未部署，回 503）。
    this.preparedRoot = null;
    this.limits = { maxFileBytes: config?.supplier?.import?.maxFileBytes, maxRows: config?.supplier?.import?.maxRows };
    this.applyRow = options.applyRow ?? null;
    this.leaseOwner = options.instanceId || randomUUID();
    this.database = services.require("mysqldatabase");
    this.importService = new SupplierImportService({
      database: this.database, time: services.require("time"), logger: this.logger
    });
    this.businessMaster = options.businessMaster ?? new BusinessMasterLookupProvider({
      provider: new BusinessMasterProvider({ database: this.database, repository: new BusinessMasterRepository() }),
      readiness: new BusinessMasterReadinessService({ database: this.database, checkerIds: ["supplier"] })
    });
    this.stopping = false;
  }

  async initialize() {
    if (this.root) {
      const { customer, item } = this.config ?? {};
      // 之後一律用真實路徑：設定嘅 path 可能經過一個之後會被換走嘅 symlink（REV-063 L-10）。
      this.root = await prepareSupplierImportRoot(this.root, [customer?.import?.root, customer?.attachment?.generalRoot,
        customer?.attachment?.bankSensitiveRoot, customer?.attachment?.tempRoot,
        item?.mediaDirectory, item?.importDirectory]);
      this.preparedRoot = this.root;
    } else {
      void this.logger?.warn?.("supplier.import.disabled",
        "SUPPLIER_IMPORT_ROOT is not set: Supplier import is not deployed and upload answers 503");
    }
    this.scheduler.register(this);
  }

  async shutdown() {
    this.stopping = true;
  }

  #mayWork(signal) {
    return Boolean(this.root && this.applyRow) && !this.stopping && !signal?.aborted;
  }

  async runPrecheck(signal) {
    if (!this.root || this.stopping || signal?.aborted) return { claimed: false };
    const job = await this.importService.claimForPrecheck({ leaseOwner: this.leaseOwner, leaseDurationMs: PRECHECK_LEASE_MS });
    if (!job) return { claimed: false };
    if (job.abandoned) {
      await this.#discardSource(job);
      return { claimed: true, jobId: job.id, status: "failed" };
    }
    let outcome;
    try {
      const source = await readSupplierImportSource(this.root, job.sourceStoredName,
        { sha256: job.sourceSha256, maxBytes: this.limits.maxFileBytes });
      await this.businessMaster.assertReady();
      outcome = await precheckSupplierCsv({
        source, mode: job.mode, connection: this.database, catalog: await this.#catalog(),
        maxRows: this.limits.maxRows, maxBytes: this.limits.maxFileBytes, signal,
        onRows: async (rows) => {
          // shutdown 時喺兩批之間停；lease 過期之後由頭再做。
          if (this.stopping) throw Object.assign(new Error("Supplier import precheck stopped for shutdown"), { code: "SUPPLIER_IMPORT_STOPPING" });
          await this.importService.appendPrecheckRows({ jobId: job.id, leaseOwner: this.leaseOwner, leaseDurationMs: PRECHECK_LEASE_MS, rows });
        }
      });
    } catch (error) {
      if (!SOURCE_ERRORS[error?.code]) {
        // 唔記、亦唔拋出原本嘅 message：可能帶 SQL 值或者 CSV 內容，而 scheduler 會將拋出嘅 message
        // 寫入 system log 同 job stats（REV-064 H-1）。只帶 code。次數由 claim 封頂（MAX_PRECHECK_ATTEMPTS）。
        void this.logger?.error?.("supplier.import.precheck_interrupted", "Supplier import precheck stopped and will be retried",
          { jobId: job.id, name: error?.name ?? "Error", code: error?.code ?? null, publicCode: error?.publicCode ?? null });
        throw Object.assign(new Error("Supplier import precheck stopped and will be retried"),
          { code: error?.code ?? null, publicCode: error?.publicCode ?? null });
      }
      outcome = { jobLevelError: { code: error.code, message: SOURCE_ERRORS[error.code] } };
    }
    const summary = await this.importService.completePrecheck({
      jobId: job.id, leaseOwner: this.leaseOwner, jobLevelError: outcome.jobLevelError ?? null
    });
    if (summary.status === "failed") await this.#discardSource(job);
    void this.logger?.info?.("supplier.import.prechecked", "Supplier import precheck finished", {
      jobId: job.id, status: summary.status, errorCode: summary.lastErrorCode || null, total: summary.totalCount,
      valid: summary.validCount, warning: summary.warningCount, invalid: summary.invalidCount
    });
    return { claimed: true, jobId: job.id, status: summary.status };
  }

  /**
   * Precheck 失敗嘅 job 冇結果可以下載，來源檔（可能有個人或者銀行資料）即刻刪（HD-053 A）。job 已經記咗
   * `files_purged_at`；刪唔到就記低，T48 會將呢類檔當冇人用嘅檔清走。
   */
  async #discardSource(job) {
    await removeSupplierImportFile(this.root, "source", job.sourceStoredName).catch((error) => {
      void this.logger?.error?.("supplier.import.source_cleanup_failed", "Supplier import source could not be removed after a failed precheck",
        { jobId: job.id, storedName: job.sourceStoredName, code: error?.code ?? null });
    });
  }

  /** Business Master 啟用中嘅貨幣同付款條款（兩個都係細目錄），逐頁讀晒。 */
  async #catalog() {
    const all = async (list) => {
      const items = [];
      for (let page = 1; ; page += 1) {
        const batch = await list({ page, pageSize: CATALOG_PAGE_SIZE });
        items.push(...batch);
        if (batch.length < CATALOG_PAGE_SIZE) return items;
      }
    };
    const currencies = await all((input) => this.businessMaster.listCurrencies(input));
    const terms = await all((input) => this.businessMaster.listPaymentTerms(input));
    return {
      currencies: new Map(currencies.map((currency) => [currency.code, currency])),
      paymentTerms: new Map(terms.map((term) => [term.code, term]))
    };
  }

  async runExecution(signal) {
    if (!this.#mayWork(signal)) return { claimed: false };
    const job = await this.importService.claimForExecution({ leaseOwner: this.leaseOwner, leaseDurationMs: LEASE_MS });
    if (!job) return { claimed: false };
    void this.logger?.info?.("supplier.import.claimed", "Supplier import claimed for execution",
      { jobId: job.id, resumed: job.resumed });
    let applied = 0;
    let failed = 0;
    while (this.#mayWork(signal)) {
      const row = await this.importService.processNextRow({
        jobId: job.id, leaseOwner: this.leaseOwner, leaseDurationMs: LEASE_MS, applyRow: this.applyRow
      });
      if (!row) {
        const result = await this.importService.finalizeExecution({ jobId: job.id, leaseOwner: this.leaseOwner });
        void this.logger?.info?.("supplier.import.completed", "Supplier import completed",
          { jobId: job.id, status: result.status, applied: result.applied, failed: result.failed, skipped: result.skipped });
        return { claimed: true, jobId: job.id, applied, failed, status: result.status };
      }
      if (row.status === "applied") applied += 1;
      else if (row.status === "failed") failed += 1;
    }
    return { claimed: true, jobId: job.id, applied, failed, status: "running" };
  }
}
