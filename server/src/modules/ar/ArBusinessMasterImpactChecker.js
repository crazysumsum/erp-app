import { createHash } from "node:crypto";

// Business Master 影響檢查：一個幣別被多少張 AR 發票及收款引用。沒有這個 checker，ar_invoices 一存在，
// Business Master 的預留 checker 就回 UNKNOWN，fail closed 擋住所有貨幣及付款條款的異動（Purchasing 的 HD-013 同一情況）。
// 進行中：草稿，或已確認而仍有未收額（發票）／仍有可核銷額（收款）；歷史：其餘。出現未分類的狀態即 fail closed。
// 付款條款：AR 只保存條款代碼及名稱的快照，不保存條款 ID，所以沒有引用。
const SOURCES = Object.freeze([["invoice", "ar_invoices", "outstanding_amount"], ["receipt", "ar_receipts", "available_amount"]]);
const HISTORICAL = Object.freeze({ invoice: new Set(["VOID", "CANCELLED"]), receipt: new Set(["VOID", "CANCELLED"]) });

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
      `SELECT COUNT(*) AS present FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN ('ar_invoices', 'ar_receipts')`
    );
    if (Number(table?.present) === 0) {
      return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed:ar" };
    }
    if (Number(table?.present) !== SOURCES.length) throw new Error("AR impact schema is incomplete");
    if (!currency) return { status: "READY", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: `ar:PAYMENT_TERM:${Number(entityKey)}:no-reference` };

    const [rows] = await this.database.query(SOURCES.map(([type, name, unsettled]) =>
      `SELECT '${type}' AS document_type, status, (${unsettled} > 0) AS unsettled, COUNT(*) AS reference_count,
              COALESCE(SUM(version), 0) AS version_sum, COALESCE(MAX(updated_at), 0) AS latest_updated_at, COALESCE(MAX(id), 0) AS max_id
         FROM ${name} WHERE currency_code = ? GROUP BY status, unsettled`).join(" UNION ALL ") + " ORDER BY document_type, status, unsettled", [entityKey, entityKey]);
    let openUseCount = 0, historicalCount = 0;
    const projection = rows.map((row) => {
      const references = count(row, "reference_count"), unsettled = Number(row.unsettled) === 1;
      if (row.status === "DRAFT" || (row.status === "CONFIRMED" && unsettled)) openUseCount += references;
      else if (row.status === "CONFIRMED" || HISTORICAL[row.document_type]?.has(row.status)) historicalCount += references;
      else throw new Error("Unclassified AR impact status");
      return [row.document_type, row.status, unsettled, references, count(row, "version_sum"), count(row, "latest_updated_at"), count(row, "max_id")];
    });
    if (!Number.isSafeInteger(openUseCount) || !Number.isSafeInteger(historicalCount)) throw new Error("AR impact count overflow");
    return { status: "READY", activeDefaultCount: 0, openUseCount, historicalCount,
      watermark: `ar:CURRENCY:${entityKey}:${createHash("sha256").update(JSON.stringify(projection)).digest("hex")}` };
  }
}
