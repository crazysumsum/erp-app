import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function confirmedSupplierReceipt(f, api, originalBinId) {
  const { db, s, userId } = f;
  const orderDate = "2025-11-01", period = "202511";
  const supplierId = await s.insert("suppliers", {
    supplier_code: "RT-SUPPLIER", supplier_code_key: "rt-supplier", supplier_name: "Synthetic supplier",
    supplier_name_key: "synthetic supplier", default_currency_code: "HKD", status: "active", created_at: s.now, updated_at: s.now
  });
  await db.query("UPDATE item_skus SET purchasable = 1 WHERE id = ?", [s.skuId]);
  const [[uom]] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [s.uomId]);
  const [[sku]] = await db.query("SELECT sku_code, sku_name FROM item_skus WHERE id = ?", [s.skuId]);
  const po = await s.insert("purchase_orders", {
    po_number: `PO-${period}-000001`, document_year_month: period, sequence_no: 1, supplier_id: supplierId,
    supplier_code_snapshot: "RT-SUPPLIER", supplier_name_snapshot: "Synthetic supplier", currency_code: "HKD",
    currency_name_snapshot: "HK Dollar", currency_decimal_places_snapshot: 2, order_date: orderDate,
    buyer_id: userId, buyer_label: "Return tester", subtotal_amount: "5.0000", total_amount: "5.0000", has_outstanding: 1,
    created_at: s.now, updated_at: s.now, created_by: userId, updated_by: userId,
    created_by_label: "Return tester", updated_by_label: "Return tester"
  });
  const poLine = await s.insert("purchase_order_lines", {
    purchase_order_id: po, line_number: 1, sku_id: s.skuId, sku_code_snapshot: sku.sku_code, sku_name_snapshot: sku.sku_name,
    inventory_tracked_snapshot: 1, base_uom_id: s.uomId, base_uom_code_snapshot: uom.code,
    purchase_sku_uom_id: s.skuUomId, purchase_uom_code_snapshot: uom.code, uom_to_base_factor_snapshot: 1,
    tracking_policy_snapshot: "none", ordered_quantity: "5", ordered_base_quantity: 5, unit_price: "1.0000", line_amount: "5.0000",
    has_outstanding: 1, created_at: s.now, updated_at: s.now
  });
  await db.query("UPDATE purchase_orders SET status = 'CONFIRMED', confirmed_at = ? WHERE id = ?", [s.now, po]);
  const send = async (path, input) => {
    const eventId = randomUUID();
    const response = await api("POST", path, { eventId, ...input }, { key: eventId });
    assert.equal(response.status, path.endsWith("/create") ? 201 : 200, JSON.stringify(response.body));
    return response.body.data;
  };
  const draft = await send("/api/v1/goods-receipts/create", {
    purchaseOrderId: Number(po), businessReceiptDate: orderDate
  });
  const receipt = await send(`/api/v1/goods-receipts/${draft.id}/confirm`, {
    version: 1, businessReceiptDate: orderDate,
    lines: [{ purchaseOrderLineId: Number(poLine), details: [{
      inputUomId: Number(s.uomId), receivedQuantity: "5", warehouseId: Number(s.warehouseId),
      binId: Number(originalBinId), stockStatus: "AVAILABLE"
    }] }]
  });
  const [[detail]] = await db.query("SELECT * FROM goods_receipt_details WHERE goods_receipt_id = ?", [receipt.id]);
  return { receipt, detail };
}
