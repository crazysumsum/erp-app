import { amountUnits, eventId, formatUnits, localDate, nextDocumentNumber, onlyFields, positiveId, reason as validReason, storedUnits, text } from "./arCommand.js";
import { arError } from "./arErrors.js";

export const PAYMENT_METHODS = Object.freeze(["BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"]);
export const MAX_ALLOCATIONS = 50; // 一次核銷最多 50 張發票。
const PERMISSION = "ar.receipt.mgmt";
const invalid = (field) => arError("AR_INPUT_INVALID", { field });
const placeholders = (values) => values.map(() => "?").join(",");

/**
 * 收款登記、核銷及解除（SCOPE §1、§3；TABLES §5、§6）。每個命令一個交易，流程在 ArCommandRunner。
 * 取鎖次序固定：操作列 → 發票（ID 升序）→ 收款 → 核銷 → 編號。未核銷的餘額留在收款的 available_amount 上。
 */
export class ArReceiptService {
  /** `customers(executor)` 回一個在該 executor 上讀取的客戶查詢：交易內的讀取必須留在同一條連線，不另佔連線池。 */
  constructor({ commands, customers, businessMaster, time }) {
    if (!commands || typeof customers !== "function" || !businessMaster || !time) throw new TypeError("ArReceiptService requires all of its dependencies");
    Object.assign(this, { commands, customers, businessMaster, time });
  }

  /** 建立收款草稿。金額只收該幣別的小數位。 */
  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", "customerId", "currencyCode", "receiptDate", "amount", "paymentMethod", "reference", "notes"]);
    if (typeof body.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(body.currencyCode)) throw invalid("currencyCode");
    if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw invalid("paymentMethod");
    const request = {
      customerId: positiveId(body.customerId, "customerId"), currencyCode: body.currencyCode, receiptDate: localDate(body.receiptDate, "receiptDate"),
      amount: formatUnits(amountUnits(body.amount, "amount")), paymentMethod: body.paymentMethod,
      reference: text(body.reference ?? "", "reference", { maximum: 190 }), notes: text(body.notes ?? "", "notes", { maximum: 2000, multiline: true })
    };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "CREATE_RECEIPT", targetType: "RECEIPT", eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        // 收款可以來自已停用的客戶或幣別（舊發票仍要收），所以只要求存在。
        const customer = await this.customers(tx).findById(request.customerId, { purpose: "ar_existing_document" });
        if (!customer) throw arError("AR_CUSTOMER_NOT_FOUND");
        const currency = await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: request.currencyCode, purpose: "history" });
        const amount = amountUnits(request.amount, "amount", currency.decimalPlaces);
        if (amount <= 0n) throw invalid("amount");
        const [result] = await tx.query("INSERT INTO ar_receipts SET ?", [{
          customer_id: customer.customerId, customer_code_snapshot: customer.customerCode, customer_name_snapshot: customer.legalName,
          currency_code: currency.code, currency_decimal_places: currency.decimalPlaces, receipt_date: request.receiptDate, amount: request.amount,
          available_amount: request.amount, payment_method: request.paymentMethod, reference: request.reference, notes: request.notes,
          created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
        }]);
        const id = Number(result.insertId);
        return { summary: { id, number: null, status: "DRAFT", version: 1 },
          audit: { action: "receipt.created", targetType: "RECEIPT", targetId: id, customerId: customer.customerId, detail: { amount: request.amount, currencyCode: currency.code } } };
      });
  }

  /** 確認：取號，其後可核銷。 */
  confirm(command) {
    return this.#transition(command, { commandType: "CONFIRM_RECEIPT", from: "DRAFT", action: "receipt.confirmed" }, async (tx, receipt, { actor, nowMs }) => {
      const number = await nextDocumentNumber(tx, { documentType: "RECEIPT", time: this.time, nowMs });
      return { number, changes: { status: "CONFIRMED", receipt_number: number, confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs } };
    });
  }

  /** 取消草稿。 */
  cancel(command) {
    return this.#transition(command, { commandType: "CANCEL_RECEIPT", from: "DRAFT", action: "receipt.cancelled" }, async () => ({ changes: { status: "CANCELLED" } }));
  }

  /** 作廢收款：只有已確認而且沒有任何有效核銷的收款可以作廢，須原因；號碼保留不重用，作廢後不可再核銷。 */
  void(command) {
    return this.#transition(command, { commandType: "VOID_RECEIPT", from: "CONFIRMED", action: "receipt.voided", needsReason: true }, async (tx, receipt, { actor, nowMs }, request) => {
      if (storedUnits(receipt.allocated_amount) !== 0n) throw arError("AR_RECEIPT_HAS_ALLOCATIONS");
      return { changes: { status: "VOID", allocated_amount: "0.0000", available_amount: "0.0000", void_reason: request.reason,
        voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs } };
    });
  }

  /** 把已確認的收款核銷到同客戶同幣別的一張或多張已確認發票；可部分核銷。 */
  allocate({ claims, receiptId, input, context }) {
    const id = positiveId(receiptId, "receiptId"), body = onlyFields(input, ["eventId", "version", "allocations"]);
    if (!Array.isArray(body.allocations) || body.allocations.length < 1 || body.allocations.length > MAX_ALLOCATIONS) throw invalid("allocations");
    const allocations = body.allocations.map((item, index) => {
      const row = onlyFields(item, ["invoiceId", "amount"], `allocations.${index}`);
      return { invoiceId: positiveId(row.invoiceId, `allocations.${index}.invoiceId`), amount: formatUnits(amountUnits(row.amount, `allocations.${index}.amount`)) };
    });
    if (new Set(allocations.map((item) => item.invoiceId)).size !== allocations.length) throw invalid("allocations");
    const request = { version: positiveId(body.version, "version"), allocations };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "ALLOCATE_RECEIPT", targetType: "RECEIPT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        const invoiceIds = allocations.map((item) => item.invoiceId).sort((a, b) => a - b);
        const [invoiceRows] = await tx.query(`SELECT id, status, customer_id, currency_code, allocated_amount, outstanding_amount FROM ar_invoices
          WHERE id IN (${placeholders(invoiceIds)}) ORDER BY id FOR UPDATE`, invoiceIds);
        const invoices = new Map(invoiceRows.map((row) => [Number(row.id), row]));
        const receipt = await this.#lock(tx, id, request.version, "CONFIRMED");

        let total = 0n;
        const applied = [];
        for (const [index, item] of allocations.entries()) {
          const invoice = invoices.get(item.invoiceId), field = `allocations.${index}`;
          if (!invoice) throw arError("AR_INVOICE_NOT_FOUND", { field });
          if (invoice.status !== "CONFIRMED") throw arError("AR_STATE_CONFLICT", { field });
          if (Number(invoice.customer_id) !== Number(receipt.customer_id) || invoice.currency_code !== receipt.currency_code) throw arError("AR_PARTY_MISMATCH", { field });
          const amount = amountUnits(item.amount, `${field}.amount`, Number(receipt.currency_decimal_places)), outstanding = storedUnits(invoice.outstanding_amount);
          if (amount <= 0n) throw invalid(`${field}.amount`);
          if (amount > outstanding) throw arError("AR_ALLOCATION_EXCEEDS_OUTSTANDING", { field });
          total += amount;
          await tx.query("UPDATE ar_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?",
            [formatUnits(storedUnits(invoice.allocated_amount) + amount), formatUnits(outstanding - amount), nowMs, item.invoiceId]);
          const [result] = await tx.query("INSERT INTO ar_receipt_allocations SET ?", [{ receipt_id: id, invoice_id: item.invoiceId, amount: item.amount,
            created_by: actor.id, created_by_label: actor.username, created_at: nowMs }]);
          applied.push({ allocationId: Number(result.insertId), invoiceId: item.invoiceId, amount: item.amount });
        }
        if (total > storedUnits(receipt.available_amount)) throw arError("AR_ALLOCATION_EXCEEDS_AVAILABLE");
        const summary = await this.#move(tx, receipt, total, nowMs);
        return { summary: { ...summary, allocationIds: applied.map((item) => item.allocationId) },
          audit: { action: "receipt.allocated", targetType: "RECEIPT", targetId: id, customerId: Number(receipt.customer_id), label: receipt.receipt_number, detail: { version: summary.version, allocations: applied } } };
      });
  }

  /** 解除一筆核銷：金額回到收款的可核銷額及發票的未收額；記錄保留為 UNAPPLIED。 */
  unapply({ claims, receiptId, allocationId, input, context }) {
    const id = positiveId(receiptId, "receiptId"), allocation = positiveId(allocationId, "allocationId");
    const body = onlyFields(input, ["eventId", "version"]), request = { allocationId: allocation, version: positiveId(body.version, "version") };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "UNAPPLY_ALLOCATION", targetType: "RECEIPT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        // 核銷的收款及發票不會變，所以先不加鎖讀出發票 ID，再按固定次序（發票 → 收款 → 核銷）取鎖並重驗。
        const [[found]] = await tx.query("SELECT invoice_id FROM ar_receipt_allocations WHERE id = ? AND receipt_id = ?", [allocation, id]);
        if (!found) throw arError("AR_ALLOCATION_NOT_FOUND");
        const [[invoice]] = await tx.query("SELECT id, allocated_amount, outstanding_amount FROM ar_invoices WHERE id = ? FOR UPDATE", [found.invoice_id]);
        const receipt = await this.#lock(tx, id, request.version, "CONFIRMED");
        const [[row]] = await tx.query("SELECT amount, status FROM ar_receipt_allocations WHERE id = ? FOR UPDATE", [allocation]);
        if (row.status !== "ACTIVE") throw arError("AR_STATE_CONFLICT");

        const amount = storedUnits(row.amount);
        await tx.query("UPDATE ar_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?",
          [formatUnits(storedUnits(invoice.allocated_amount) - amount), formatUnits(storedUnits(invoice.outstanding_amount) + amount), nowMs, invoice.id]);
        await tx.query("UPDATE ar_receipt_allocations SET status = 'UNAPPLIED', unapplied_by = ?, unapplied_by_label = ?, unapplied_at = ? WHERE id = ?",
          [actor.id, actor.username, nowMs, allocation]);
        const summary = await this.#move(tx, receipt, -amount, nowMs);
        return { summary: { ...summary, allocationId: allocation },
          audit: { action: "receipt.unapplied", targetType: "ALLOCATION", targetId: allocation, customerId: Number(receipt.customer_id), label: receipt.receipt_number,
            detail: { version: summary.version, receiptId: id, invoiceId: Number(invoice.id), amount: formatUnits(amount) } } };
      });
  }

  /** 鎖收款並驗版本及狀態。 */
  async #lock(tx, id, version, status) {
    const [[receipt]] = await tx.query(`SELECT id, receipt_number, status, version, customer_id, currency_code, currency_decimal_places, allocated_amount, available_amount
      FROM ar_receipts WHERE id = ? FOR UPDATE`, [id]);
    if (!receipt) throw arError("AR_RECEIPT_NOT_FOUND");
    if (Number(receipt.version) !== version) throw arError("VERSION_CONFLICT", { currentVersion: Number(receipt.version) });
    if (receipt.status !== status) throw arError("AR_STATE_CONFLICT");
    return receipt;
  }

  /** 把 `delta` 由可核銷額移到已核銷額（負數為移回），版本加一。 */
  async #move(tx, receipt, delta, nowMs) {
    const allocated = formatUnits(storedUnits(receipt.allocated_amount) + delta), available = formatUnits(storedUnits(receipt.available_amount) - delta);
    const version = Number(receipt.version) + 1;
    await tx.query("UPDATE ar_receipts SET allocated_amount = ?, available_amount = ?, version = ?, updated_at = ? WHERE id = ?", [allocated, available, version, nowMs, receipt.id]);
    return { id: Number(receipt.id), number: receipt.receipt_number, status: receipt.status, version, allocatedAmount: allocated, availableAmount: available };
  }

  /** 只改狀態的命令：鎖收款、驗版本及來源狀態、寫入 `changes`。 */
  #transition({ claims, receiptId, input, context }, { commandType, from, action, needsReason = false }, changesFor) {
    const id = positiveId(receiptId, "receiptId"), body = onlyFields(input, ["eventId", "version", ...(needsReason ? ["reason"] : [])]);
    const request = { version: positiveId(body.version, "version"), ...(needsReason ? { reason: validReason(body.reason) } : {}) };
    return this.commands.run({ claims, permission: PERMISSION, commandType, targetType: "RECEIPT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, command) => {
        const receipt = await this.#lock(tx, id, request.version, from);
        const { changes, number = receipt.receipt_number } = await changesFor(tx, receipt, command, request);
        const version = request.version + 1;
        await tx.query("UPDATE ar_receipts SET ? WHERE id = ?", [{ ...changes, version, updated_at: command.nowMs }, id]);
        return { summary: { id, number, status: changes.status, version },
          audit: { action, targetType: "RECEIPT", targetId: id, customerId: Number(receipt.customer_id), label: number ?? "", reason: request.reason, detail: { version } } };
      });
  }
}
