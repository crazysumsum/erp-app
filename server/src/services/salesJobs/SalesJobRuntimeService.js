import { BaseService } from "../../framework/services/BaseService.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { SalesOrderConfirmationService } from "../../modules/sales/SalesOrderConfirmationService.js";

export class SalesJobRuntimeService extends BaseService {
  static service = Object.freeze({ name: "salesJobs", lifecycle: "singleton", dependencies: ["mysqldatabase", "time", "logging"], eager: true });
  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.logger = services.require("logging").logger;
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
    this.confirmation = new SalesOrderConfirmationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger, config: config?.sales });
  }
  async expireQuotations(signal) {
    let result;
    try { result = await this.quotation.expire({ signal }); }
    catch (error) { throw new Error("Quotation expiry failed", { cause: error }); }
    await this.logger.info("sales.quotation_expiry_completed", "Quotation expiry batch completed", result);
    return result;
  }
  async recoverConfirmations(signal) {
    let result;
    try { result = await this.confirmation.recover({ signal }); }
    catch { throw new Error("Sales confirmation recovery failed"); }
    await this.logger.info("sales.confirmation_recovery_completed", "Confirmation recovery batch completed", result);
    if (result.oldestAgeMs > 300000) await this.logger.error("sales.confirmation_recovery_overdue", "Confirmation recovery exceeds five minutes", result);
    if (result.deferred) throw new Error("Sales confirmation recovery incomplete");
    return result;
  }
}
