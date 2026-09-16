import { BaseService } from "../../framework/services/BaseService.js";
import { BusinessMasterLookupProvider } from "./providers/BusinessMasterLookupProvider.js";
import { SupplierBusinessMasterImpactChecker } from "./SupplierBusinessMasterImpactChecker.js";
import { SupplierLookupService } from "./SupplierLookupService.js";

const REQUIRED_CORE_TABLES = Object.freeze([
  "supplier_addresses",
  "supplier_address_purposes",
  "suppliers"
]);

export class SupplierBusinessMasterImpactCheckerService extends BaseService {
  static service = Object.freeze({
    name: "supplierBusinessMasterImpactChecker",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase"],
    eager: true
  });

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.checker = options.checker ?? new SupplierBusinessMasterImpactChecker({
      database: services.require("mysqldatabase")
    });
    this.id = "supplier";
  }

  check(subject) {
    return this.checker.check(subject);
  }
}

export class SupplierCoreProviderService extends SupplierLookupService {
  static service = Object.freeze({
    name: "supplierCoreProvider",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase", "logging", "time", "businessMaster"],
    eager: true
  });

  constructor({ services } = {}) {
    const database = services.require("mysqldatabase");
    const businessMasterService = services.require("businessMaster");
    const businessMaster = new BusinessMasterLookupProvider({
      provider: businessMasterService.provider,
      readiness: businessMasterService.readiness
    });
    super({
      database,
      logger: services.require("logging").logger,
      time: services.require("time"),
      businessMaster
    });
    this.businessMasterLookup = businessMaster;
  }

  async inspectReadiness() {
    const businessMaster = await this.businessMasterLookup.assertReady();
    const [rows] = await this.database.query(
      `SELECT table_name AS table_name
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('suppliers', 'supplier_addresses', 'supplier_address_purposes')
        ORDER BY table_name`
    );
    const tables = rows.map((row) => row.table_name ?? row.TABLE_NAME).sort();
    const schemaReady = JSON.stringify(tables) === JSON.stringify([...REQUIRED_CORE_TABLES].sort());
    return {
      status: schemaReady ? "READY" : "NOT_READY",
      providerContract: SupplierLookupService.contract,
      businessMasterContract: businessMaster.providerContract,
      schemaReady
    };
  }

  async initialize() {
    const readiness = await this.inspectReadiness();
    if (readiness.status !== "READY") {
      throw new Error(`Supplier Core provider readiness failed: ${JSON.stringify(readiness)}`);
    }
  }
}
