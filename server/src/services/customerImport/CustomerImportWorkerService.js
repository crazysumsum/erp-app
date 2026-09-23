import { randomUUID } from "node:crypto";

import { BaseService } from "../../framework/services/BaseService.js";
import { CustomerImportService } from "../../modules/customer/CustomerImportService.js";
import { CustomerImportStorage } from "./CustomerImportStorage.js";
import { precheckCustomerImportJob } from "./jobs/precheckCustomerImportJob.js";

export class CustomerImportWorkerService extends BaseService {
  static service = Object.freeze({
    name: "job.customerImportWorker", lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "logging", "time"], eager: true
  });

  static jobs = Object.freeze([{
    name: "customer.import.precheck", method: "runPrecheck", intervalMs: 5_000, timeoutMs: 120_000
  }]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler"); this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger; this.time = services.require("time");
    this.leaseOwner = options.instanceId || randomUUID(); this.config = config.customer.import;
    this.importService = this.config ? new CustomerImportService({
      database: this.database, time: this.time, storage: new CustomerImportStorage({ config: this.config })
    }) : null;
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
}
