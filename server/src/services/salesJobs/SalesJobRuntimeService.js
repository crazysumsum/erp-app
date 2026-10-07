import { BaseService } from "../../framework/services/BaseService.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";

export class SalesJobRuntimeService extends BaseService {
  static service = Object.freeze({ name: "salesJobs", lifecycle: "singleton", dependencies: ["mysqldatabase", "time", "logging"], eager: true });
  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.logger = services.require("logging").logger;
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  async expireQuotations(signal) {
    let result;
    try { result = await this.quotation.expire({ signal }); }
    catch (error) { throw new Error("Quotation expiry failed", { cause: error }); }
    await this.logger.info("sales.quotation_expiry_completed", "Quotation expiry batch completed", result);
    return result;
  }
}
