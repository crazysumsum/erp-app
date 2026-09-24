import { randomUUID } from "node:crypto";

import { BaseService } from "../../framework/services/BaseService.js";
import { CustomerImportService } from "../../modules/customer/CustomerImportService.js";
import { CustomerExportService } from "../../modules/customer/CustomerExportService.js";
import { CustomerService } from "../../modules/customer/CustomerService.js";
import { CustomerImportStorage } from "./CustomerImportStorage.js";
import { precheckCustomerImportJob } from "./jobs/precheckCustomerImportJob.js";

export class CustomerImportWorkerService extends BaseService {
  static service = Object.freeze({
    name: "job.customerImportWorker", lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"], eager: true
  });

  static jobs = Object.freeze([{
    name: "customer.import.precheck", method: "runPrecheck", intervalMs: 5_000, timeoutMs: 120_000
  }, {
    name: "customer.import.execute", method: "runExecution", intervalMs: 5_000, timeoutMs: 600_000
  }, {
    name: "customer.import.fileRecovery", method: "runFileRecovery", intervalMs: 300_000, timeoutMs: 120_000
  }]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler"); this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger; this.time = services.require("time");
    this.leaseOwner = options.instanceId || randomUUID(); this.config = config.customer.import;
    const storage = this.config ? new CustomerImportStorage({ config: this.config }) : null;
    this.importService = this.config ? new CustomerImportService({
      database: this.database, time: this.time, storage
    }) : null;
    this.exportService = this.config ? new CustomerExportService({
      database: this.database, time: this.time, storage, maxRows: this.config.maxRows
    }) : null;
    this.customerService = this.config ? new CustomerService({ database: this.database, time: this.time }) : null;
  }

  async initialize() { this.scheduler.register(this); }

  async runPrecheck(signal) {
    if (!this.importService || signal?.aborted) return { claimed: false };
    return precheckCustomerImportJob({
      importService: this.importService, database: this.database, logger: this.logger,
      leaseOwner: this.leaseOwner, leaseDurationMs: 150_000,
      maxRows: this.config.maxRows, maxBytes: this.config.maxFileBytes, rowBatchSize: this.config.rowBatchSize
    });
  }

  async runExecution(signal) {
    if (!this.importService || signal?.aborted) return { claimed: false };
    const leaseDurationMs = 660_000;
    const job = await this.importService.claimForExecution({ leaseOwner: this.leaseOwner, leaseDurationMs });
    if (!job) return { claimed: false };
    let applied = 0; let failed = 0;
    while (!signal?.aborted) {
      const row = await this.importService.processNextRow({
        jobId: job.id, leaseOwner: this.leaseOwner, leaseDurationMs,
        applyRow: (connection, context) => this.customerService.applyImportRowInTransaction(connection, context)
      });
      if (!row) {
        const result = await this.importService.finalizeExecution({ jobId: job.id, leaseOwner: this.leaseOwner });
        return { claimed: true, jobId: job.id, applied, failed, status: result.status };
      }
      if (row.status === "applied") applied += 1; else if (row.status === "failed") failed += 1;
    }
    return { claimed: true, jobId: job.id, applied, failed, status: "running" };
  }

  async runFileRecovery(signal) {
    if (!this.importService || signal?.aborted) return { recovered: 0, failed: 0 };
    const input = { staleBefore: this.time.nowMs() - 300_000, limit: 10 };
    const imported = await this.importService.recoverFiles(input);
    const exported = await this.exportService.recoverFiles(input);
    return { recovered: imported.recovered + exported.recovered, failed: imported.failed + exported.failed };
  }
}
