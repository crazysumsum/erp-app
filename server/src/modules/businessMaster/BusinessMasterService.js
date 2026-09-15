import { BaseService } from "../../framework/services/BaseService.js";
import { BusinessMasterProvider } from "./BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "./BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "./BusinessMasterRepository.js";

const CHECKER_IDS = Object.freeze(["customer", "supplier", "sales", "purchasing", "ar", "ap"]);

export class BusinessMasterService extends BaseService {
  static service = Object.freeze({
    name: "businessMaster",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase", "logging"],
    eager: true
  });

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger;
    const repository = options.repository ?? new BusinessMasterRepository();
    this.provider = options.provider ?? new BusinessMasterProvider({ database: this.database, repository });
    this.readiness = options.readiness ?? new BusinessMasterReadinessService({ database: this.database, checkerIds: CHECKER_IDS });
  }

  async initialize() {
    const readiness = await this.readiness.inspect();
    if (readiness.status !== "READY") {
      throw new Error(`Business Master readiness failed: ${JSON.stringify(readiness)}`);
    }
    await this.logger.info(
      "business_master.readiness.ready",
      "Business Master provider is ready",
      readiness
    );
  }
}
