import { refundError } from "./refundErrors.js";
import { REFUND_KINDS } from "./refundTypes.js";

function summary(row, kind) {
  return {
    id: Number(row.id), number: row.refund_number, status: row.status, version: Number(row.version),
    creditNoteId: Number(row.credit_note_id), creditNoteNumber: row.credit_note_number,
    [kind.partyKey]: Number(row[kind.party]), partyName: row.party_name,
    currencyCode: row.currency_code, currencyDecimalPlaces: Number(row.currency_decimal_places),
    refundDate: row.refund_date, amount: row.amount, paymentMethod: row.payment_method, reference: row.reference
  };
}

function availableActions(row, permitted) {
  if (!permitted) return [];
  if (row.status === "DRAFT") return row.credit_status === "CONFIRMED" ? ["confirm", "cancel"] : ["cancel"];
  return row.status === "CONFIRMED" ? ["void"] : [];
}

export class RefundInquiryService {
  constructor({ database, kind }) {
    this.database = database;
    this.kind = REFUND_KINDS[kind];
  }

  async list({ page = 1, pageSize = 20, creditNoteId, status } = {}) {
    const { refund } = this.kind;
    const clauses = [], parameters = [];
    if (creditNoteId !== undefined) {
      clauses.push("r.credit_note_id = ?");
      parameters.push(creditNoteId);
    }
    if (status !== undefined) {
      clauses.push("r.status = ?");
      parameters.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database.withTransaction(async tx => {
      const [[{ total }]] = await tx.query(`SELECT COUNT(*) AS total FROM ${refund} r ${where}`, parameters);
      const [rows] = await tx.query(`SELECT ${this.#summaryColumns()} ${this.#from()}
        ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...parameters, pageSize, (page - 1) * pageSize]);
      return { items: rows.map(row => summary(row, this.kind)), total: Number(total), page, pageSize };
    }, { isolationLevel: "REPEATABLE READ" });
  }

  async get(id, permissions) {
    const [[row]] = await this.database.query(`SELECT ${this.#summaryColumns()}, r.notes, r.void_reason,
      r.created_by_label, r.confirmed_by_label, r.voided_by_label, r.created_at, r.confirmed_at, r.voided_at,
      c.status AS credit_status ${this.#from()} WHERE r.id = ?`, [id]);
    if (!row) throw refundError("REFUND_NOT_FOUND");
    return {
      ...summary(row, this.kind), notes: row.notes, voidReason: row.void_reason,
      createdByLabel: row.created_by_label, confirmedByLabel: row.confirmed_by_label, voidedByLabel: row.voided_by_label,
      createdAt: Number(row.created_at), confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
      voidedAt: row.voided_at === null ? null : Number(row.voided_at),
      allowedActions: availableActions(row, permissions.includes(this.kind.permission))
    };
  }

  #summaryColumns() {
    const { party } = this.kind;
    return `r.id, r.refund_number, r.status, r.version, r.credit_note_id, r.${party}, r.currency_code, r.amount, r.payment_method, r.reference,
      DATE_FORMAT(r.refund_date, '%Y-%m-%d') AS refund_date, c.credit_note_number, c.currency_decimal_places,
      c.${party.replace("_id", "_name_snapshot")} AS party_name`;
  }

  #from() {
    const { refund, credit } = this.kind;
    return `FROM ${refund} r JOIN ${credit} c ON c.id = r.credit_note_id`;
  }
}
