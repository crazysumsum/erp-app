import { BaseService } from "../../framework/services/BaseService.js";
import { CustomerAttachmentRecoveryService } from "../../modules/customer/CustomerAttachmentService.js";
import { ClamdScanner } from "./ClamdScanner.js";
import { CustomerAttachmentStorage } from "./CustomerAttachmentStorage.js";

export class CustomerAttachmentRecoveryJob extends BaseService {
  static service = Object.freeze({
    name: "job.customerAttachmentRecovery",
    lifecycle: "singleton",
    dependencies: ["scheduler", "mysqldatabase", "time", "filetypes"],
    eager: true
  });

  static jobs = Object.freeze([{
    name: "customerAttachment.recover",
    method: "run",
    scope: "cluster",
    intervalMs: 60_000,
    timeoutMs: 30_000
  }]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler");
    const attachment = config.customer.attachment;
    this.graceMs = attachment?.orphanGraceMs ?? 0;
    this.time = services.require("time");
    this.recovery = attachment ? new CustomerAttachmentRecoveryService({
      database: services.require("mysqldatabase"), time: this.time,
      storage: new CustomerAttachmentStorage({
        config: attachment, encryption: config.customer.bankEncryption,
        scanner: new ClamdScanner(attachment.malwareScanner), fileTypes: services.require("filetypes")
      })
    }) : null;
  }

  async initialize() { this.scheduler.register(this); }

  async run(signal) {
    if (!this.recovery || signal?.aborted) return { processed: 0, activated: 0, failed: 0, lastId: 0, stageProcessed: 0, stageCleaned: 0, stageFailed: 0, abandonedOperations: 0 };
    const cutoffMs = this.time.nowMs() - this.graceMs;
    const recovered = await this.recovery.recoverBatch({ batchSize: 100, staleBeforeMs: cutoffMs });
    const stages = await this.recovery.cleanupStaleStages({ cutoffMs, batchSize: 100 });
    const operations = await this.recovery.failAbandonedOperations({ cutoffMs, batchSize: 100 });
    return {
      ...recovered, stageProcessed: stages.processed, stageCleaned: stages.cleaned,
      stageFailed: stages.failed, abandonedOperations: operations.failed
    };
  }
}
