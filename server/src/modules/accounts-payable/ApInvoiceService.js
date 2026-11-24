import { eventId, nextDocumentNumber, onlyFields, positiveId, reason, storedUnits } from "./apCommand.js";
import { apError } from "./apErrors.js";
import { draftFields, editedDueDate, initialDueDate, invoiceTotal, MAX_RECEIPTS, receiptAmounts, requiredText, sourceId } from "./apInvoiceDraft.js";

const permission = "ap.invoice.mgmt";
const editableFields = ["supplierInvoiceNumber", "dueDate", "dueDateReason", "supplierTotalAmount", "notes", "expenses", "receiptOverrides"];
const invalid = (field) => apError("AP_INPUT_INVALID", { field });
const isDuplicate = (error) => (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";

function receiptIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_RECEIPTS) throw invalid("goodsReceiptIds");
  const ids = values.map((value) => sourceId(value, "goodsReceiptIds"));
  if (new Set(ids).size !== ids.length) throw invalid("goodsReceiptIds");
  return ids;
}

function receiptLines(receipts) {
  return receipts.flatMap((receipt) => receipt.lines.map((line) => {
    const { poUnitPrice, poLineAmount } = receiptAmounts(line.receivedBaseQuantity, line.unitPrice, line.toBaseFactor);
    return {
      line_type: "RECEIPT",
      goods_receipt_id: receipt.id,
      goods_receipt_line_id: line.id,
      active_goods_receipt_line_id: line.id,
      purchase_order_id: receipt.purchaseOrderId,
      purchase_order_line_id: line.purchaseOrderLineId,
      goods_receipt_number_snapshot: receipt.number,
      purchase_order_number_snapshot: receipt.purchaseOrderNumber,
      sku_code_snapshot: line.skuCodeSnapshot,
      sku_name_snapshot: line.skuNameSnapshot,
      base_uom_code_snapshot: line.baseUomCodeSnapshot,
      purchase_uom_code_snapshot: line.purchaseUomCodeSnapshot,
      to_base_factor_snapshot: line.toBaseFactor,
      quantity: line.receivedBaseQuantity,
      po_unit_price_snapshot: poUnitPrice,
      po_line_amount: poLineAmount,
      line_amount: poLineAmount,
      amount_override_reason: ""
    };
  }));
}

function applyOverrides(lines, overrides, permissions) {
  const requested = new Map(overrides.map((change) => [change.goodsReceiptLineId, change]));
  const updated = lines.map((line) => {
    const change = requested.get(line.goods_receipt_line_id);
    requested.delete(line.goods_receipt_line_id);
    const amount = change?.lineAmount ?? line.po_line_amount;
    const reason = amount !== line.po_line_amount ? change.reason : "";
    if (amount !== line.po_line_amount && (amount !== line.line_amount || reason !== line.amount_override_reason) &&
        !permissions.includes("ap.invoice.price.override")) {
      throw apError("AP_PRICE_OVERRIDE_FORBIDDEN");
    }
    return { ...line, line_amount: amount, amount_override_reason: reason };
  });
  if (requested.size) throw invalid("receiptOverrides");
  return updated;
}

const lineColumns = [
  "line_type", "goods_receipt_id", "goods_receipt_line_id", "active_goods_receipt_line_id", "purchase_order_id",
  "purchase_order_line_id", "goods_receipt_number_snapshot", "purchase_order_number_snapshot", "sku_code_snapshot",
  "sku_name_snapshot", "base_uom_code_snapshot", "purchase_uom_code_snapshot", "to_base_factor_snapshot", "quantity",
  "po_unit_price_snapshot", "po_line_amount", "line_amount", "amount_override_reason", "description"
];
const expenseDefaults = ["EXPENSE", null, null, null, null, null, "", "", "", "", "", "", 1, 0, "0.0000", "0.0000", null, "", ""];

async function insertLines(tx, id, lines, offset = 0) {
  if (!lines.length) return;
  const values = lines.map((line, index) => [id, offset + index + 1,
    ...lineColumns.map((column, idx) => line[column] ?? expenseDefaults[idx])]);
  try {
    await tx.query(`INSERT INTO ap_invoice_lines (invoice_id, line_no, ${lineColumns.join(", ")}) VALUES ?`, [values]);
  } catch (error) {
    if (isDuplicate(error)) throw apError("AP_RECEIPT_ALREADY_INVOICED");
    throw error;
  }
}

async function writeInvoice(work) {
  try {
    return await work();
  } catch (error) {
    if (isDuplicate(error)) throw apError("AP_DUPLICATE_SUPPLIER_INVOICE");
    throw error;
  }
}

/** Invoice drafts own their receipt reservations until cancellation or void, including all lines from each receipt. */
export class ApInvoiceService {
  constructor({ commands, readSources, suppliers, businessMaster, time }) {
    if (!commands || typeof readSources !== "function" || !suppliers || !businessMaster || !time) {
      throw new TypeError("ApInvoiceService requires all of its dependencies");
    }
    Object.assign(this, { commands, readSources, suppliers, businessMaster, time });
  }

  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", ...editableFields, "invoiceDate", "goodsReceiptIds", "supplierId", "currencyCode", "noPoReason"]);
    const fields = draftFields(body, true);
    let source;
    if (Object.hasOwn(body, "goodsReceiptIds")) {
      if (["supplierId", "currencyCode", "noPoReason"].some((field) => Object.hasOwn(body, field))) throw invalid("goodsReceiptIds");
      source = { goodsReceiptIds: receiptIds(body.goodsReceiptIds) };
    } else {
      if (typeof body.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(body.currencyCode)) throw invalid("currencyCode");
      if (!fields.expenses.length || fields.overrides.length) throw invalid("expenses");
      source = { supplierId: positiveId(body.supplierId, "supplierId"), currencyCode: body.currencyCode,
        noPoReason: requiredText(body.noPoReason, "noPoReason") };
    }
    const payload = { ...fields, ...source };
    return this.commands.run({ claims, permission, commandType: "CREATE_INVOICE", targetType: "INVOICE", eventId: eventId(body.eventId), payload, context },
      async (tx, { nowMs, actor }) => {
        const receipts = source.goodsReceiptIds ? await this.readSources(tx, { goodsReceiptIds: source.goodsReceiptIds }) : [];
        const party = receipts.length ? this.#receiptParty(receipts[0]) : await this.#noPoParty(tx, source);
        const lines = [...applyOverrides(receiptLines(receipts), fields.overrides, actor.permissions), ...fields.expenses];
        const total = invoiceTotal(lines, party.currency_decimal_places);
        const [result] = await writeInvoice(() => tx.query("INSERT INTO ap_invoices SET ?", [{
          ...party, ...initialDueDate(receipts, fields),
          supplier_invoice_number: fields.invoiceNumber.number, active_supplier_invoice_key: fields.invoiceNumber.key,
          invoice_date: fields.invoiceDate, no_po_reason: source.noPoReason ?? "",
          supplier_total_amount: fields.supplierTotal ?? null, notes: fields.notes ?? "",
          total_amount: total, outstanding_amount: total,
          created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
        }]));
        const id = Number(result.insertId);
        await insertLines(tx, id, lines);
        return this.#result(id, null, "DRAFT", 1, total, party.supplier_id, "invoice.created", { receiptCount: receipts.length, lineCount: lines.length });
      });
  }

  update({ claims, invoiceId, input, context }) {
    const body = onlyFields(input, ["eventId", "version", ...editableFields]);
    const fields = draftFields(body);
    if (!Object.keys(fields).length || (Object.keys(fields).length === 1 && Object.hasOwn(fields, "dueDateReason"))) throw invalid("body");
    return this.#run({ claims, invoiceId, body, context }, "UPDATE_INVOICE", fields, async (tx, command, id, version) => {
      const invoice = await this.#lock(tx, id, version, "DRAFT");
      const changes = editedDueDate(invoice, fields);
      if (fields.invoiceNumber) {
        changes.supplier_invoice_number = fields.invoiceNumber.number;
        changes.active_supplier_invoice_key = fields.invoiceNumber.key;
      }
      if (fields.supplierTotal !== undefined) changes.supplier_total_amount = fields.supplierTotal;
      if (fields.notes !== undefined) changes.notes = fields.notes;
      if (fields.overrides !== undefined || fields.expenses !== undefined) {
        const [lines] = await tx.query(`
          SELECT id, line_type, CAST(goods_receipt_line_id AS CHAR) AS goods_receipt_line_id, po_line_amount, line_amount, amount_override_reason
            FROM ap_invoice_lines WHERE invoice_id = ? ORDER BY line_no FOR UPDATE`, [id]);
        const receiptRows = lines.filter(({ line_type }) => line_type === "RECEIPT");
        const adjusted = fields.overrides === undefined ? receiptRows : applyOverrides(receiptRows, fields.overrides, command.actor.permissions);
        const expenseRows = fields.expenses ?? lines.filter(({ line_type }) => line_type === "EXPENSE");
        const total = invoiceTotal([...adjusted, ...expenseRows], Number(invoice.currency_decimal_places));
        for (const [index, line] of adjusted.entries()) {
          const previous = receiptRows[index];
          if (line.line_amount !== previous.line_amount || line.amount_override_reason !== previous.amount_override_reason) {
            await tx.query("UPDATE ap_invoice_lines SET line_amount = ?, amount_override_reason = ? WHERE id = ?",
              [line.line_amount, line.amount_override_reason, line.id]);
          }
        }
        if (fields.expenses !== undefined) {
          await tx.query("DELETE FROM ap_invoice_lines WHERE invoice_id = ? AND line_type = 'EXPENSE'", [id]);
          await insertLines(tx, id, fields.expenses, receiptRows.length);
        }
        changes.total_amount = total;
        changes.outstanding_amount = total;
      }
      await writeInvoice(() => tx.query("UPDATE ap_invoices SET ? WHERE id = ?", [
        { ...changes, version: version + 1, updated_at: command.nowMs }, id
      ]));
      return this.#result(id, null, "DRAFT", version + 1, changes.total_amount ?? invoice.total_amount, invoice.supplier_id, "invoice.updated");
    });
  }

  confirm({ claims, invoiceId, input, context }) {
    const body = onlyFields(input, ["eventId", "version"]);
    return this.#run({ claims, invoiceId, body, context }, "CONFIRM_INVOICE", {}, async (tx, { actor, nowMs }, id, version) => {
      // A no-PO confirmation adds debt and must serialize with supplier archival.
      const [[preflight]] = await tx.query("SELECT supplier_id, no_po_reason FROM ap_invoices WHERE id = ?", [id]);
      if (preflight?.no_po_reason) {
        await this.suppliers.assertUsableInTransaction(tx, preflight.supplier_id, { purpose: "purchase" });
      }
      const invoice = await this.#lock(tx, id, version, "DRAFT");
      if (invoice.no_po_reason && (!preflight?.no_po_reason || String(preflight.supplier_id) !== String(invoice.supplier_id))) {
        throw apError("AP_STATE_CONFLICT");
      }
      if (invoice.supplier_total_amount === null || storedUnits(invoice.supplier_total_amount) !== storedUnits(invoice.total_amount)) {
        throw apError("AP_INVOICE_TOTAL_MISMATCH", { field: "supplierTotalAmount" });
      }
      const number = await nextDocumentNumber(tx, { documentType: "INVOICE", time: this.time, nowMs });
      await tx.query("UPDATE ap_invoices SET ? WHERE id = ?", [{
        invoice_number: number, status: "CONFIRMED", confirmed_by: actor.id, confirmed_by_label: actor.username,
        confirmed_at: nowMs, updated_at: nowMs, version: version + 1
      }, id]);
      return this.#result(id, number, "CONFIRMED", version + 1, invoice.total_amount, invoice.supplier_id, "invoice.confirmed");
    });
  }

  cancel(command) {
    return this.#release(command, false);
  }

  void(command) {
    return this.#release(command, true);
  }

  #release({ claims, invoiceId, input, context }, voiding) {
    const body = onlyFields(input, voiding ? ["eventId", "version", "reason"] : ["eventId", "version"]);
    const why = voiding ? reason(body.reason) : "";
    const status = voiding ? "VOID" : "CANCELLED";
    return this.#run({ claims, invoiceId, body, context }, voiding ? "VOID_INVOICE" : "CANCEL_INVOICE", { reason: why },
      async (tx, { actor, nowMs }, id, version) => {
        const invoice = await this.#lock(tx, id, version, voiding ? "CONFIRMED" : "DRAFT");
        if (voiding && storedUnits(invoice.allocated_amount) !== 0n) throw apError("AP_INVOICE_HAS_ALLOCATIONS");
        await tx.query("UPDATE ap_invoice_lines SET active_goods_receipt_line_id = NULL WHERE invoice_id = ? AND active_goods_receipt_line_id IS NOT NULL", [id]);
        const voidFields = voiding ? { void_reason: why, voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs } : {};
        await tx.query("UPDATE ap_invoices SET ? WHERE id = ?", [{
          ...voidFields, active_supplier_invoice_key: null, status, version: version + 1, updated_at: nowMs
        }, id]);
        return this.#result(id, invoice.invoice_number, status, version + 1, invoice.total_amount, invoice.supplier_id,
          voiding ? "invoice.voided" : "invoice.cancelled", {}, why);
      });
  }

  #run({ claims, invoiceId, body, context }, commandType, fields, work) {
    const id = positiveId(invoiceId, "invoiceId");
    const version = positiveId(body.version, "version");
    return this.commands.run({ claims, permission, commandType, targetType: "INVOICE", targetId: id,
      eventId: eventId(body.eventId), payload: { ...fields, version }, context }, (tx, command) => work(tx, command, id, version));
  }

  async #lock(tx, id, version, expected) {
    const [[invoice]] = await tx.query(`
      SELECT invoice_number, status, supplier_id, no_po_reason, currency_decimal_places, supplier_total_amount, total_amount, allocated_amount, version,
        DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date
      FROM ap_invoices WHERE id = ? FOR UPDATE`, [id]);
    if (!invoice) throw apError("AP_INVOICE_NOT_FOUND");
    if (Number(invoice.version) !== version) throw apError("VERSION_CONFLICT", { currentVersion: Number(invoice.version) });
    if (invoice.status !== expected) throw apError("AP_STATE_CONFLICT");
    return invoice;
  }

  #receiptParty(receipt) {
    return { supplier_id: receipt.supplierId, supplier_code_snapshot: receipt.supplierCodeSnapshot, supplier_name_snapshot: receipt.supplierNameSnapshot,
      currency_code: receipt.currencyCode, currency_decimal_places: receipt.currencyDecimalPlaces };
  }

  async #noPoParty(tx, source) {
    const supplier = await this.suppliers.assertUsableInTransaction(tx, source.supplierId, { purpose: "purchase" });
    const currency = await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: source.currencyCode, purpose: "new_assignment" });
    return { supplier_id: supplier.supplierId, supplier_code_snapshot: supplier.supplierCode, supplier_name_snapshot: supplier.supplierName,
      currency_code: currency.code, currency_decimal_places: currency.decimalPlaces };
  }

  #result(id, number, status, version, totalAmount, supplierId, action, detail = {}, reason = "") {
    return { summary: { id, number, status, version, totalAmount },
      audit: { action, targetType: "INVOICE", targetId: id, supplierId, label: number ?? "", reason, detail: { ...detail, version, totalAmount } } };
  }
}
