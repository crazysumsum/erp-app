import { BusinessMasterAdminService } from "./BusinessMasterAdminService.js";
import { BusinessMasterAuditLogService } from "./BusinessMasterAuditLogService.js";
import { BusinessMasterImpactRegistry } from "./BusinessMasterImpactRegistry.js";
import { BusinessMasterRepository } from "./BusinessMasterRepository.js";
import { CustomerBusinessMasterImpactChecker } from "../customer/CustomerBusinessMasterImpactChecker.js";

const CONSUMER_TABLES = Object.freeze({
  customer: "customers",
  supplier: "suppliers",
  sales: "sales_orders",
  purchasing: "purchase_orders",
  ar: "ar_invoices",
  ap: "ap_invoices"
});

function readinessChecker(database, id, tableName) {
  return {
    id,
    async check() {
      const [rows] = await database.query(
        `SELECT COUNT(*) AS present
           FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = ?`,
        [tableName]
      );
      if (Number(rows[0]?.present ?? 0) === 0) {
        return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: `not-installed:${tableName}` };
      }
      // Phase 2 consumer adoption replaces this safe boundary with the module's real checker.
      return { status: "UNKNOWN", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: `checker-required:${tableName}` };
    }
  };
}

export function createBusinessMasterAdminService(services) {
  const database = services.require("mysqldatabase");
  const time = services.require("time");
  const logger = services.require("logging").logger;
  const repository = new BusinessMasterRepository();
  const supplierChecker = services.get?.("supplierBusinessMasterImpactChecker");
  const checkers = Object.entries(CONSUMER_TABLES).map(([id, table]) => {
    if (id === "customer") return new CustomerBusinessMasterImpactChecker({ database });
    if (id === "supplier" && supplierChecker) return supplierChecker;
    return readinessChecker(database, id, table);
  });
  const impactRegistry = new BusinessMasterImpactRegistry({ time, checkers, requiredCheckerIds: Object.keys(CONSUMER_TABLES) });
  return new BusinessMasterAdminService({
    database,
    repository,
    audit: new BusinessMasterAuditLogService(),
    impactRegistry,
    time,
    logger
  });
}
