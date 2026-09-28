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

/**
 * DEF-027（Product Owner 揀 (b)）：開機時點算有幾多行用緊 ring 以外嘅 key，有就記
 * error log 俾監控。**刻意唔阻開機** —— 一行壞資料唔應該拖低成個 ERP；受影響嘅
 * Supplier 喺寫入（SupplierBankService 查重）同 reveal 時各自回 503。
 *
 * 所以呢度乜都唔掟：連檢查本身失敗都只係記低。Bank 未部署（冇 key ring 設定）就
 * 唔查，設計 §1700 講明 PHASE-001／002 唔可以因 Bank 而受阻。Log 只帶數目同種類，
 * 唔帶 key ID —— 要知係邊條 key，operator 用 runbook §2 嗰句 SQL 查。
 */
export class SupplierBankKeyCheckService extends BaseService {
  static service = Object.freeze({
    name: "supplierBankKeyCheck",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase", "logging"],
    eager: true
  });

  async initialize() {
    const { bankEncryption, bankLookup } = this.config?.supplier ?? {};
    if (!bankEncryption || !bankLookup) return;
    const database = this.services.require("mysqldatabase");
    const { logger } = this.services.require("logging");
    try {
      const outside = {};
      for (const [kind, column, ring] of [
        ["encryption", "encryption_key_id", Object.keys(bankEncryption.keyRing)],
        ["lookup", "blind_index_key_id", Object.keys(bankLookup.keyRing)]
      ]) {
        const [[{ n }]] = await database.query(
          `SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE ${column} NOT IN (${ring.map(() => "?").join(", ")})`,
          ring
        );
        outside[kind] = Number(n);
        if (outside[kind] > 0) {
          await logger.error("supplier.bank.keys_outside_ring",
            "Supplier bank rows use a key that is not in the configured ring", { kind, rows: outside[kind] });
        }
      }
      // REV-057 L-4：健康嘅結果都要留一行，否則「冇 error」同「冇行過」睇落一樣。
      await logger.info("supplier.bank.key_check_completed", "Supplier bank key check completed", outside);
    } catch (error) {
      // REV-057 L-3：MySqlDatabaseExecutor 將 driver 錯誤包咗落 cause（同 REV-036 H-1）。
      await logger.error("supplier.bank.key_check_failed",
        "Supplier bank key check could not run", { reason: error?.cause?.code ?? error?.code ?? "unknown" });
    }
  }
}
