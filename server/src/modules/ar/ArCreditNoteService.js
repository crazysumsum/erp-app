import { amountUnits, eventId, formatUnits, localDate, nextDocumentNumber, onlyFields, positiveId, reason, storedUnits, text } from "./arCommand.js";
import { invoiceLineCreditLimits } from "./arCreditLimits.js";
import { lockArCreditNote, updateArCreditNote } from "./arCreditNoteBalance.js";
import { arError } from "./arErrors.js";

const invalid = (field) => arError("AR_INPUT_INVALID", { field });
const optionalId = (value, field) => value == null ? null : positiveId(value, field);

function quantity(value, field) {
  if (value == null) return null;
  const normalized = typeof value === "number" ? String(positiveId(value, field)) : value;
  if (typeof normalized !== "string" || !/^[1-9]\d{0,19}$/u.test(normalized) || BigInt(normalized) > 18446744073709551615n) throw invalid(field);
  return normalized;
}

function draftInput(body) {
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 65535) throw invalid("lines");
  if (typeof body.reason !== "string") throw invalid("reason");
  return {
    creditDate: localDate(body.creditDate, "creditDate"),
    reason: text(body.reason.trim(), "reason", { minimum: 1, maximum: 500, multiline: true }),
    customerReturnId: optionalId(body.customerReturnId, "customerReturnId"),
    notes: text(body.notes ?? "", "notes", { maximum: 2000, multiline: true }),
    lines: body.lines.map((input, index) => {
      const field = `lines.${index}`;
      const line = onlyFields(input, ["invoiceLineId", "customerReturnLineId", "baseQuantity", "amount", "description"], field);
      return {
        invoiceLineId: optionalId(line.invoiceLineId, `${field}.invoiceLineId`),
        customerReturnLineId: optionalId(line.customerReturnLineId, `${field}.customerReturnLineId`),
        baseQuantity: quantity(line.baseQuantity, `${field}.baseQuantity`),
        amount: formatUnits(amountUnits(line.amount, `${field}.amount`)),
        description: text(line.description ?? "", `${field}.description`, { maximum: 500 })
      };
    })
  };
}

async function confirmedInvoice(tx, id) {
  const [[invoice]] = await tx.query("SELECT * FROM ar_invoices WHERE id = ? FOR UPDATE", [id]);
  if (!invoice) throw arError("AR_INVOICE_NOT_FOUND");
  if (invoice.status !== "CONFIRMED") throw arError("AR_STATE_CONFLICT");
  return invoice;
}

async function validateReturn(tx, invoice, invoiceLines, customerReturnId, lines) {
  const linked = lines.some((line) => line.customerReturnLineId !== null);
  if (customerReturnId === null) {
    if (linked) throw arError("AR_CREDIT_SOURCE_INVALID", { field: "customerReturnId" });
    return;
  }
  // A posted customer return and its lines are immutable.
  const [[header]] = await tx.query("SELECT shipment_id, customer_id FROM customer_returns WHERE id = ? AND status = 'POSTED'", [customerReturnId]);
  if (!header || Number(header.customer_id) !== Number(invoice.customer_id) ||
      !invoiceLines.some((line) => String(line.shipment_id) === String(header.shipment_id))) {
    throw arError("AR_CREDIT_SOURCE_INVALID", { field: "customerReturnId" });
  }
  if (!linked) return;
  const [rows] = await tx.query(`
    SELECT r.id, issue.shipment_line_id
      FROM customer_return_lines r JOIN shipment_issue_details issue ON issue.id = r.shipment_issue_detail_id
     WHERE r.return_id = ? AND r.inventory_movement_id IS NOT NULL`, [customerReturnId]);
  const shipmentByReturn = new Map(rows.map((row) => [Number(row.id), String(row.shipment_line_id)]));
  const shipmentByInvoice = new Map(invoiceLines.map((row) => [Number(row.id), String(row.shipment_line_id)]));
  for (const [index, line] of lines.entries()) {
    if (line.customerReturnLineId === null) continue;
    const source = shipmentByReturn.get(line.customerReturnLineId);
    if (!source || source !== shipmentByInvoice.get(line.invoiceLineId)) throw arError("AR_CREDIT_SOURCE_INVALID", { field: `lines.${index}.customerReturnLineId` });
  }
}

// The caller holds the original invoice lock. Other credit confirmations cannot advance the totals until it releases.
async function validateSource(tx, invoice, customerReturnId, lines) {
  const [invoiceLines] = await tx.query("SELECT id, line_no, line_amount, shipment_id, shipment_line_id FROM ar_invoice_lines WHERE invoice_id = ?", [invoice.id]);
  const total = storedUnits(invoice.total_amount), places = Number(invoice.currency_decimal_places);
  if (invoiceLines.length === 0 && (!invoice.opening_reference || lines.length !== 1 || lines[0].invoiceLineId !== null)) {
    throw arError("AR_CREDIT_SOURCE_INVALID", { field: "lines" });
  }
  const caps = invoiceLines.length ? invoiceLineCreditLimits(invoiceLines, total, places) : new Map([[null, total]]);
  const requested = new Map();
  let requestedTotal = 0n;
  for (const [index, line] of lines.entries()) {
    if (!caps.has(line.invoiceLineId)) throw arError("AR_CREDIT_SOURCE_INVALID", { field: `lines.${index}.invoiceLineId` });
    const field = `lines.${index}.amount`, units = amountUnits(line.amount, field, places);
    if (units <= 0n) throw invalid(field);
    requested.set(line.invoiceLineId, (requested.get(line.invoiceLineId) ?? 0n) + units);
    requestedTotal += units;
  }
  const [[used]] = await tx.query("SELECT COALESCE(SUM(total_amount), 0) AS amount FROM ar_credit_notes WHERE invoice_id = ? AND status = 'CONFIRMED'", [invoice.id]);
  if (storedUnits(used.amount) + requestedTotal > total) throw arError("AR_CREDIT_LIMIT_EXCEEDED", { field: "lines" });
  const [rows] = await tx.query(`
    SELECT l.invoice_line_id, SUM(l.amount) AS amount FROM ar_credit_notes n
      JOIN ar_credit_note_lines l ON l.credit_note_id = n.id
     WHERE n.invoice_id = ? AND n.status = 'CONFIRMED' GROUP BY l.invoice_line_id`, [invoice.id]);
  for (const row of rows) {
    const id = row.invoice_line_id === null ? null : Number(row.invoice_line_id);
    if (!requested.has(id)) continue;
    requested.set(id, requested.get(id) + storedUnits(row.amount));
  }
  for (const [id, sum] of requested) {
    if (sum > caps.get(id)) throw arError("AR_CREDIT_LIMIT_EXCEEDED", { field: "lines" });
  }
  await validateReturn(tx, invoice, invoiceLines, customerReturnId, lines);
  return formatUnits(requestedTotal);
}

async function writeLines(tx, id, invoiceId, lines) {
  await tx.query(`INSERT INTO ar_credit_note_lines (credit_note_id, invoice_id, line_no, invoice_line_id, customer_return_line_id,
    base_quantity, amount, description) VALUES ?`, [lines.map((line, index) => [id, invoiceId, index + 1, line.invoiceLineId,
    line.customerReturnLineId, line.baseQuantity, line.amount, line.description])]);
}

async function moveInvoiceBalance(tx, invoice, units, nowMs) {
  const allocated = storedUnits(invoice.allocated_amount) + units, outstanding = storedUnits(invoice.outstanding_amount) - units;
  if (allocated < 0n || outstanding < 0n) throw arError("AR_STATE_CONFLICT");
  await tx.query("UPDATE ar_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [formatUnits(allocated), formatUnits(outstanding), nowMs, invoice.id]);
}

async function applyCredit(tx, credit, invoice, amount, origin, actor, nowMs) {
  await moveInvoiceBalance(tx, invoice, amount, nowMs);
  const [result] = await tx.query("INSERT INTO ar_credit_applications SET ?", [{
    credit_note_id: credit.id, invoice_id: invoice.id, is_origin: origin ? 1 : 0, amount: formatUnits(amount),
    created_by: actor.id, created_by_label: actor.username, created_at: nowMs
  }]);
  return Number(result.insertId);
}

async function unapplyCredit(tx, invoice, application, actor, nowMs) {
  await moveInvoiceBalance(tx, invoice, -storedUnits(application.amount), nowMs);
  await tx.query("UPDATE ar_credit_applications SET status = 'UNAPPLIED', unapplied_by = ?, unapplied_by_label = ?, unapplied_at = ? WHERE id = ?",
    [actor.id, actor.username, nowMs, application.id]);
}

function result(credit, action, { applicationId, reason: voidReason } = {}) {
  const id = Number(credit.id), number = credit.credit_note_number, version = Number(credit.version);
  const summary = { id, number, version, status: credit.status, totalAmount: credit.total_amount, appliedAmount: credit.applied_amount,
    availableAmount: credit.available_amount, refundedAmount: credit.refunded_amount };
  return { summary: applicationId === undefined ? summary : { ...summary, applicationId },
    audit: { action: `credit_note.${action}`, targetType: applicationId === undefined ? "CREDIT_NOTE" : "CREDIT_APPLICATION",
      targetId: applicationId ?? id, customerId: Number(credit.customer_id), label: number ?? "", reason: voidReason,
      detail: { version, creditNoteId: id, invoiceId: Number(credit.invoice_id), totalAmount: summary.totalAmount } } };
}

export class ArCreditNoteService {
  constructor({ commands, businessMaster, time }) {
    if (!commands || !businessMaster || !time) throw new TypeError("ArCreditNoteService requires all of its dependencies");
    Object.assign(this, { commands, businessMaster, time });
  }

  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", "invoiceId", "creditDate", "reason", "customerReturnId", "notes", "lines"]);
    const request = { invoiceId: positiveId(body.invoiceId, "invoiceId"), ...draftInput(body) };
    return this.#run("CREATE_CREDIT_NOTE", 0, claims, body.eventId, request, context, async (tx, { actor, nowMs }) => {
      const invoice = await confirmedInvoice(tx, request.invoiceId);
      await this.#currency(tx, invoice);
      const draft = await this.#draft(tx, invoice, request, nowMs);
      const row = {
        ...draft, invoice_id: invoice.id, customer_id: invoice.customer_id, customer_code_snapshot: invoice.customer_code_snapshot,
        customer_name_snapshot: invoice.customer_name_snapshot, currency_code: invoice.currency_code, currency_decimal_places: invoice.currency_decimal_places,
        created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
      };
      const [insert] = await tx.query("INSERT INTO ar_credit_notes SET ?", [row]);
      await writeLines(tx, insert.insertId, invoice.id, request.lines);
      return result({ ...row, id: insert.insertId, credit_note_number: null, status: "DRAFT", version: 1, applied_amount: "0.0000", refunded_amount: "0.0000" }, "created");
    });
  }

  edit(command) {
    const input = onlyFields(command.input, ["eventId", "version", "creditDate", "reason", "customerReturnId", "notes", "lines"]);
    const request = draftInput(input);
    return this.#change(command, "EDIT", "DRAFT", request, async (tx, credit, { nowMs }) => {
      const invoice = await confirmedInvoice(tx, credit.invoice_id);
      await this.#currency(tx, credit);
      const draft = await this.#draft(tx, invoice, request, nowMs);
      await tx.query("DELETE FROM ar_credit_note_lines WHERE credit_note_id = ?", [credit.id]);
      await writeLines(tx, credit.id, invoice.id, request.lines);
      return result(await updateArCreditNote(tx, credit, draft, nowMs), "edited");
    });
  }

  confirm(command) {
    onlyFields(command.input, ["eventId", "version"]);
    return this.#change(command, "CONFIRM", "DRAFT", {}, async (tx, credit, { actor, nowMs }) => {
      const invoice = await confirmedInvoice(tx, credit.invoice_id);
      await this.#currency(tx, credit);
      this.#checkDate(credit.credit_date, nowMs);
      const [rows] = await tx.query("SELECT invoice_line_id, customer_return_line_id, amount FROM ar_credit_note_lines WHERE credit_note_id = ? ORDER BY line_no", [credit.id]);
      const lines = rows.map((row) => ({ invoiceLineId: row.invoice_line_id === null ? null : Number(row.invoice_line_id),
        customerReturnLineId: row.customer_return_line_id === null ? null : Number(row.customer_return_line_id), amount: row.amount }));
      const total = await validateSource(tx, invoice, credit.customer_return_id === null ? null : Number(credit.customer_return_id), lines);
      if (total !== credit.total_amount) throw arError("AR_CREDIT_SOURCE_INVALID", { field: "lines" });
      const units = storedUnits(total), outstanding = storedUnits(invoice.outstanding_amount);
      const applied = outstanding < units ? outstanding : units;
      if (applied > 0n) await applyCredit(tx, credit, invoice, applied, true, actor, nowMs);
      const number = await nextDocumentNumber(tx, { documentType: "CREDIT_NOTE", time: this.time, nowMs });
      return result(await updateArCreditNote(tx, credit, { status: "CONFIRMED", credit_note_number: number, applied_amount: formatUnits(applied),
        available_amount: formatUnits(units - applied), confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs }, nowMs), "confirmed");
    });
  }

  cancel(command) {
    onlyFields(command.input, ["eventId", "version"]);
    return this.#change(command, "CANCEL", "DRAFT", {}, async (tx, credit, { nowMs }) =>
      result(await updateArCreditNote(tx, credit, { status: "CANCELLED" }, nowMs), "cancelled"));
  }

  void(command) {
    const body = onlyFields(command.input, ["eventId", "version", "reason"]), why = reason(body.reason);
    return this.#change(command, "VOID", "CONFIRMED", { reason: why }, async (tx, credit, { actor, nowMs }) => {
      const invoice = await confirmedInvoice(tx, credit.invoice_id);
      await this.#currency(tx, credit);
      const [applications] = await tx.query("SELECT id, invoice_id, is_origin, amount FROM ar_credit_applications WHERE credit_note_id = ? AND status = 'ACTIVE'", [credit.id]);
      if (applications.some((row) => !row.is_origin)) throw arError("AR_CREDIT_HAS_EXTERNAL_APPLICATIONS");
      const [[refund]] = await tx.query("SELECT id FROM ar_refunds WHERE credit_note_id = ? AND status = 'CONFIRMED' LIMIT 1", [credit.id]);
      if (refund || storedUnits(credit.refunded_amount) > 0n) throw arError("AR_CREDIT_HAS_REFUNDS");
      const [origin] = applications;
      if (applications.length > 1 || (origin && String(origin.invoice_id) !== String(invoice.id)) ||
          storedUnits(credit.applied_amount) !== storedUnits(origin?.amount ?? "0")) throw arError("AR_STATE_CONFLICT");
      if (origin) await unapplyCredit(tx, invoice, origin, actor, nowMs);
      return result(await updateArCreditNote(tx, credit, { status: "VOID", applied_amount: "0.0000", refunded_amount: "0.0000", available_amount: "0.0000",
        void_reason: why, voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs }, nowMs), "voided", { reason: why });
    });
  }

  apply(command) {
    const body = onlyFields(command.input, ["eventId", "version", "invoiceId", "amount"]);
    const payload = { invoiceId: positiveId(body.invoiceId, "invoiceId"), amount: formatUnits(amountUnits(body.amount, "amount")) };
    return this.#change(command, "APPLY", "CONFIRMED", payload, async (tx, credit, { actor, nowMs }) => {
      if (payload.invoiceId === Number(credit.invoice_id)) throw arError("AR_CREDIT_APPLICATION_IS_ORIGIN", { field: "invoiceId" });
      const invoice = await confirmedInvoice(tx, payload.invoiceId);
      if (String(invoice.customer_id) !== String(credit.customer_id) || invoice.currency_code !== credit.currency_code) throw arError("AR_CREDIT_PARTY_MISMATCH");
      await this.#currency(tx, credit);
      const amount = amountUnits(payload.amount, "amount", Number(credit.currency_decimal_places)), available = storedUnits(credit.available_amount);
      if (amount <= 0n) throw invalid("amount");
      if (amount > available) throw arError("AR_CREDIT_EXCEEDS_AVAILABLE");
      if (amount > storedUnits(invoice.outstanding_amount)) throw arError("AR_ALLOCATION_EXCEEDS_OUTSTANDING");
      const applicationId = await applyCredit(tx, credit, invoice, amount, false, actor, nowMs);
      const updated = await updateArCreditNote(tx, credit, { applied_amount: formatUnits(storedUnits(credit.applied_amount) + amount),
        available_amount: formatUnits(available - amount) }, nowMs);
      return result(updated, "applied", { applicationId });
    });
  }

  unapply(command) {
    onlyFields(command.input, ["eventId", "version"]);
    const applicationId = positiveId(command.applicationId, "applicationId");
    return this.#change(command, "UNAPPLY", "CONFIRMED", { applicationId }, async (tx, credit, { actor, nowMs }) => {
      const [[application]] = await tx.query("SELECT id, invoice_id, is_origin, status, amount FROM ar_credit_applications WHERE id = ? AND credit_note_id = ?", [applicationId, credit.id]);
      if (!application) throw arError("AR_CREDIT_APPLICATION_NOT_FOUND");
      if (application.is_origin) throw arError("AR_CREDIT_APPLICATION_IS_ORIGIN");
      if (application.status !== "ACTIVE") throw arError("AR_STATE_CONFLICT");
      const invoice = await confirmedInvoice(tx, application.invoice_id);
      await this.#currency(tx, credit);
      await unapplyCredit(tx, invoice, application, actor, nowMs);
      const amount = storedUnits(application.amount), applied = storedUnits(credit.applied_amount) - amount;
      if (applied < 0n) throw arError("AR_STATE_CONFLICT");
      const updated = await updateArCreditNote(tx, credit, { applied_amount: formatUnits(applied),
        available_amount: formatUnits(storedUnits(credit.available_amount) + amount) }, nowMs);
      return result(updated, "unapplied", { applicationId });
    });
  }

  #checkDate(date, nowMs) {
    if (date > this.time.fileDate(this.time.at(nowMs))) throw arError("AR_DATE_IN_FUTURE", { field: "creditDate" });
  }

  #currency(tx, row) {
    return this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: row.currency_code, purpose: "history" });
  }

  async #draft(tx, invoice, request, nowMs) {
    this.#checkDate(request.creditDate, nowMs);
    const total = await validateSource(tx, invoice, request.customerReturnId, request.lines);
    return { credit_date: request.creditDate, reason: request.reason, customer_return_id: request.customerReturnId, notes: request.notes,
      total_amount: total, available_amount: total };
  }

  #change({ claims, creditNoteId, input, context }, action, state, payload, work) {
    const id = positiveId(creditNoteId, "creditNoteId"), version = positiveId(input.version, "version");
    return this.#run(`${action}_CREDIT_NOTE`, id, claims, input.eventId, { version, ...payload }, context, async (tx, command) => {
      const credit = await lockArCreditNote(tx, id);
      if (!credit) throw arError("AR_CREDIT_NOTE_NOT_FOUND");
      if (Number(credit.version) !== version) throw arError("VERSION_CONFLICT", { currentVersion: Number(credit.version) });
      if (credit.status !== state) throw arError("AR_STATE_CONFLICT");
      return work(tx, credit, command);
    });
  }

  #run(commandType, targetId, claims, event, payload, context, work) {
    return this.commands.run({ claims, permission: "ar.credit.mgmt", commandType, targetType: "CREDIT_NOTE",
      targetId, eventId: eventId(event), payload, context }, work);
  }
}
