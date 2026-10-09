import { createHash } from "node:crypto";

const OPEN = { quotation: new Set(["DRAFT", "ISSUED"]), order: new Set(["DRAFT", "CONFIRMING", "CONFIRMED", "PARTIALLY_FULFILLED"]) };
const HISTORICAL = { quotation: new Set(["EXPIRED", "CONVERTED", "CANCELLED"]), order: new Set(["COMPLETED", "CLOSED", "CANCELLED"]) };

function count(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Sales impact ${field}`);
  return value;
}

export class SalesBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("SalesBusinessMasterImpactChecker requires database");
    this.database = database;
    this.id = "sales";
  }

  async check({ entityType, entityKey } = {}) {
    let column, key;
    if (entityType === "CURRENCY" && typeof entityKey === "string" && /^[A-Z]{3}$/u.test(entityKey)) {
      column = "currency_code"; key = entityKey;
    } else if (entityType === "PAYMENT_TERM" && /^[1-9]\d*$/u.test(String(entityKey)) && Number.isSafeInteger(Number(entityKey))) {
      column = "payment_term_id"; key = Number(entityKey);
    } else throw new TypeError("Sales impact requires a Currency code or positive Payment Term ID");
    const [[tables]] = await this.database.query(
      `SELECT COUNT(*) AS present, COALESCE(SUM(table_name = 'sales_orders_archive'), 0) AS archived
         FROM information_schema.tables WHERE table_schema = DATABASE()
          AND table_name IN ('sales_quotations', 'sales_orders', 'sales_orders_archive')`
    );
    if (Number(tables?.present) === 0) return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:sales" };
    // ponytail: P1 active tables only; Phase 4 must add archive aggregation before installing archive tables.
    if (Number(tables?.present) !== 2 || Number(tables?.archived) !== 0) {
      throw new Error("Sales impact schema is incomplete or requires archive support");
    }
    const [rows] = await this.database.query(
      `SELECT 'quotation' AS document_type, status, COUNT(*) AS reference_count,
              COALESCE(SUM(version), 0) AS version_sum, COALESCE(MAX(updated_at), 0) AS latest_updated_at, COALESCE(MAX(id), 0) AS max_id
         FROM sales_quotations WHERE ${column} = ? GROUP BY status
       UNION ALL
       SELECT 'order', status, COUNT(*), COALESCE(SUM(version), 0), COALESCE(MAX(updated_at), 0), COALESCE(MAX(id), 0)
         FROM sales_orders WHERE ${column} = ? GROUP BY status
       ORDER BY document_type, status`, [key, key]
    );
    let openUseCount = 0, historicalCount = 0;
    const projection = rows.map(row => {
      const references = count(row, "reference_count");
      if (OPEN[row.document_type]?.has(row.status)) openUseCount += references;
      else if (HISTORICAL[row.document_type]?.has(row.status)) historicalCount += references;
      else throw new Error("Unclassified Sales impact status");
      return [row.document_type, row.status, references, count(row, "version_sum"), count(row, "latest_updated_at"), count(row, "max_id")];
    });
    if (!Number.isSafeInteger(openUseCount) || !Number.isSafeInteger(historicalCount)) throw new Error("Sales impact count overflow");
    return { status: "READY", activeDefaultCount: 0, openUseCount, historicalCount,
      watermark: `sales:${entityType}:${key}:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}` };
  }
}
