import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { SalesSequenceService } from "./SalesSequenceService.js";
import { SalesOperationService } from "./SalesOperationService.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { requireSalesWriteActor } from "./salesAuthorization.js";
import { validateSalesDocument } from "./salesValidation.js";
import { assertQuotationEditable } from "./salesQuotationStateMachine.js";
import { documentTotal, lineAmount, normalizeMoney } from "./salesMoneyMath.js";
import { orderedBaseQuantity } from "./salesQuantityMath.js";
import { salesError } from "./salesErrors.js";

export function toQuotationDetail(row, lines) {
  return { id: Number(row.id), number: row.quotation_number, status: row.status, version: Number(row.version),
    customerId: Number(row.customer_id), customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot,
    currencyCode: row.currency_code, paymentTermId: row.payment_term_id === null ? null : Number(row.payment_term_id),
    paymentTermCode: row.payment_term_code_snapshot, paymentTermName: row.payment_term_name_snapshot,
    quotationDate: row.quotation_date, validUntil: row.valid_until, externalReference: row.external_reference, notes: row.notes,
    lineCount: Number(row.line_count), totalAmount: String(row.total_amount), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    lines: lines.map(line => ({ id: Number(line.id), lineNo: Number(line.line_no), skuId: Number(line.sku_id), skuUomId: Number(line.sku_uom_id),
      itemName: line.item_name_snapshot, skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot,
      uomCode: line.uom_code_snapshot, uomName: line.uom_name_snapshot, toBaseFactor: Number(line.to_base_factor_snapshot),
      quantity: String(line.quantity), baseQuantity: Number(line.base_quantity), unitSellingPrice: String(line.unit_selling_price),
      priceSource: line.price_source, lineAmount: String(line.line_amount), lineNote: line.line_note })) };
}

export class SalesQuotationService {
  constructor({ database, time, logger, customerProvider, itemProvider, businessMaster, audit } = {}) {
    this.database = database; this.time = time;
    this.customers = customerProvider ?? new CustomerLookupService({ database });
    this.items = itemProvider ?? new ItemLookupService({ database, time, logger });
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    this.sequence = new SalesSequenceService({ time }); this.operations = new SalesOperationService(); this.audit = audit ?? new SalesAuditService();
  }
  authorizeWrite(claims) { return this.database.withTransaction(tx => requireSalesWriteActor(tx, claims)).then(() => true); }
  create(request) { return this.#save(request, false); }
  update(request) { return this.#save(request, true); }

  async #save({ claims, input, id, trace = {} }, update) {
    if (update && (!Number.isSafeInteger(id) || id < 1)) throw salesError("SALES_INPUT_INVALID", { field: "id" });
    return this.operations.run(this.database, async tx => {
      const actor = await requireSalesWriteActor(tx, claims);
      const { document, warnings } = validateSalesDocument(input, { kind: "quotation", update });
      const { eventId, ...payload } = document, nowMs = this.time.nowMs();
      const claim = await this.operations.claim(tx, { eventId, commandType: update ? "UPDATE_QUOTATION" : "CREATE_QUOTATION",
        targetId: update ? id : null, payload, actor, nowMs, requestId: trace.requestId, correlationId: trace.correlationId });
      if (claim.replay) return { quotation: await this.#detail(tx, claim.replay.id), operation: claim.replay, warnings: [] };
      let number, version;
      if (update) {
        const [[before]] = await tx.query("SELECT id,quotation_number,status,version FROM sales_quotations WHERE id=? FOR UPDATE", [id]);
        if (!before) throw salesError("SALES_QUOTATION_NOT_FOUND");
        assertQuotationEditable(before.status);
        if (Number(before.version) !== document.version) throw salesError("VERSION_CONFLICT", { currentVersion: Number(before.version) });
        number = before.quotation_number; version = document.version + 1;
        const [existing] = await tx.query("SELECT id,sku_id,sku_uom_id FROM sales_quotation_lines WHERE quotation_id=? ORDER BY id FOR UPDATE", [id]);
        for (const line of input.lines) if (line.id !== undefined && !existing.some(row => Number(row.id) === line.id && Number(row.sku_id) === line.skuId && Number(row.sku_uom_id) === line.skuUomId)) throw salesError("SALES_INPUT_INVALID", { field: "lines" });
      } else { number = await this.sequence.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs }); version = 1; }
      const prepared = await this.#prepare(tx, document, nowMs);
      const header = { customer_id: document.customerId, customer_code_snapshot: prepared.customer.customerCode,
        customer_name_snapshot: prepared.customer.legalName, currency_code: document.currencyCode, payment_term_id: prepared.term?.id ?? null,
        payment_term_code_snapshot: prepared.term?.code ?? "", payment_term_name_snapshot: prepared.term?.name ?? "",
        quotation_date: document.quotationDate, valid_until: document.validUntil, external_reference: document.externalReference, notes: document.notes,
        line_count: prepared.lines.length, total_amount: documentTotal(prepared.lines.map(line => line.line_amount)), version,
        updated_at: nowMs, last_business_updated_at: nowMs, updated_by: actor.id };
      if (update) {
        const [written] = await tx.execute(`UPDATE sales_quotations SET ${Object.keys(header).map(field => `${field}=?`).join(",")}
          WHERE id=? AND version=? AND status='DRAFT'`, [...Object.values(header), id, document.version]);
        if (written.affectedRows !== 1) throw salesError("VERSION_CONFLICT", { currentVersion: document.version });
        await tx.execute("DELETE FROM sales_quotation_lines WHERE quotation_id=?", [id]);
      } else {
        const row = { quotation_number: number, status: "DRAFT", ...header, created_at: nowMs, created_by: actor.id };
        const [inserted] = await tx.execute(`INSERT INTO sales_quotations (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, Object.values(row));
        id = Number(inserted.insertId);
      }
      for (const [index, line] of prepared.lines.entries()) {
        const row = { quotation_id: id, line_no: index + 1, ...line, created_at: nowMs, updated_at: nowMs };
        await tx.execute(`INSERT INTO sales_quotation_lines (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, Object.values(row));
      }
      await this.audit.record(tx, { actor, action: update ? "sales_quotation.updated" : "sales_quotation.created", targetId: id,
        targetNumber: number, eventId, nowMs, requestId: trace.requestId, correlationId: trace.correlationId, ipAddress: trace.ipAddress,
        details: { version, lineCount: header.line_count, totalAmount: header.total_amount, currencyCode: document.currencyCode } });
      const result = { id, number, status: "DRAFT", version };
      await this.operations.succeed(tx, { operationId: claim.operationId, result, nowMs });
      if (document.currencyCode !== prepared.customer.defaultCurrencyCode) warnings.push({ code: "CUSTOMER_CURRENCY_DIFFERENT", field: "currencyCode" });
      return { quotation: await this.#detail(tx, id), operation: result, warnings };
    });
  }

  async #prepare(tx, document, nowMs) {
    let customer;
    try { customer = await this.customers.getSalesSnapshotInTransaction(tx, document.customerId, { atMs: nowMs }); }
    catch (error) { if (error.code === "CUSTOMER_NOT_FOUND") throw salesError("CUSTOMER_NOT_SALEABLE"); throw error; }
    if (customer.status !== "active") throw salesError("CUSTOMER_NOT_SALEABLE");
    const termId = document.paymentTermId === undefined ? customer.defaultPaymentTermId : document.paymentTermId;
    let term;
    try {
      await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: document.currencyCode });
      if (termId !== null && termId !== undefined) term = await this.businessMaster.assertPaymentTermUsableInTransaction(tx, { id: termId });
    } catch (error) {
      if (["CURRENCY_NOT_ACTIVE", "PAYMENT_TERM_NOT_ACTIVE"].includes(error.code)) throw salesError("SALES_INPUT_INVALID", { field: error.code === "CURRENCY_NOT_ACTIVE" ? "currencyCode" : "paymentTermId" });
      throw error;
    }
    let snapshots;
    try { snapshots = await this.items.getSalesSnapshotsInTransaction(tx, document.lines, { atMs: nowMs }); }
    catch (error) {
      if (["SKU_NOT_FOUND", "SKU_NOT_USABLE"].includes(error.code)) throw salesError("SKU_NOT_SALEABLE");
      if (error.code === "UOM_CONVERSION_INVALID") throw salesError("SKU_UOM_INVALID");
      throw error;
    }
    const lines = document.lines.map(line => {
      const snapshot = snapshots.find(row => row.skuId === line.skuId && row.salesUom.skuUomId === line.skuUomId);
      if (!snapshot) throw salesError("SKU_UOM_INVALID");
      return { sku_id: line.skuId, sku_uom_id: line.skuUomId, item_name_snapshot: snapshot.itemName, sku_code_snapshot: snapshot.skuCode,
        sku_name_snapshot: snapshot.skuName, uom_code_snapshot: snapshot.salesUom.uomCode, uom_name_snapshot: snapshot.salesUom.uomName,
        to_base_factor_snapshot: snapshot.salesUom.toBaseFactor, quantity: line.quantity, base_quantity: orderedBaseQuantity(line.quantity, snapshot.salesUom.toBaseFactor),
        unit_selling_price: line.unitSellingPrice, price_source: snapshot.suggestedPrice?.currency === document.currencyCode &&
          normalizeMoney(snapshot.suggestedPrice.amount) === line.unitSellingPrice ? "SUGGESTED" : "MANUAL",
        line_amount: lineAmount(line.quantity, line.unitSellingPrice), line_note: line.lineNote };
    });
    return { customer, term, lines };
  }

  async #detail(tx, id) {
    const [[row]] = await tx.query(`SELECT id,quotation_number,status,version,customer_id,customer_code_snapshot,customer_name_snapshot,currency_code,
      payment_term_id,payment_term_code_snapshot,payment_term_name_snapshot,DATE_FORMAT(quotation_date,'%Y-%m-%d') AS quotation_date,
      DATE_FORMAT(valid_until,'%Y-%m-%d') AS valid_until,external_reference,notes,line_count,total_amount,created_at,updated_at FROM sales_quotations WHERE id=? LOCK IN SHARE MODE`, [id]);
    if (!row) throw salesError("SALES_QUOTATION_NOT_FOUND");
    const [lines] = await tx.query(`SELECT id,line_no,sku_id,sku_uom_id,item_name_snapshot,sku_code_snapshot,sku_name_snapshot,uom_code_snapshot,
      uom_name_snapshot,to_base_factor_snapshot,quantity,CAST(base_quantity AS CHAR) AS base_quantity,unit_selling_price,price_source,line_amount,line_note
      FROM sales_quotation_lines WHERE quotation_id=? ORDER BY line_no LOCK IN SHARE MODE`, [id]);
    return toQuotationDetail(row, lines);
  }
}
