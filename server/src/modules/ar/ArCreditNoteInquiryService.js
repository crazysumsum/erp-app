import { localDate, storedUnits } from "./arCommand.js";
import { arError } from "./arErrors.js";

const SUMMARY = `id, credit_note_number, invoice_id, customer_id, customer_code_snapshot, customer_name_snapshot,
  status, currency_code, currency_decimal_places, DATE_FORMAT(credit_date, '%Y-%m-%d') AS credit_date,
  total_amount, applied_amount, refunded_amount, available_amount, version, created_at, updated_at`;
const nullableNumber = (value) => value == null ? null : Number(value);

function summary(row) {
  return {
    id: Number(row.id), number: row.credit_note_number, invoiceId: Number(row.invoice_id), status: row.status, version: Number(row.version),
    customerId: Number(row.customer_id), customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot,
    currencyCode: row.currency_code, currencyDecimalPlaces: Number(row.currency_decimal_places), creditDate: row.credit_date,
    totalAmount: row.total_amount, appliedAmount: row.applied_amount, refundedAmount: row.refunded_amount, availableAmount: row.available_amount,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

function actions(row, applications, manage) {
  if (!manage) return [];
  if (row.status === "DRAFT") return ["edit", "confirm", "cancel"];
  if (row.status !== "CONFIRMED") return [];
  const hasExternal = applications.some((item) => !item.is_origin && item.status === "ACTIVE");
  const allowed = [];
  if (storedUnits(row.available_amount) > 0n) allowed.push("apply");
  if (!hasExternal && storedUnits(row.refunded_amount) === 0n) allowed.push("void");
  return allowed;
}

export class ArCreditNoteInquiryService {
  constructor({ database }) { this.database = database; }

  async list({ query = {} }) {
    const { page = 1, pageSize = 20 } = query, clauses = [], values = [];
    for (const [field, column] of [["invoiceId", "invoice_id"], ["customerId", "customer_id"], ["currencyCode", "currency_code"], ["status", "status"]]) {
      if (query[field] === undefined) continue;
      clauses.push(`${column} = ?`);
      values.push(query[field]);
    }
    for (const [field, operator] of [["creditDateFrom", ">="], ["creditDateTo", "<="]]) {
      if (query[field] === undefined) continue;
      clauses.push(`credit_date ${operator} ?`);
      values.push(localDate(query[field], field));
    }
    if (query.q) {
      clauses.push("(credit_note_number LIKE ? ESCAPE '!' OR customer_code_snapshot LIKE ? ESCAPE '!' OR customer_name_snapshot LIKE ? ESCAPE '!')");
      values.push(...Array(3).fill(`${query.q.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ar_credit_notes ${where}`, values);
    const [rows] = await this.database.query(`SELECT ${SUMMARY} FROM ar_credit_notes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(summary), total: Number(total), page, pageSize };
  }

  async returnSources(invoiceId) {
    const [rows] = await this.database.query(`
      SELECT r.id AS return_id, DATE_FORMAT(r.return_date, '%Y-%m-%d') AS return_date,
             l.id AS return_line_id, l.line_no, il.id AS invoice_line_id
        FROM ar_invoices i JOIN ar_invoice_lines il ON il.invoice_id = i.id
        JOIN shipment_issue_details d ON d.shipment_line_id = il.shipment_line_id
        JOIN customer_return_lines l ON l.shipment_issue_detail_id = d.id AND l.inventory_movement_id IS NOT NULL
        JOIN customer_returns r ON r.id = l.return_id AND r.customer_id = i.customer_id AND r.status = 'POSTED'
       WHERE i.id = ? AND i.status = 'CONFIRMED' ORDER BY r.id DESC, l.line_no`, [invoiceId]);
    return { items: rows.map((row) => ({ returnId: Number(row.return_id), returnDate: row.return_date,
      returnLineId: Number(row.return_line_id), lineNo: Number(row.line_no), invoiceLineId: Number(row.invoice_line_id) })) };
  }

  async get({ id, claims }) {
    return this.database.withTransaction(async (tx) => {
      const [[row]] = await tx.query(`SELECT ${SUMMARY}, notes, reason, void_reason, customer_return_id,
        created_by_label, confirmed_by_label, confirmed_at, voided_by_label, voided_at,
        (SELECT invoice_number FROM ar_invoices WHERE id = ar_credit_notes.invoice_id) AS invoice_number
        FROM ar_credit_notes WHERE id = ?`, [id]);
      if (!row) throw arError("AR_CREDIT_NOTE_NOT_FOUND");
      const [lines] = await tx.query(`SELECT l.id, l.line_no, l.invoice_line_id, l.customer_return_line_id, l.base_quantity, l.amount, l.description,
        i.sku_code_snapshot, i.sku_name_snapshot, i.base_uom_code_snapshot
        FROM ar_credit_note_lines l LEFT JOIN ar_invoice_lines i ON i.id = l.invoice_line_id WHERE l.credit_note_id = ? ORDER BY l.line_no`, [id]);
      const [applications] = await tx.query(`SELECT a.id, a.invoice_id, a.is_origin, a.amount, a.status,
        a.created_by_label, a.created_at, a.unapplied_by_label, a.unapplied_at, i.invoice_number
        FROM ar_credit_applications a JOIN ar_invoices i ON i.id = a.invoice_id WHERE a.credit_note_id = ? ORDER BY a.id`, [id]);
      const manage = (claims?.permissions ?? []).includes("ar.credit.mgmt");
      return {
        ...summary(row), notes: row.notes, reason: row.reason, voidReason: row.void_reason, invoiceNumber: row.invoice_number,
        customerReturnId: nullableNumber(row.customer_return_id), createdByLabel: row.created_by_label, confirmedByLabel: row.confirmed_by_label,
        confirmedAt: nullableNumber(row.confirmed_at), voidedByLabel: row.voided_by_label, voidedAt: nullableNumber(row.voided_at),
        allowedActions: actions(row, applications, manage),
        lines: lines.map((line) => ({
          id: Number(line.id), lineNo: Number(line.line_no), invoiceLineId: nullableNumber(line.invoice_line_id), customerReturnLineId: nullableNumber(line.customer_return_line_id),
          baseQuantity: line.base_quantity === null ? null : String(line.base_quantity), amount: line.amount, description: line.description,
          skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot, baseUomCode: line.base_uom_code_snapshot
        })),
        applications: applications.map((application) => ({
          id: Number(application.id), invoiceId: Number(application.invoice_id), invoiceNumber: application.invoice_number,
          isOrigin: Boolean(application.is_origin), amount: application.amount, status: application.status,
          createdAt: Number(application.created_at), createdByLabel: application.created_by_label,
          unappliedAt: nullableNumber(application.unapplied_at), unappliedByLabel: application.unapplied_by_label,
          allowedActions: manage && row.status === "CONFIRMED" && application.status === "ACTIVE" && !application.is_origin ? ["unapply"] : []
        }))
      };
    }, { isolationLevel: "REPEATABLE READ" });
  }
}
