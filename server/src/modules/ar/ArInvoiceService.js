import { eventId, formatUnits, localDate, nextDocumentNumber, onlyFields, positiveId, reason as validReason, storedUnits, text } from "./arCommand.js";
import { arError } from "./arErrors.js";

export const MAX_INVOICE_SHIPMENTS = 20; // 一張發票最多 20 張出貨（TL 裁定的技術預設，亦是 reader 的上限）。
const PERMISSION = "ar.invoice.mgmt";
const invalid = (field) => arError("AR_INPUT_INVALID", { field });

function assertInvoiceDate(invoiceDate, shipments) {
  for (const { shipmentDate } of shipments) {
    if (typeof shipmentDate !== "string") throw new TypeError("Invoice source must include a shipment date");
    if (invoiceDate < shipmentDate) throw arError("AR_INVOICE_BEFORE_SHIPMENT_DATE", { field: "invoiceDate" });
  }
}

async function draftShipmentIds(tx, invoiceId, version) {
  const [rows] = await tx.query(`SELECT DISTINCT l.shipment_id FROM ar_invoice_lines l JOIN ar_invoices i ON i.id = l.invoice_id
    WHERE i.id = ? AND i.status = 'DRAFT' AND i.version = ? ORDER BY l.shipment_id`, [invoiceId, version]);
  return rows.map(({ shipment_id }) => String(shipment_id));
}

/** Half-up 到 `step`（以萬分之一為單位）的倍數。 */
const roundHalfUp = (units, step) => (units + step / 2n) / step * step;
const currencyStep = (decimalPlaces) => 10n ** BigInt(4 - decimalPlaces);

/**
 * 發票金額的兩個取法，只在這裡定義。Sam 2026-11-19 決定，原話「採用 A」；正本在 TL 的 SCOPE.md 第 3 節（sha256 932cc24b…a5df）：
 * - `lineStep`：剩餘池分攤維持 4 位小數（BR-050，與 Sales 訂單行金額相同）。
 * - `total`：每張發票總額是各行之和 half-up 到幣別小數位（BR-014 按此修訂），令只收幣別小數位的收款收得齊。
 * 已告知的後果：單價多於幣別小數位或數量有小數的訂單分批出貨、分開開票時，各發票總額之和可與訂單相差一個最小貨幣單位。
 */
export const INVOICE_AMOUNT_POLICY = Object.freeze({
  lineStep: () => 1n,
  total: (sum, decimalPlaces) => roundHalfUp(sum, currencyStep(decimalPlaces))
});

/**
 * 一個出貨行的發票金額（Sam 已批准的剩餘池規則，按出貨確認次序）：同一訂單行的各次出貨依次從剩餘金額及剩餘數量
 * 按比例 half-up 到 `step` 取額，用盡數量的一批取餘數。輸入全部是不會再變的事實（訂單行的訂購數量及金額、
 * 較早出貨的數量），所以結果與開票的先後及是否同時開票無關。金額以萬分之一為單位的 BigInt 計算。
 * 較早的出貨可以是 0 件（該訂單行在那次出貨整行短揀；Fulfillment 的 reader 照樣回傳）：它不佔數量也不佔金額，略過。
 * 本次出貨的數量必須大於 0（0 件的行不開票，由呼叫方先行略過）。
 */
export function shipmentLineAmount({ lineAmount, orderedBaseQuantity, priorShippedBaseQuantities, shippedBaseQuantity, step = 1n }) {
  let remainingAmount = lineAmount, remainingQuantity = orderedBaseQuantity, amount = 0n;
  if (shippedBaseQuantity <= 0n) throw new RangeError("Invoiced quantity must be positive");
  for (const quantity of [...priorShippedBaseQuantities, shippedBaseQuantity]) {
    // 0 件的較早出貨通過這個檢查，下面按比例取到 0，剩餘金額及數量不變。
    if (quantity < 0n || quantity > remainingQuantity) throw new RangeError("Shipped quantity exceeds the order line");
    // 分子分母同乘 2 再加半個分母，即 half-up；先除以 step 再乘回，即取到 step 的倍數。
    amount = quantity === remainingQuantity ? remainingAmount
      : (remainingAmount * quantity * 2n + remainingQuantity * step) / (remainingQuantity * step * 2n) * step;
    remainingAmount -= amount;
    remainingQuantity -= quantity;
  }
  return amount;
}

/**
 * 由出貨生成發票（SCOPE §1、§3；TABLES §3、§4）。整張出貨開票，不拆數量；來源資料只經 Fulfillment 的
 * `readInvoiceSourcesInTransaction` 讀取（它以 ID 升序鎖出貨列並重驗 SHIPPED、同客戶及同幣別），AR 不查 Sales 或 Fulfillment 的表。
 * 取鎖次序：操作列 → 出貨列 → 發票 → 編號。防重開票由 `ar_invoice_lines.active_shipment_line_id` 的唯一鍵保證。
 */
export class ArInvoiceService {
  constructor({ commands, readInvoiceSources, customers, businessMaster, time }) {
    if (!commands || typeof readInvoiceSources !== "function" || typeof customers !== "function" || !businessMaster || !time) throw new TypeError("ArInvoiceService requires all of its dependencies");
    Object.assign(this, { commands, readInvoiceSources, customers, businessMaster, time });
  }

  /** 選同一客戶、同一幣別的一張或多張 SHIPPED 出貨，建立發票草稿。 */
  create({ claims, input, context }) {
    const body = onlyFields(input, ["eventId", "shipmentIds", "invoiceDate", "dueDate", "dueDateReason", "notes"]);
    if (!Array.isArray(body.shipmentIds) || body.shipmentIds.length < 1 || body.shipmentIds.length > MAX_INVOICE_SHIPMENTS) throw invalid("shipmentIds");
    const shipmentIds = body.shipmentIds.map((id, index) => positiveId(id, `shipmentIds.${index}`)).sort((a, b) => a - b);
    if (new Set(shipmentIds).size !== shipmentIds.length) throw invalid("shipmentIds");
    const request = {
      shipmentIds, notes: text(body.notes ?? "", "notes", { maximum: 2000, multiline: true }),
      ...(body.invoiceDate === undefined ? {} : { invoiceDate: localDate(body.invoiceDate, "invoiceDate") }),
      ...(body.dueDate === undefined ? {} : { dueDate: localDate(body.dueDate, "dueDate") }),
      ...(body.dueDateReason === undefined ? {} : { dueDateReason: validReason(body.dueDateReason, "dueDateReason") })
    };
    return this.commands.run({ claims, permission: PERMISSION, commandType: "CREATE_INVOICE", targetType: "INVOICE", eventId: eventId(body.eventId), payload: request, context },
      async (tx, { actor, nowMs }) => {
        const shipments = await this.readInvoiceSources(tx, { shipmentIds: shipmentIds.map(String) });
        const [{ customerId, currencyCode }] = shipments;
        const customer = await this.customers(tx).findById(Number(customerId), { purpose: "invoice_existing_shipment" });
        if (!customer) throw arError("AR_CUSTOMER_NOT_FOUND");
        const currency = await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: currencyCode, purpose: "history" });
        const today = this.time.fileDate(this.time.at(nowMs)), invoiceDate = request.invoiceDate ?? today;
        if (invoiceDate > today) throw arError("AR_DATE_IN_FUTURE", { field: "invoiceDate" });
        assertInvoiceDate(invoiceDate, shipments);
        const due = await this.#dueDate(tx, shipments, invoiceDate, request);

        const lines = [];
        let sum = 0n;
        for (const shipment of shipments) {
          for (const line of shipment.lines) {
            const quantity = BigInt(line.shippedBaseQuantity);
            if (quantity === 0n) continue; // 沒有出貨數量的行不開票。
            const amount = shipmentLineAmount({ lineAmount: storedUnits(line.lineAmount), orderedBaseQuantity: BigInt(line.orderedBaseQuantity),
              priorShippedBaseQuantities: line.priorShipments.map((prior) => BigInt(prior.shippedBaseQuantity)), shippedBaseQuantity: quantity,
              step: INVOICE_AMOUNT_POLICY.lineStep(currency.decimalPlaces) });
            sum += amount;
            // quantity 是基本單位，單價是每銷售單位：連同銷售單位及換算率一併保存，前端才顯示得出「多少銷售單位 × 單價」。
            lines.push([lines.length + 1, shipment.id, line.id, shipment.salesOrderId, line.salesOrderLineId, line.id, line.skuCodeSnapshot, line.skuNameSnapshot,
              line.baseUomCodeSnapshot, line.salesUomCodeSnapshot, line.toBaseFactor, line.shippedBaseQuantity, line.unitSellingPrice, formatUnits(amount)]);
          }
        }
        const total = formatUnits(INVOICE_AMOUNT_POLICY.total(sum, currency.decimalPlaces));
        const [result] = await tx.query("INSERT INTO ar_invoices SET ?", [{
          customer_id: customer.customerId, customer_code_snapshot: customer.customerCode, customer_name_snapshot: customer.legalName,
          currency_code: currency.code, currency_decimal_places: currency.decimalPlaces, invoice_date: invoiceDate, ...due,
          total_amount: total, outstanding_amount: total, notes: request.notes, created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
        }]);
        const id = Number(result.insertId);
        try {
          await tx.query(`INSERT INTO ar_invoice_lines (invoice_id, line_no, shipment_id, shipment_line_id, sales_order_id, sales_order_line_id, active_shipment_line_id,
            sku_code_snapshot, sku_name_snapshot, base_uom_code_snapshot, sales_uom_code_snapshot, to_base_factor_snapshot, quantity, unit_price_snapshot, line_amount) VALUES ?`, [lines.map((line) => [id, ...line])]);
        } catch (error) {
          // 唯一鍵：該出貨行已在另一張未作廢、未取消的發票上。
          if ((error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY") throw arError("AR_SHIPMENT_ALREADY_INVOICED");
          throw error;
        }
        return { summary: { id, number: null, status: "DRAFT", version: 1, totalAmount: total },
          audit: { action: "invoice.created", targetType: "INVOICE", targetId: id, customerId: customer.customerId,
            detail: { totalAmount: total, currencyCode: currency.code, shipmentIds, lineCount: lines.length } } };
      });
  }

  /** 確認：取號，形成應收。 */
  confirm(command) {
    return this.#transition(command, { commandType: "CONFIRM_INVOICE", from: "DRAFT", action: "invoice.confirmed", checkShipmentDate: true }, async (tx, invoice, { actor, nowMs }) => {
      const customers = this.customers(tx), customerId = Number(invoice.customer_id);
      const customer = await customers.findById(customerId, { purpose: "ar_existing_document" });
      if (!customer) throw arError("AR_CUSTOMER_NOT_FOUND");
      const address = (await customers.listAddresses(customerId, { purpose: "billing" })).find((item) => item.isDefault);
      if (!address) throw arError("AR_BILLING_ADDRESS_REQUIRED");
      const locality = [address.city, address.stateRegion, address.postalCode].filter(Boolean).join(" ");
      const snapshot = [address.recipientCompanyDepartment, address.addressLine1, address.addressLine2, address.addressLine3, locality, address.countryCode]
        .filter(Boolean).join("\n");
      const number = await nextDocumentNumber(tx, { documentType: "INVOICE", time: this.time, nowMs });
      return { number, changes: { status: "CONFIRMED", invoice_number: number, customer_name_snapshot: customer.legalName,
        billing_address_snapshot: snapshot, confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs } };
    });
  }

  /** 取消草稿：釋放其出貨行。 */
  cancel(command) {
    return this.#transition(command, { commandType: "CANCEL_INVOICE", from: "DRAFT", action: "invoice.cancelled", release: true }, async () => ({ changes: { status: "CANCELLED" } }));
  }

  /** 作廢已確認的發票：須原因，須先解除其全部核銷；作廢後該出貨可重新開票，號碼保留不重用。 */
  void(command) {
    return this.#transition(command, { commandType: "VOID_INVOICE", from: "CONFIRMED", action: "invoice.voided", needsReason: true, release: true }, async (tx, invoice, { actor, nowMs }, request) => {
      if (storedUnits(invoice.allocated_amount) !== 0n) throw arError("AR_INVOICE_HAS_ALLOCATIONS");
      return { changes: { status: "VOID", void_reason: request.reason, voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs } };
    });
  }

  /**
   * 到期日：發票日期加付款條款現行的日數（PM 決定：首期讀現行值，開票時寫入發票，其後條款改動不影響）。
   * 所選出貨的訂單都用同一個可計算的條款時才有預設值；否則必須輸入。輸入的日子與預設值不同即視為人手修改，須原因。
   */
  async #dueDate(tx, shipments, invoiceDate, request) {
    const terms = new Map(shipments.map((shipment) => [shipment.paymentTerm?.id ?? "", shipment.paymentTerm]));
    const term = terms.size === 1 ? [...terms.values()][0] : null;
    const calculated = term ? (await this.businessMaster.calculateDueDateInTransaction(tx, { id: Number(term.id), baseDate: invoiceDate, purpose: "history" })).dueDate : null;
    const dueDate = request.dueDate ?? calculated;
    if (!dueDate) throw arError("AR_DUE_DATE_REQUIRED");
    if (dueDate < invoiceDate) throw invalid("dueDate");
    const overridden = calculated !== null && dueDate !== calculated;
    if (overridden && !request.dueDateReason) throw invalid("dueDateReason");
    return { due_date: dueDate, due_date_overridden: overridden ? 1 : 0, due_date_reason: overridden ? request.dueDateReason : "",
      payment_term_code_snapshot: term?.code ?? "", payment_term_name_snapshot: term?.name ?? "" };
  }

  /** 只改狀態的命令：鎖發票、驗版本及來源狀態、寫入 `changes`；`release` 時在同一交易釋放出貨行。 */
  #transition({ claims, invoiceId, input, context }, { commandType, from, action, needsReason = false, release = false, checkShipmentDate = false }, changesFor) {
    const id = positiveId(invoiceId, "invoiceId"), body = onlyFields(input, ["eventId", "version", ...(needsReason ? ["reason"] : [])]);
    const request = { version: positiveId(body.version, "version"), ...(needsReason ? { reason: validReason(body.reason) } : {}) };
    return this.commands.run({ claims, permission: PERMISSION, commandType, targetType: "INVOICE", targetId: id, eventId: eventId(body.eventId), payload: request, context },
      async (tx, command) => {
        // 確認時依出貨 → 發票的鎖序取得來源，鎖住發票後再核對實際來源。
        const shipmentIds = checkShipmentDate ? await draftShipmentIds(tx, id, request.version) : [];
        const shipments = shipmentIds.length ? await this.readInvoiceSources(tx, { shipmentIds }) : [];
        const [[invoice]] = await tx.query(`SELECT id, invoice_number, status, version, customer_id, allocated_amount,
          DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date FROM ar_invoices WHERE id = ? FOR UPDATE`, [id]);
        if (!invoice) throw arError("AR_INVOICE_NOT_FOUND");
        if (Number(invoice.version) !== request.version) throw arError("VERSION_CONFLICT", { currentVersion: Number(invoice.version) });
        if (invoice.status !== from) throw arError("AR_STATE_CONFLICT");
        if (checkShipmentDate) {
          const currentShipmentIds = await draftShipmentIds(tx, id, request.version);
          if (!currentShipmentIds.length || currentShipmentIds.length !== shipmentIds.length ||
              currentShipmentIds.some((shipmentId, index) => shipmentId !== shipmentIds[index])) {
            throw arError("AR_STATE_CONFLICT");
          }
          assertInvoiceDate(invoice.invoice_date, shipments);
        }
        const { changes, number = invoice.invoice_number } = await changesFor(tx, invoice, command, request);
        const version = request.version + 1;
        await tx.query("UPDATE ar_invoices SET ? WHERE id = ?", [{ ...changes, version, updated_at: command.nowMs }, id]);
        if (release) await tx.query("UPDATE ar_invoice_lines SET active_shipment_line_id = NULL WHERE invoice_id = ?", [id]);
        return { summary: { id, number, status: changes.status, version },
          audit: { action, targetType: "INVOICE", targetId: id, customerId: Number(invoice.customer_id), label: number ?? "", reason: request.reason, detail: { version } } };
      });
  }
}
