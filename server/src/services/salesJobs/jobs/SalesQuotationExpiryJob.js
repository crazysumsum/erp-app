import { BaseService } from "../../../framework/services/BaseService.js";

export class SalesQuotationExpiryJob extends BaseService {
  static service = Object.freeze({ name: "job.salesQuotationExpiry", lifecycle: "singleton", dependencies: ["scheduler", "salesJobs"], eager: true });
  static jobs = Object.freeze([{ name: "sales.quotationExpire", method: "run", scope: "cluster", intervalMs: 3600000, timeoutMs: 30000 }]);
  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.scheduler = services.require("scheduler"); this.runtime = services.require("salesJobs");
  }
  async initialize() { this.scheduler.register(this); }
  run(signal) { return this.runtime.expireQuotations(signal); }
}
