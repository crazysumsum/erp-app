import { createHash } from "node:crypto";

// 草稿和已確認但仍有可用金額的單據屬進行中。退款只有草稿算進行中。
const BASE_SOURCES = [["invoice", "ar_invoices", "outstanding_amount > 0"], ["receipt", "ar_receipts", "available_amount > 0"]];
const CREDIT_SOURCES = [["credit_note", "ar_credit_notes", "available_amount > 0"], ["refund", "ar_refunds", "0"]];
const HISTORICAL = new Set(["CONFIRMED", "VOID", "CANCELLED"]);

function count(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid AR impact ${field}`);
  return value;
}

export class ArBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("ArBusinessMasterImpactChecker requires database");
    this.database = database;
    this.id = "ar";
  }

  async check({ entityType, entityKey } = {}) {
    const currency = entityType === "CURRENCY" && typeof entityKey === "string" && /^[A-Z]{3}$/u.test(entityKey);
    if (!currency && !(entityType === "PAYMENT_TERM" && /^[1-9]\d*$/u.test(String(entityKey)) && Number.isSafeInteger(Number(entityKey)))) {
      throw new TypeError("AR impact requires a Currency code or positive Payment Term ID");
    }
    const [[table]] = await this.database.query(
      `SELECT COALESCE(SUM(table_name IN ('ar_invoices', 'ar_receipts')), 0) AS present,
              COALESCE(SUM(table_name IN ('ar_credit_notes', 'ar_refunds')), 0) AS credit_present
         FROM information_schema.tables WHERE table_schema = DATABASE()`
    );
    const present = Number(table?.present), creditPresent = Number(table?.credit_present);
    if (present === 0 && creditPresent === 0) {
      return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:ar" };
    }
    if (present !== BASE_SOURCES.length || (creditPresent !== 0 && creditPresent !== CREDIT_SOURCES.length)) {
      throw new Error("AR impact schema is incomplete");
    }
    if (!currency) return { status: "READY", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: `ar:PAYMENT_TERM:${Number(entityKey)}:no-reference` };

    const sources = creditPresent ? [...BASE_SOURCES, ...CREDIT_SOURCES] : BASE_SOURCES;
    const [rows] = await this.database.query(sources.map(([type, name, unsettled]) =>
      `SELECT '${type}' AS document_type, status, (${unsettled}) AS unsettled, COUNT(*) AS reference_count,
              COALESCE(SUM(version), 0) AS version_sum, COALESCE(MAX(updated_at), 0) AS latest_updated_at, COALESCE(MAX(id), 0) AS max_id
         FROM ${name} WHERE currency_code = ? GROUP BY status, unsettled`).join(" UNION ALL ") + " ORDER BY document_type, status, unsettled",
    sources.map(() => entityKey));
    let openUseCount = 0, historicalCount = 0;
    const projection = rows.map((row) => {
      const references = count(row, "reference_count"), unsettled = Number(row.unsettled) === 1;
      if (row.status === "DRAFT" || (row.status === "CONFIRMED" && unsettled)) openUseCount += references;
      else if (HISTORICAL.has(row.status)) historicalCount += references;
      else throw new Error("Unclassified AR impact status");
      return [row.document_type, row.status, unsettled, references, count(row, "version_sum"), count(row, "latest_updated_at"), count(row, "max_id")];
    });
    if (!Number.isSafeInteger(openUseCount) || !Number.isSafeInteger(historicalCount)) throw new Error("AR impact count overflow");
    return { status: "READY", activeDefaultCount: 0, openUseCount, historicalCount,
      watermark: `ar:CURRENCY:${entityKey}:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}` };
  }
}
