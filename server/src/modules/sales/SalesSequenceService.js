import { DOCUMENT_SEQUENCE_MAX } from "./salesConstants.js";
import { salesError } from "./salesErrors.js";
import { formatDateForFile } from "../../services/time/timeFormat.js";

const PREFIXES = Object.freeze({ QUOTATION: "QT", SALES_ORDER: "SO" });
export class SalesSequenceService {
  constructor({ time }) { this.time = time; }

  async nextNumberInTransaction(connection, { documentType, nowMs }) {
    if (!Object.hasOwn(PREFIXES, documentType) || !Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError("Invalid Sales sequence allocation");
    const period = formatDateForFile(this.time.at(nowMs), "Asia/Hong_Kong").slice(0, 7).replace("-", "");
    await connection.execute(`INSERT INTO sales_document_sequences (document_type, period_key, updated_at)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id`, [documentType, period, nowMs]);
    const [[row]] = await connection.query(`SELECT next_value FROM sales_document_sequences
      WHERE document_type = ? AND period_key = ? FOR UPDATE`, [documentType, period]);
    if (!row || !Number.isSafeInteger(row.next_value) || row.next_value < 1 || row.next_value > DOCUMENT_SEQUENCE_MAX) throw salesError("SALES_SEQUENCE_EXHAUSTED");
    await connection.execute(`UPDATE sales_document_sequences SET next_value = next_value + 1, updated_at = ?
      WHERE document_type = ? AND period_key = ?`, [nowMs, documentType, period]);
    return `${PREFIXES[documentType]}-${period}-${String(row.next_value).padStart(6, "0")}`;
  }
}
