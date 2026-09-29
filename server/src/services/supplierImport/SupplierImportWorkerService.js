import { randomUUID } from "node:crypto";

import { BaseService } from "../../framework/services/BaseService.js";
import { SupplierImportService } from "../../modules/supplier/SupplierImportService.js";
import { prepareSupplierImportRoot, SUPPLIER_IMPORT_JOB_NAMES } from "./supplierImportFiles.js";

const LEASE_MS = 660_000;

/**
 * 將 scheduler 接到 Supplier import 執行（T42；設計 §2 「Worker adapter：不放業務規則」）。
 *
 * - 只領取 `queued` 或 lease 過期嘅 job，按 row_number 逐列做（規則喺 SupplierImportService）。
 * - 收到 abort 或者 service 開始 shutdown，就喺兩列之間停低，唔再領新 job。停低嘅 job 保留
 *   lease，過期之後由下一個 worker 接手續做（resume）。
 * - 未設定 import root 就乜都唔做：import 未部署（HD-039 B）。
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
    { name: SUPPLIER_IMPORT_JOB_NAMES.worker, method: "runExecution", intervalMs: 5_000, timeoutMs: LEASE_MS - 60_000 }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    this.logger = services.require("logging").logger;
    this.root = config?.supplier?.import?.root ?? null;
    this.applyRow = options.applyRow ?? null;
    this.leaseOwner = options.instanceId || randomUUID();
    this.importService = new SupplierImportService({
      database: services.require("mysqldatabase"), time: services.require("time")
    });
    this.stopping = false;
  }

  async initialize() {
    if (this.root) {
      const { customer, item } = this.config ?? {};
      await prepareSupplierImportRoot(this.root, [customer?.import?.root, customer?.attachment?.generalRoot,
        customer?.attachment?.bankSensitiveRoot, customer?.attachment?.tempRoot,
        item?.mediaDirectory, item?.importDirectory]);
    }
    this.scheduler.register(this);
  }

  async shutdown() {
    this.stopping = true;
  }

  #mayWork(signal) {
    return Boolean(this.root && this.applyRow) && !this.stopping && !signal?.aborted;
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
