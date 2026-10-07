import { lineAmount, normalizeMoney } from "./salesMoneyMath.js";
import { orderedBaseQuantity } from "./salesQuantityMath.js";
import { salesError } from "./salesErrors.js";

export async function prepareSalesDocument(tx, document, nowMs, { customers, items, businessMaster }) {
    let customer;
    try { customer = await customers.getSalesSnapshotInTransaction(tx, document.customerId, { atMs: nowMs }); }
    catch (error) { if (error.code === "CUSTOMER_NOT_FOUND") throw salesError("CUSTOMER_NOT_SALEABLE"); throw error; }
    if (customer.status !== "active") throw salesError("CUSTOMER_NOT_SALEABLE");
    const termId = document.paymentTermId === undefined ? customer.defaultPaymentTermId : document.paymentTermId;
    let term;
    try {
      await businessMaster.assertCurrencyUsableInTransaction(tx, { code: document.currencyCode });
      if (termId !== null && termId !== undefined) term = await businessMaster.assertPaymentTermUsableInTransaction(tx, { id: termId });
    } catch (error) {
      if (["CURRENCY_NOT_ACTIVE", "PAYMENT_TERM_NOT_ACTIVE"].includes(error.code)) throw salesError("SALES_INPUT_INVALID", { field: error.code === "CURRENCY_NOT_ACTIVE" ? "currencyCode" : "paymentTermId" });
      throw error;
    }
    let snapshots;
    try { snapshots = await items.getSalesSnapshotsInTransaction(tx, document.lines, { atMs: nowMs }); }
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
    return { customer, term, lines, snapshots };
}
