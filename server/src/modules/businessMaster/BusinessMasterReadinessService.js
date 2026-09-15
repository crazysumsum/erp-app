import { BusinessMasterProvider } from "./BusinessMasterProvider.js";
import { inspectBusinessMasterSchema } from "../../../database/migrations/0027_create_business_master.js";

const REQUIRED_TABLES = ["business_master_audit_logs", "currencies", "payment_terms"];
const REQUIRED_PERMISSIONS = ["business_master.mgmt", "business_master.view"];

export class BusinessMasterReadinessService {
  constructor({ database, checkerIds = [], schemaInspector = inspectBusinessMasterSchema } = {}) {
    if (!database) throw new TypeError("BusinessMasterReadinessService requires database");
    this.database = database;
    this.checkerIds = [...new Set(checkerIds)].sort();
    this.schemaInspector = schemaInspector;
  }

  async inspect() {
    const [tables] = await this.database.query(
      `SELECT table_name AS table_name FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('currencies', 'payment_terms', 'business_master_audit_logs')
        ORDER BY table_name`
    );
    const [hkdRows] = await this.database.query(
      "SELECT code, decimal_places, status FROM currencies WHERE code = 'HKD'"
    );
    const [permissions] = await this.database.query(
      "SELECT name FROM permissions WHERE name IN ('business_master.view', 'business_master.mgmt') ORDER BY name"
    );
    const [currencyCounts] = await this.database.query(
      "SELECT COUNT(*) AS total FROM currencies WHERE status = 'ACTIVE'"
    );
    const [termCounts] = await this.database.query(
      "SELECT COUNT(*) AS total FROM payment_terms WHERE status = 'ACTIVE'"
    );
    let compatibleTables = new Map();
    try {
      compatibleTables = await this.schemaInspector(this.database);
    } catch {
      compatibleTables = new Map();
    }
    const tableNames = tables.map((row) => row.table_name ?? row.TABLE_NAME).sort();
    const permissionNames = permissions.map((row) => row.name).sort();
    const hkd = hkdRows[0];
    const schemaReady = JSON.stringify(tableNames) === JSON.stringify(REQUIRED_TABLES) &&
      REQUIRED_TABLES.every((tableName) => compatibleTables.has(tableName));
    const hkdReady = hkdRows.length === 1 && hkd.code === "HKD" && Number(hkd.decimal_places) === 2 && hkd.status === "ACTIVE";
    const permissionsReady = JSON.stringify(permissionNames) === JSON.stringify(REQUIRED_PERMISSIONS);
    return {
      status: schemaReady && hkdReady && permissionsReady ? "READY" : "NOT_READY",
      providerContract: BusinessMasterProvider.contract,
      schemaReady,
      hkdReady,
      permissionsReady,
      checkerIds: this.checkerIds,
      activeCurrencyCount: Number(currencyCounts[0].total),
      activePaymentTermCount: Number(termCounts[0].total)
    };
  }
}
