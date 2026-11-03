import { purchasingError } from "./purchasingErrors.js";
import { localDate } from "./purchasingValidation.js";

const TYPES = new Set(["PO", "GR"]);
const MAX_SEQUENCE = 999999;

/**
 * PO／GR 月度編號（設計 §4.3、§8.1；OPEN-004）。鎖順序 §2.6 第 3 步：operation claim 之後、PO 之前。
 * 號碼喺外層 transaction commit 先算用咗；rollback 嘅號碼可以再派，commit 咗就永遠唔會再派（trigger 擋倒退）。
 */
export class PurchasingSequenceService {
  /** `localDate` 係 APP_TIME_ZONE 嘅 YYYY-MM-DD，由 caller 用 time service 計，唔用 server OS 時區。 */
  async nextNumberInTransaction(connection, { documentType, localDate: date, nowMs }) {
    if (!TYPES.has(documentType) || !Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Invalid Purchasing sequence allocation");
    const yearMonth = localDate(date, "localDate").slice(0, 7).replace("-", "");
    await connection.execute(`INSERT INTO purchasing_document_sequences (document_type, \`year_month\`, updated_at)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE document_type = document_type`, [documentType, yearMonth, nowMs]);
    const [[row]] = await connection.query(`SELECT next_value FROM purchasing_document_sequences
      WHERE document_type = ? AND \`year_month\` = ? FOR UPDATE`, [documentType, yearMonth]);
    const sequenceNo = Number(row?.next_value);
    // 唔會轉 7 位亦唔會重置：撞到上限就停。
    if (!Number.isSafeInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > MAX_SEQUENCE) throw purchasingError("DOCUMENT_SEQUENCE_EXHAUSTED");
    await connection.execute(`UPDATE purchasing_document_sequences SET next_value = next_value + 1, updated_at = ?
      WHERE document_type = ? AND \`year_month\` = ?`, [nowMs, documentType, yearMonth]);
    return { number: `${documentType}-${yearMonth}-${String(sequenceNo).padStart(6, "0")}`, yearMonth, sequenceNo };
  }
}
