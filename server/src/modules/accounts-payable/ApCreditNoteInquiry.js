import { storedUnits } from "./apCommand.js";
import { apError } from "./apErrors.js";

const HEADER = `c.id, c.credit_note_number, c.status, c.version, c.invoice_id, i.invoice_number, c.supplier_id, c.supplier_code_snapshot,
  c.supplier_name_snapshot, c.currency_code, c.currency_decimal_places, c.supplier_credit_reference,
  CAST(c.supplier_return_id AS CHAR) AS supplier_return_id, DATE_FORMAT(c.credit_date, '%Y-%m-%d') AS credit_date,
  c.total_amount, c.applied_amount, c.refunded_amount, c.available_amount`;
const source = "ap_credit_notes c JOIN ap_invoices i ON i.id = c.invoice_id";
const nullableTime = (value) => value === null ? null : Number(value);

const summary = (row) => ({
  id: Number(row.id), number: row.credit_note_number, status: row.status, version: Number(row.version),
  invoiceId: Number(row.invoice_id), invoiceNumber: row.invoice_number,
  supplierId: Number(row.supplier_id), supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot,
  currencyCode: row.currency_code, currencyDecimalPlaces: Number(row.currency_decimal_places),
  supplierCreditReference: row.supplier_credit_reference, supplierReturnId: row.supplier_return_id, creditDate: row.credit_date,
  totalAmount: row.total_amount, appliedAmount: row.applied_amount, refundedAmount: row.refunded_amount, availableAmount: row.available_amount
});

function allowedActions(row, allocations, canManage) {
  if (!canManage) return [];
  if (row.status === "DRAFT") return ["update", "confirm", "cancel"];
  if (row.status !== "CONFIRMED") return [];
  const canVoid = storedUnits(row.refunded_amount) === 0n &&
    !allocations.some((allocation) => allocation.status === "ACTIVE" && !allocation.isOrigin);
  return [...(storedUnits(row.available_amount) > 0n ? ["allocate"] : []), ...(canVoid ? ["void"] : [])];
}

export class ApCreditNoteInquiry {
  constructor({ database }) {
    this.database = database;
  }

  async list({ query = {} }) {
    const { page = 1, pageSize = 20 } = query, fields = [], values = [];
    for (const [field, column] of [["status", "status"], ["invoiceId", "invoice_id"], ["supplierId", "supplier_id"], ["currencyCode", "currency_code"]]) {
      if (query[field] !== undefined) { fields.push(`c.${column} = ?`); values.push(query[field]); }
    }
    const where = fields.length ? `WHERE ${fields.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ap_credit_notes c ${where}`, values);
    const [rows] = await this.database.query(`SELECT ${HEADER} FROM ${source} ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(summary), total: Number(total), page, pageSize };
  }

  get({ id, claims }) {
    return this.database.withTransaction(async (tx) => {
      const [[row]] = await tx.query(`SELECT ${HEADER}, c.reason, c.notes, c.void_reason,
        c.created_by_label, c.confirmed_by_label, c.voided_by_label, c.created_at, c.confirmed_at, c.voided_at
        FROM ${source} WHERE c.id = ?`, [id]);
      if (!row) throw apError("AP_CREDIT_NOT_FOUND");
      const [lines] = await tx.query(`SELECT id, line_no, invoice_line_id, CAST(supplier_return_line_id AS CHAR) AS supplier_return_line_id,
        CAST(base_quantity AS CHAR) AS base_quantity, amount, description FROM ap_credit_note_lines WHERE credit_note_id = ? ORDER BY line_no`, [id]);
      const [rows] = await tx.query(`SELECT a.id, a.invoice_id, i.invoice_number, a.amount, a.status, a.is_origin,
        a.created_by_label, a.created_at, a.unapplied_by_label, a.unapplied_at FROM ap_credit_applications a
        JOIN ap_invoices i ON i.id = a.invoice_id WHERE a.credit_note_id = ? ORDER BY a.id`, [id]);
      const canManage = claims?.permissions?.includes("ap.credit.mgmt");
      const allocations = rows.map((allocation) => ({
        id: Number(allocation.id), invoiceId: Number(allocation.invoice_id), invoiceNumber: allocation.invoice_number,
        amount: allocation.amount, status: allocation.status, isOrigin: Boolean(Number(allocation.is_origin)),
        createdByLabel: allocation.created_by_label, createdAt: Number(allocation.created_at),
        unappliedByLabel: allocation.unapplied_by_label, unappliedAt: nullableTime(allocation.unapplied_at),
        allowedActions: canManage && row.status === "CONFIRMED" && allocation.status === "ACTIVE" && !Number(allocation.is_origin) ? ["unapply"] : []
      }));
      return {
        ...summary(row), reason: row.reason, notes: row.notes, voidReason: row.void_reason,
        createdByLabel: row.created_by_label, confirmedByLabel: row.confirmed_by_label, voidedByLabel: row.voided_by_label,
        createdAt: Number(row.created_at), confirmedAt: nullableTime(row.confirmed_at), voidedAt: nullableTime(row.voided_at),
        allowedActions: allowedActions(row, allocations, canManage),
        lines: lines.map((line) => ({
          id: Number(line.id), lineNo: Number(line.line_no), invoiceLineId: Number(line.invoice_line_id),
          supplierReturnLineId: line.supplier_return_line_id, baseQuantity: line.base_quantity, amount: line.amount, description: line.description
        })),
        allocations
      };
    }, { isolationLevel: "REPEATABLE READ" });
  }
}
