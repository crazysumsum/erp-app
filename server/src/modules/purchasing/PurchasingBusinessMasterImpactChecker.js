import { createHash } from "node:crypto";

// Business Master 影響檢查（HD-013）：一個 Currency／Payment Term 被幾多張 PO 引用。冇呢個 checker，
// purchase_orders 一存在 Business Master 嘅預留 checker 就會回 UNKNOWN，fail closed 擋住所有異動。
// 進行中：仲會再改、再審批或者再收貨；歷史：終結狀態。schema 加咗新狀態而呢度未分類就 fail closed。
export const OPEN_PO_STATUSES = Object.freeze(["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "PARTIALLY_RECEIVED"]);
export const HISTORICAL_PO_STATUSES = Object.freeze(["FULLY_RECEIVED", "CLOSED", "CANCELLED"]);
const OPEN = new Set(OPEN_PO_STATUSES), HISTORICAL = new Set(HISTORICAL_PO_STATUSES);

function count(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Purchasing impact ${field}`);
  return value;
}

export class PurchasingBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("PurchasingBusinessMasterImpactChecker requires database");
    this.database = database;
    this.id = "purchasing";
  }

  async check({ entityType, entityKey } = {}) {
    let column, key;
    if (entityType === "CURRENCY" && typeof entityKey === "string" && /^[A-Z]{3}$/u.test(entityKey)) {
      column = "currency_code"; key = entityKey;
    } else if (entityType === "PAYMENT_TERM" && /^[1-9]\d*$/u.test(String(entityKey)) && Number.isSafeInteger(Number(entityKey))) {
      column = "payment_term_id"; key = Number(entityKey);
    } else throw new TypeError("Purchasing impact requires a Currency code or positive Payment Term ID");

    const [[table]] = await this.database.query(
      `SELECT COUNT(*) AS present FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'purchase_orders'`
    );
    if (Number(table?.present) === 0) {
      return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:purchasing" };
    }
    const [rows] = await this.database.query(
      `SELECT status, COUNT(*) AS reference_count, COALESCE(SUM(version), 0) AS version_sum,
              COALESCE(MAX(updated_at), 0) AS latest_updated_at, COALESCE(MAX(id), 0) AS max_id
         FROM purchase_orders WHERE ${column} = ? GROUP BY status ORDER BY status`, [key]
    );
    let openUseCount = 0, historicalCount = 0;
    const projection = rows.map((row) => {
      const references = count(row, "reference_count");
      if (OPEN.has(row.status)) openUseCount += references;
      else if (HISTORICAL.has(row.status)) historicalCount += references;
      else throw new Error("Unclassified Purchasing impact status");
      return [row.status, references, count(row, "version_sum"), count(row, "latest_updated_at"), count(row, "max_id")];
    });
    if (!Number.isSafeInteger(openUseCount) || !Number.isSafeInteger(historicalCount)) throw new Error("Purchasing impact count overflow");
    return { status: "READY", activeDefaultCount: 0, openUseCount, historicalCount,
      watermark: `purchasing:${entityType}:${key}:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}` };
  }
}
