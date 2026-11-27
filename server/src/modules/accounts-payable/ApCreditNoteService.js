import { amountUnits, eventId, formatUnits, nextDocumentNumber, onlyFields, positiveId, reason, storedUnits } from "./apCommand.js";
import { creditDraftFields, creditLineCaps, validateCreditAmounts } from "./apCreditDraft.js";
import { lockCreditNote } from "./apCreditFunds.js";
import { apError } from "./apErrors.js";

const PERMISSION = "ap.credit.mgmt";
const DRAFT_FIELDS = ["creditDate", "reason", "supplierCreditReference", "supplierReturnId", "notes", "lines"];
const MAX_VERSION = 4294967295;

async function lockInvoice(tx, id) {
  const [[invoice]] = await tx.query(`SELECT id, status, supplier_id, supplier_code_snapshot, supplier_name_snapshot,
    currency_code, currency_decimal_places, total_amount, allocated_amount, outstanding_amount
    FROM ap_invoices WHERE id = ? FOR UPDATE`, [id]);
  if (!invoice) throw apError("AP_INVOICE_NOT_FOUND");
  if (invoice.status !== "CONFIRMED") throw apError("AP_STATE_CONFLICT");
  return invoice;
}

async function assertReturnSource(tx, supplierReturnId, lines, source, supplierId) {
  const mismatch = (field) => apError("AP_CREDIT_RETURN_MISMATCH", { field });
  if (supplierReturnId === null) {
    if (lines.some((line) => line.supplierReturnLineId !== null)) throw mismatch("supplierReturnId");
    return;
  }
  const [[returned]] = await tx.query(`SELECT CAST(goods_receipt_id AS CHAR) AS receipt_id
    FROM supplier_returns WHERE id = CAST(? AS UNSIGNED) AND supplier_id = ? AND status = 'POSTED'`, [supplierReturnId, supplierId]);
  if (!returned || !source.some((line) => line.receipt_id === returned.receipt_id)) throw mismatch("supplierReturnId");
  if (!lines.some((line) => line.supplierReturnLineId !== null)) return;

  const [rows] = await tx.query(`SELECT CAST(l.id AS CHAR) AS return_line_id, CAST(d.goods_receipt_line_id AS CHAR) AS receipt_line_id
    FROM supplier_return_lines l JOIN goods_receipt_details d
      ON d.id = l.goods_receipt_detail_id AND d.goods_receipt_id = l.goods_receipt_id
    WHERE l.return_id = CAST(? AS UNSIGNED) AND l.inventory_movement_id IS NOT NULL`, [supplierReturnId]);
  const returnLines = new Map(rows.map((row) => [row.return_line_id, row.receipt_line_id]));
  const receiptLines = new Map(source.map((line) => [Number(line.id), line.receipt_line_id]));
  for (const [index, line] of lines.entries()) {
    if (line.supplierReturnLineId !== null &&
        (!returnLines.has(line.supplierReturnLineId) || returnLines.get(line.supplierReturnLineId) !== receiptLines.get(line.invoiceLineId))) {
      throw mismatch(`lines.${index}.supplierReturnLineId`);
    }
  }
}

async function validateAgainstInvoice(tx, invoice, lines, supplierReturnId) {
  // Confirmations for one original invoice serialize on its header. Other credit headers are read without locking.
  const [source] = await tx.query(`SELECT id, line_no, line_amount, CAST(goods_receipt_id AS CHAR) AS receipt_id,
    CAST(goods_receipt_line_id AS CHAR) AS receipt_line_id FROM ap_invoice_lines WHERE invoice_id = ?`, [invoice.id]);
  const [used] = await tx.query(`SELECT l.invoice_line_id, SUM(l.amount) AS amount
    FROM ap_credit_notes c JOIN ap_credit_note_lines l ON l.credit_note_id = c.id
    WHERE c.invoice_id = ? AND c.status = 'CONFIRMED' GROUP BY l.invoice_line_id`, [invoice.id]);
  const [[creditSum]] = await tx.query(`SELECT COALESCE(SUM(total_amount), 0) AS amount
    FROM ap_credit_notes WHERE invoice_id = ? AND status = 'CONFIRMED'`, [invoice.id]);
  const decimals = Number(invoice.currency_decimal_places);
  const caps = creditLineCaps(source, invoice.total_amount, decimals);
  const total = validateCreditAmounts(lines, caps, new Map(used.map((row) => [Number(row.invoice_line_id), storedUnits(row.amount)])),
    storedUnits(invoice.total_amount), storedUnits(creditSum.amount), decimals);
  await assertReturnSource(tx, supplierReturnId, lines, source, invoice.supplier_id);
  return total;
}

function draftColumns(fields, total) {
  return { credit_date: fields.creditDate, reason: fields.reason, supplier_credit_reference: fields.supplierCreditReference,
    supplier_return_id: fields.supplierReturnId, total_amount: total, available_amount: total, notes: fields.notes };
}

function insertLines(tx, id, invoiceId, lines) {
  return tx.query(`INSERT INTO ap_credit_note_lines
    (credit_note_id, invoice_id, line_no, invoice_line_id, supplier_return_line_id, base_quantity, amount, description) VALUES ?`,
  [lines.map((line, index) => [id, invoiceId, index + 1, line.invoiceLineId, line.supplierReturnLineId, line.baseQuantity, line.amount, line.description])]);
}

function moveInvoiceBalance(tx, invoice, amount, nowMs) {
  return tx.execute(`UPDATE ap_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    [formatUnits(storedUnits(invoice.allocated_amount) + amount), formatUnits(storedUnits(invoice.outstanding_amount) - amount), nowMs, invoice.id]);
}

async function applyToInvoice(tx, credit, invoice, amount, { actor, nowMs }, isOrigin = false) {
  await moveInvoiceBalance(tx, invoice, amount, nowMs);
  const [result] = await tx.query("INSERT INTO ap_credit_applications SET ?", [{
    credit_note_id: credit.id, invoice_id: invoice.id, is_origin: Number(isOrigin),
    amount: formatUnits(amount), created_by: actor.id, created_by_label: actor.username, created_at: nowMs
  }]);
  return Number(result.insertId);
}

function undoApplication(tx, application, { actor, nowMs }) {
  return tx.execute(`UPDATE ap_credit_applications SET status = 'UNAPPLIED', unapplied_by = ?,
    unapplied_by_label = ?, unapplied_at = ? WHERE id = ?`, [actor.id, actor.username, nowMs, application.id]);
}

function commandResult(credit, action, { allocationId, invoiceId, reason: why } = {}) {
  const summary = {
    id: Number(credit.id), number: credit.credit_note_number ?? null, status: credit.status, version: Number(credit.version),
    totalAmount: credit.total_amount, appliedAmount: credit.applied_amount, refundedAmount: credit.refunded_amount, availableAmount: credit.available_amount,
    ...(allocationId ? { allocationId } : {})
  };
  return {
    summary,
    audit: {
      action: `creditNote.${action}`, targetType: allocationId ? "CREDIT_APPLICATION" : "CREDIT_NOTE",
      targetId: allocationId ?? summary.id, supplierId: Number(credit.supplier_id), label: summary.number ?? "", reason: why,
      detail: { creditNoteId: summary.id, version: summary.version, status: summary.status, totalAmount: summary.totalAmount,
        appliedAmount: summary.appliedAmount, availableAmount: summary.availableAmount, ...(invoiceId ? { invoiceId: Number(invoiceId) } : {}) }
    }
  };
}

export class ApCreditNoteService {
  constructor({ commands, time }) {
    Object.assign(this, { commands, time });
  }

  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", "invoiceId", ...DRAFT_FIELDS]);
    const invoiceId = positiveId(body.invoiceId, "invoiceId");
    const fields = creditDraftFields(body);
    return this.commands.run({ claims, permission: PERMISSION, commandType: "CREATE_CREDIT_NOTE", targetType: "CREDIT_NOTE",
      eventId: eventId(body.eventId), payload: { invoiceId, ...fields }, context }, async (tx, { actor, nowMs }) => {
      const invoice = await lockInvoice(tx, invoiceId);
      const total = await validateAgainstInvoice(tx, invoice, fields.lines, fields.supplierReturnId);
      const values = {
        ...draftColumns(fields, total), invoice_id: invoiceId, supplier_id: invoice.supplier_id,
        supplier_code_snapshot: invoice.supplier_code_snapshot, supplier_name_snapshot: invoice.supplier_name_snapshot,
        currency_code: invoice.currency_code, currency_decimal_places: invoice.currency_decimal_places,
        created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
      };
      const [result] = await tx.query("INSERT INTO ap_credit_notes SET ?", [values]);
      const id = Number(result.insertId);
      await insertLines(tx, id, invoiceId, fields.lines);
      return commandResult({ ...values, id, status: "DRAFT", version: 1, applied_amount: "0.0000", refunded_amount: "0.0000" }, "created");
    });
  }

  update(command) {
    const body = onlyFields(command.input, ["eventId", "version", ...DRAFT_FIELDS]);
    const fields = creditDraftFields(body);
    return this.#run(command, "UPDATE_CREDIT_NOTE", "DRAFT", fields, async (tx, credit) => {
      const invoice = await lockInvoice(tx, credit.invoice_id);
      const total = await validateAgainstInvoice(tx, invoice, fields.lines, fields.supplierReturnId);
      await tx.execute("DELETE FROM ap_credit_note_lines WHERE credit_note_id = ?", [credit.id]);
      await insertLines(tx, credit.id, credit.invoice_id, fields.lines);
      return { changes: draftColumns(fields, total), action: "updated" };
    });
  }

  confirm(command) {
    onlyFields(command.input, ["eventId", "version"]);
    return this.#run(command, "CONFIRM_CREDIT_NOTE", "DRAFT", {}, async (tx, credit, facts) => {
      const invoice = await lockInvoice(tx, credit.invoice_id);
      const [stored] = await tx.query(`SELECT invoice_line_id, amount, CAST(supplier_return_line_id AS CHAR) AS supplier_return_line_id
        FROM ap_credit_note_lines WHERE credit_note_id = ? ORDER BY line_no`, [credit.id]);
      const lines = stored.map((row) => ({ invoiceLineId: Number(row.invoice_line_id), amount: row.amount, supplierReturnLineId: row.supplier_return_line_id }));
      const total = await validateAgainstInvoice(tx, invoice, lines, credit.supplier_return_id_text);
      if (total !== credit.total_amount) throw apError("AP_STATE_CONFLICT");
      const outstanding = storedUnits(invoice.outstanding_amount), amount = storedUnits(total);
      const applied = outstanding < amount ? outstanding : amount;
      if (applied > 0n) await applyToInvoice(tx, credit, invoice, applied, facts, true);
      const { actor, nowMs } = facts;
      const number = await nextDocumentNumber(tx, { documentType: "CREDIT_NOTE", time: this.time, nowMs });
      return { action: "confirmed", changes: {
        status: "CONFIRMED", credit_note_number: number, applied_amount: formatUnits(applied), available_amount: formatUnits(amount - applied),
        confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs
      } };
    });
  }

  cancel(command) {
    onlyFields(command.input, ["eventId", "version"]);
    return this.#run(command, "CANCEL_CREDIT_NOTE", "DRAFT", {}, () => ({ action: "cancelled", changes: { status: "CANCELLED" } }));
  }

  void(command) {
    const body = onlyFields(command.input, ["eventId", "version", "reason"]);
    const why = reason(body.reason);
    return this.#run(command, "VOID_CREDIT_NOTE", "CONFIRMED", { reason: why }, async (tx, credit, facts) => {
      if (storedUnits(credit.refunded_amount) > 0n) throw apError("AP_CREDIT_HAS_ACTIVITY");
      const invoice = await lockInvoice(tx, credit.invoice_id);
      const [active] = await tx.query(`SELECT id, amount, is_origin FROM ap_credit_applications
        WHERE credit_note_id = ? AND status = 'ACTIVE' ORDER BY id FOR UPDATE`, [credit.id]);
      if (active.some((entry) => !Number(entry.is_origin))) throw apError("AP_CREDIT_HAS_ACTIVITY");
      const [origin] = active;
      const amount = origin ? storedUnits(origin.amount) : 0n;
      if (active.length > 1 || amount !== storedUnits(credit.applied_amount)) throw apError("AP_STATE_CONFLICT");
      if (origin) {
        await moveInvoiceBalance(tx, invoice, -amount, facts.nowMs);
        await undoApplication(tx, origin, facts);
      }
      return { action: "voided", audit: { reason: why }, changes: {
        status: "VOID", applied_amount: "0.0000", refunded_amount: "0.0000", available_amount: "0.0000", void_reason: why,
        voided_by: facts.actor.id, voided_by_label: facts.actor.username, voided_at: facts.nowMs
      } };
    });
  }

  allocate(command) {
    const body = onlyFields(command.input, ["eventId", "version", "invoiceId", "amount"]);
    const invoiceId = positiveId(body.invoiceId, "invoiceId");
    const amount = formatUnits(amountUnits(body.amount, "amount"));
    return this.#run(command, "ALLOCATE_CREDIT_NOTE", "CONFIRMED", { invoiceId, amount }, async (tx, credit, facts) => {
      if (Number(credit.invoice_id) === invoiceId) throw apError("AP_CREDIT_ORIGIN_ALLOCATION");
      const invoice = await lockInvoice(tx, invoiceId);
      if (String(invoice.supplier_id) !== String(credit.supplier_id) || invoice.currency_code !== credit.currency_code) {
        throw apError("AP_CREDIT_PARTY_MISMATCH", { field: "invoiceId" });
      }
      const units = amountUnits(amount, "amount", Number(credit.currency_decimal_places));
      if (units <= 0n) throw apError("AP_INPUT_INVALID", { field: "amount" });
      if (units > storedUnits(invoice.outstanding_amount)) throw apError("AP_ALLOCATION_EXCEEDS_OUTSTANDING");
      if (units > storedUnits(credit.available_amount)) throw apError("AP_CREDIT_EXCEEDS_AVAILABLE");
      const allocationId = await applyToInvoice(tx, credit, invoice, units, facts);
      return { action: "allocated", audit: { allocationId, invoiceId }, changes: {
        applied_amount: formatUnits(storedUnits(credit.applied_amount) + units),
        available_amount: formatUnits(storedUnits(credit.available_amount) - units)
      } };
    });
  }

  unapply(command) {
    onlyFields(command.input, ["eventId", "version"]);
    const allocationId = positiveId(command.allocationId, "allocationId");
    return this.#run(command, "UNAPPLY_CREDIT_ALLOCATION", "CONFIRMED", { allocationId }, async (tx, credit, facts) => {
      // The credit header lock protects this lookup. The subsequent write locks the application after the invoice.
      const [[application]] = await tx.query(`SELECT id, invoice_id, amount, status, is_origin
        FROM ap_credit_applications WHERE id = ? AND credit_note_id = ?`, [allocationId, credit.id]);
      if (!application) throw apError("AP_ALLOCATION_NOT_FOUND");
      if (application.status !== "ACTIVE") throw apError("AP_STATE_CONFLICT");
      if (Number(application.is_origin)) throw apError("AP_CREDIT_ORIGIN_ALLOCATION");
      const invoice = await lockInvoice(tx, application.invoice_id), amount = storedUnits(application.amount);
      await moveInvoiceBalance(tx, invoice, -amount, facts.nowMs);
      await undoApplication(tx, application, facts);
      return { action: "unapplied", audit: { allocationId, invoiceId: invoice.id }, changes: {
        applied_amount: formatUnits(storedUnits(credit.applied_amount) - amount),
        available_amount: formatUnits(storedUnits(credit.available_amount) + amount)
      } };
    });
  }

  #run({ claims, creditNoteId, input, context }, commandType, status, fields, work) {
    const id = positiveId(creditNoteId, "creditNoteId"), version = positiveId(input.version, "version");
    if (version >= MAX_VERSION) throw apError("AP_INPUT_INVALID", { field: "version" });
    return this.commands.run({ claims, permission: PERMISSION, commandType, targetType: "CREDIT_NOTE", targetId: id,
      eventId: eventId(input.eventId), payload: { ...fields, version }, context }, async (tx, facts) => {
      const credit = await lockCreditNote(tx, id);
      if (!credit) throw apError("AP_CREDIT_NOT_FOUND");
      if (Number(credit.version) !== version) throw apError("VERSION_CONFLICT", { currentVersion: Number(credit.version) });
      if (credit.status !== status) throw apError("AP_STATE_CONFLICT");
      const result = await work(tx, credit, facts);
      const changes = { ...result.changes, version: version + 1, updated_at: facts.nowMs };
      await tx.query("UPDATE ap_credit_notes SET ? WHERE id = ?", [changes, id]);
      return commandResult({ ...credit, ...changes }, result.action, result.audit);
    });
  }
}
