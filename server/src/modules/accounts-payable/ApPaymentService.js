import { amountUnits, eventId, formatUnits, localDate, nextDocumentNumber, onlyFields, positiveId, reason as validReason, storedUnits, text } from "./apCommand.js";
import { apError } from "./apErrors.js";

export const PAYMENT_METHODS = Object.freeze(["BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"]);
export const MAX_ALLOCATIONS = 50; // 一次核銷最多 50 張發票。
const PERMISSION = "ap.payment.mgmt";
const invalid = (field) => apError("AP_INPUT_INVALID", { field });
const placeholders = (values) => values.map(() => "?").join(",");

/**
 * 付款登記、核銷及解除（SCOPE §1、§3；TABLES §5、§6）。每個命令一個交易，流程在 ApCommandRunner。
 * 取鎖次序固定：操作列 → 付款 → 發票（ID 升序）→ 核銷 → 編號。未核銷的餘額留在付款的 available_amount 上。
 */
export class ApPaymentService {
  constructor({ commands, suppliers, businessMaster, time }) {
    if (!commands || typeof suppliers?.findByIdInTransaction !== "function" || !businessMaster || !time) throw new TypeError("ApPaymentService requires all of its dependencies");
    Object.assign(this, { commands, suppliers, businessMaster, time });
  }

  /** 建立付款草稿。金額只收該幣別的小數位。 */
  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", "supplierId", "currencyCode", "paymentDate", "amount", "paymentMethod", "reference", "notes"]);
    if (typeof body.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(body.currencyCode)) throw invalid("currencyCode");
    if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw invalid("paymentMethod");
    const request = {
      supplierId: positiveId(body.supplierId, "supplierId"), currencyCode: body.currencyCode, paymentDate: localDate(body.paymentDate, "paymentDate"),
      amount: formatUnits(amountUnits(body.amount, "amount")), paymentMethod: body.paymentMethod,
      reference: text(body.reference ?? "", "reference", { maximum: 190 }), notes: text(body.notes ?? "", "notes", { maximum: 2000, multiline: true })
    };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "CREATE_PAYMENT", targetType: "PAYMENT", eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        this.#notInFuture(request.paymentDate, nowMs);
        // 既有債務可以付給已停用的供應商，查快照時只要求存在。
        const supplier = await this.suppliers.findByIdInTransaction(tx, request.supplierId, { purpose: "history" });
        if (!supplier) throw apError("AP_SUPPLIER_NOT_FOUND");
        const currency = await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: request.currencyCode, purpose: "history" });
        const amount = amountUnits(request.amount, "amount", currency.decimalPlaces);
        if (amount <= 0n) throw invalid("amount");
        const [result] = await tx.query("INSERT INTO ap_payments SET ?", [{
          supplier_id: supplier.supplierId, supplier_code_snapshot: supplier.supplierCode, supplier_name_snapshot: supplier.supplierName,
          currency_code: currency.code, currency_decimal_places: currency.decimalPlaces, payment_date: request.paymentDate, amount: request.amount,
          available_amount: request.amount, payment_method: request.paymentMethod, reference: request.reference, notes: request.notes,
          created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
        }]);
        const id = Number(result.insertId);
        return { summary: { id, number: null, status: "DRAFT", version: 1 },
          audit: { action: "payment.created", targetType: "PAYMENT", targetId: id, supplierId: supplier.supplierId, detail: { amount: request.amount, currencyCode: currency.code } } };
      });
  }

  /** 確認：取號，其後可核銷。付款日期在未來的草稿不可確認，亦不取號。 */
  confirm(command) {
    return this.#transition(command, { commandType: "CONFIRM_PAYMENT", from: "DRAFT", action: "payment.confirmed" }, async (tx, payment, { actor, nowMs }) => {
      this.#notInFuture(payment.payment_date, nowMs);
      const number = await nextDocumentNumber(tx, { documentType: "PAYMENT", time: this.time, nowMs });
      return { number, changes: { status: "CONFIRMED", payment_number: number, confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs } };
    });
  }

  /** 取消草稿。 */
  cancel(command) {
    return this.#transition(command, { commandType: "CANCEL_PAYMENT", from: "DRAFT", action: "payment.cancelled" }, async () => ({ changes: { status: "CANCELLED" } }));
  }

  /** 作廢付款：只有已確認而且沒有任何有效核銷的付款可以作廢，須原因；號碼保留不重用，作廢後不可再核銷。 */
  void(command) {
    return this.#transition(command, { commandType: "VOID_PAYMENT", from: "CONFIRMED", action: "payment.voided", needsReason: true }, async (tx, payment, { actor, nowMs }, request) => {
      if (storedUnits(payment.allocated_amount) !== 0n) throw apError("AP_PAYMENT_HAS_ALLOCATIONS");
      return { changes: { status: "VOID", allocated_amount: "0.0000", available_amount: "0.0000", void_reason: request.reason,
        voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs } };
    });
  }

  /** 把已確認的付款核銷到同供應商同幣別的一張或多張已確認發票；可部分核銷。 */
  allocate({ claims, paymentId, input, context }) {
    const id = positiveId(paymentId, "paymentId"), body = onlyFields(input, ["eventId", "version", "allocations"]);
    if (!Array.isArray(body.allocations) || body.allocations.length < 1 || body.allocations.length > MAX_ALLOCATIONS) throw invalid("allocations");
    const allocations = body.allocations.map((item, index) => {
      const row = onlyFields(item, ["invoiceId", "amount"], `allocations.${index}`);
      return { invoiceId: positiveId(row.invoiceId, `allocations.${index}.invoiceId`), amount: formatUnits(amountUnits(row.amount, `allocations.${index}.amount`)) };
    });
    if (new Set(allocations.map((item) => item.invoiceId)).size !== allocations.length) throw invalid("allocations");
    const request = { version: positiveId(body.version, "version"), allocations };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "ALLOCATE_PAYMENT", targetType: "PAYMENT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        const payment = await this.#lock(tx, id, request.version, "CONFIRMED");
        const invoiceIds = allocations.map((item) => item.invoiceId).sort((a, b) => a - b);
        const [invoiceRows] = await tx.query(`SELECT id, status, supplier_id, currency_code, allocated_amount, outstanding_amount FROM ap_invoices
          WHERE id IN (${placeholders(invoiceIds)}) ORDER BY id FOR UPDATE`, invoiceIds);
        const invoices = new Map(invoiceRows.map((row) => [Number(row.id), row]));

        let total = 0n;
        const applied = [];
        for (const [index, item] of allocations.entries()) {
          const invoice = invoices.get(item.invoiceId), field = `allocations.${index}`;
          if (!invoice) throw apError("AP_INVOICE_NOT_FOUND", { field });
          if (invoice.status !== "CONFIRMED") throw apError("AP_STATE_CONFLICT", { field });
          if (Number(invoice.supplier_id) !== Number(payment.supplier_id) || invoice.currency_code !== payment.currency_code) throw apError("AP_PARTY_MISMATCH", { field });
          const amount = amountUnits(item.amount, `${field}.amount`, Number(payment.currency_decimal_places)), outstanding = storedUnits(invoice.outstanding_amount);
          if (amount <= 0n) throw invalid(`${field}.amount`);
          if (amount > outstanding) throw apError("AP_ALLOCATION_EXCEEDS_OUTSTANDING", { field });
          total += amount;
          await tx.query("UPDATE ap_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?",
            [formatUnits(storedUnits(invoice.allocated_amount) + amount), formatUnits(outstanding - amount), nowMs, item.invoiceId]);
          const [result] = await tx.query("INSERT INTO ap_payment_allocations SET ?", [{ payment_id: id, invoice_id: item.invoiceId, amount: item.amount,
            created_by: actor.id, created_by_label: actor.username, created_at: nowMs }]);
          applied.push({ allocationId: Number(result.insertId), invoiceId: item.invoiceId, amount: item.amount });
        }
        if (total > storedUnits(payment.available_amount)) throw apError("AP_ALLOCATION_EXCEEDS_AVAILABLE");
        const summary = await this.#move(tx, payment, total, nowMs);
        return { summary: { ...summary, allocationIds: applied.map((item) => item.allocationId) },
          audit: { action: "payment.allocated", targetType: "PAYMENT", targetId: id, supplierId: Number(payment.supplier_id), label: payment.payment_number, detail: { version: summary.version, allocations: applied } } };
      });
  }

  /** 解除一筆核銷：金額回到付款的可核銷額及發票的未付額；記錄保留為 UNAPPLIED。 */
  unapply({ claims, paymentId, allocationId, input, context }) {
    const id = positiveId(paymentId, "paymentId"), allocation = positiveId(allocationId, "allocationId");
    const body = onlyFields(input, ["eventId", "version"]), request = { allocationId: allocation, version: positiveId(body.version, "version") };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "UNAPPLY_ALLOCATION", targetType: "PAYMENT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        const payment = await this.#lock(tx, id, request.version, "CONFIRMED");
        // 持有付款列後讀發票 ID，再鎖發票及核銷，沿用付款 → 發票 → 核銷。
        const [[found]] = await tx.query("SELECT invoice_id FROM ap_payment_allocations WHERE id = ? AND payment_id = ?", [allocation, id]);
        if (!found) throw apError("AP_ALLOCATION_NOT_FOUND");
        const [[invoice]] = await tx.query("SELECT id, allocated_amount, outstanding_amount FROM ap_invoices WHERE id = ? FOR UPDATE", [found.invoice_id]);
        const [[row]] = await tx.query("SELECT amount, status FROM ap_payment_allocations WHERE id = ? FOR UPDATE", [allocation]);
        if (!invoice || !row || row.status !== "ACTIVE") throw apError("AP_STATE_CONFLICT");

        const amount = storedUnits(row.amount);
        await tx.query("UPDATE ap_invoices SET allocated_amount = ?, outstanding_amount = ?, version = version + 1, updated_at = ? WHERE id = ?",
          [formatUnits(storedUnits(invoice.allocated_amount) - amount), formatUnits(storedUnits(invoice.outstanding_amount) + amount), nowMs, invoice.id]);
        await tx.query("UPDATE ap_payment_allocations SET status = 'UNAPPLIED', unapplied_by = ?, unapplied_by_label = ?, unapplied_at = ? WHERE id = ?",
          [actor.id, actor.username, nowMs, allocation]);
        const summary = await this.#move(tx, payment, -amount, nowMs);
        return { summary: { ...summary, allocationId: allocation },
          audit: { action: "payment.unapplied", targetType: "ALLOCATION", targetId: allocation, supplierId: Number(payment.supplier_id), label: payment.payment_number,
            detail: { version: summary.version, paymentId: id, invoiceId: Number(invoice.id), amount: formatUnits(amount) } } };
      });
  }

  /** 業務日期不可晚於應用時區的今日（與帳齡表及編號同一個時鐘）。 */
  #notInFuture(paymentDate, nowMs) {
    if (paymentDate > this.time.fileDate(this.time.at(nowMs))) throw apError("AP_DATE_IN_FUTURE", { field: "paymentDate" });
  }

  /** 鎖付款並驗版本及狀態。 */
  async #lock(tx, id, version, status) {
    const [[payment]] = await tx.query(`SELECT id, payment_number, status, version, supplier_id, currency_code, currency_decimal_places, allocated_amount, available_amount,
      DATE_FORMAT(payment_date, '%Y-%m-%d') AS payment_date FROM ap_payments WHERE id = ? FOR UPDATE`, [id]);
    if (!payment) throw apError("AP_PAYMENT_NOT_FOUND");
    if (Number(payment.version) !== version) throw apError("VERSION_CONFLICT", { currentVersion: Number(payment.version) });
    if (payment.status !== status) throw apError("AP_STATE_CONFLICT");
    return payment;
  }

  /** 把 `delta` 由可核銷額移到已核銷額（負數為移回），版本加一。 */
  async #move(tx, payment, delta, nowMs) {
    const allocated = formatUnits(storedUnits(payment.allocated_amount) + delta), available = formatUnits(storedUnits(payment.available_amount) - delta);
    const version = Number(payment.version) + 1;
    await tx.query("UPDATE ap_payments SET allocated_amount = ?, available_amount = ?, version = ?, updated_at = ? WHERE id = ?", [allocated, available, version, nowMs, payment.id]);
    return { id: Number(payment.id), number: payment.payment_number, status: payment.status, version, allocatedAmount: allocated, availableAmount: available };
  }

  /** 只改狀態的命令：鎖付款、驗版本及來源狀態、寫入 `changes`。 */
  #transition({ claims, paymentId, input, context }, { commandType, from, action, needsReason = false }, changesFor) {
    const id = positiveId(paymentId, "paymentId"), body = onlyFields(input, ["eventId", "version", ...(needsReason ? ["reason"] : [])]);
    const request = { version: positiveId(body.version, "version"), ...(needsReason ? { reason: validReason(body.reason) } : {}) };
    return this.commands.run({ claims, permission: PERMISSION, commandType, targetType: "PAYMENT", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, command) => {
        const payment = await this.#lock(tx, id, request.version, from);
        const { changes, number = payment.payment_number } = await changesFor(tx, payment, command, request);
        const version = request.version + 1;
        await tx.query("UPDATE ap_payments SET ? WHERE id = ?", [{ ...changes, version, updated_at: command.nowMs }, id]);
        return { summary: { id, number, status: changes.status, version },
          audit: { action, targetType: "PAYMENT", targetId: id, supplierId: Number(payment.supplier_id), label: number ?? "", reason: request.reason, detail: { version } } };
      });
  }
}
