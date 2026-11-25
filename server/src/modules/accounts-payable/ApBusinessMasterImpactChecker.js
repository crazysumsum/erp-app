import { createHash } from "node:crypto";

const DOCUMENTS = [
  ["invoice", "ap_invoices", "outstanding_amount > 0"],
  ["payment", "ap_payments", "available_amount > 0"],
  ["credit", "ap_credit_notes", "available_amount > 0"],
  ["refund", "ap_supplier_refunds", "0"]
];

function count(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid AP impact ${field}`);
  return value;
}

export class ApBusinessMasterImpactChecker {
  constructor({ database } = {}) {
    if (!database || typeof database.query !== "function") throw new TypeError("ApBusinessMasterImpactChecker requires database");
    this.database = database;
    this.id = "ap";
  }

  async check({ entityType, entityKey } = {}) {
    const currency = entityType === "CURRENCY" && typeof entityKey === "string" && /^[A-Z]{3}$/u.test(entityKey);
    if (!currency && !(entityType === "PAYMENT_TERM" && /^[1-9]\d*$/u.test(String(entityKey)) && Number.isSafeInteger(Number(entityKey)))) {
      throw new TypeError("AP impact requires a Currency code or positive Payment Term ID");
    }
    const [[table]] = await this.database.query(
      `SELECT COUNT(*) AS present FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN (${DOCUMENTS.map(() => "?").join(", ")})`,
      DOCUMENTS.map(([, tableName]) => tableName)
    );
    if (Number(table?.present) === 0) {
      return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:ap" };
    }
    if (Number(table?.present) !== DOCUMENTS.length) throw new Error("AP impact schema is incomplete");
    // AP 發票只保存付款條款代碼及名稱快照，沒有現行條款的引用。
    if (!currency) {
      return { status: "READY", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0,
        watermark: `ap:PAYMENT_TERM:${Number(entityKey)}:no-reference` };
    }

    const [rows] = await this.database.query(DOCUMENTS.map(([type, tableName, unsettled]) =>
      `SELECT '${type}' AS document_type, status, (${unsettled}) AS unsettled, COUNT(*) AS reference_count,
              COALESCE(SUM(version), 0) AS version_sum, COALESCE(MAX(updated_at), 0) AS latest_updated_at, COALESCE(MAX(id), 0) AS max_id
         FROM ${tableName} WHERE currency_code = ? GROUP BY status, unsettled`).join(" UNION ALL ") +
      " ORDER BY document_type, status, unsettled", DOCUMENTS.map(() => entityKey));
    let openUseCount = 0, historicalCount = 0;
    const projection = rows.map((row) => {
      const references = count(row, "reference_count"), unsettled = Number(row.unsettled) === 1;
      if (row.status === "DRAFT" || (row.status === "CONFIRMED" && unsettled)) openUseCount += references;
      else if (["CONFIRMED", "VOID", "CANCELLED"].includes(row.status)) historicalCount += references;
      else throw new Error("Unclassified AP impact status");
      return [row.document_type, row.status, unsettled, references, count(row, "version_sum"), count(row, "latest_updated_at"), count(row, "max_id")];
    });
    if (!Number.isSafeInteger(openUseCount) || !Number.isSafeInteger(historicalCount)) throw new Error("AP impact count overflow");
    return { status: "READY", activeDefaultCount: 0, openUseCount, historicalCount,
      watermark: `ap:CURRENCY:${entityKey}:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}` };
  }
}
