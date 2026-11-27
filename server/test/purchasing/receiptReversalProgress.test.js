import assert from "node:assert/strict";
import test from "node:test";
import { planReceiptReversal } from "../../src/modules/purchasing/receiptReversalProgress.js";

function receipt(status = "FULLY_RECEIVED") {
  return {
    order: { id: 11, status },
    receipt: { id: 12, total_received_base_quantity: "10", total_reversed_base_quantity: "0" },
    purchaseLines: [{ id: 1, sku_id: 2, ordered_base_quantity: "6", net_received_base_quantity: "6",
      reversed_base_quantity: "0", closed_remaining_base_quantity: "0", closed_at: null },
    { id: 3, sku_id: 4, ordered_base_quantity: "4", net_received_base_quantity: "4",
      reversed_base_quantity: "0", closed_remaining_base_quantity: "0", closed_at: null }],
    receiptLines: [{ id: 23, sku_id: 2, purchase_order_line_id: 1 }, { id: 24, sku_id: 4, purchase_order_line_id: 3 }],
    details: [{ id: 25, goods_receipt_id: 12, purchase_order_id: 11, goods_receipt_line_id: 23, purchase_order_line_id: 1,
      sku_id: 2, inventory_movement_id: 100, received_base_quantity: "6", reversed_base_quantity: "0" },
    { id: 26, goods_receipt_id: 12, purchase_order_id: 11, goods_receipt_line_id: 24, purchase_order_line_id: 3,
      sku_id: 4, inventory_movement_id: 101, received_base_quantity: "4", reversed_base_quantity: "0" }]
  };
}
const request = (...quantities) => quantities.map(([goodsReceiptDetailId, baseQuantity]) => ({ goodsReceiptDetailId, baseQuantity }));
const noneReturned = new Map([["25", "0"], ["26", "0"]]);

test("收貨沖銷投影重算收貨及採購淨量，完整沖銷回到已確認，人工結案維持結案", () => {
  const partial = planReceiptReversal(receipt(), request([25, 2]), new Map([["25", "1"]]));
  assert.deepEqual([partial.receiptStatus, partial.orderStatus, partial.hasOutstanding, partial.quantity, partial.totalReversed, partial.purchaseLines],
    ["PARTIALLY_REVERSED", "PARTIALLY_RECEIVED", true, "2", "2", [{ id: 1, net: "4", reversed: "2", outstanding: true, over: false }]]);
  const full = planReceiptReversal(receipt(), request([25, 6], [26, 4]), noneReturned);
  assert.deepEqual([full.receiptStatus, full.orderStatus, full.totalReversed], ["REVERSED", "CONFIRMED", "10"]);
  const closed = planReceiptReversal(receipt("CLOSED"), request([25, 6], [26, 4]), noneReturned);
  assert.deepEqual([closed.orderStatus, closed.hasOutstanding, closed.purchaseLines.map(line => line.outstanding)], ["CLOSED", false, [false, false]]);
});

test("收貨沖銷拒絕跨收貨明細、缺少退回證據及退回與沖銷合計超限", () => {
  assert.throws(() => planReceiptReversal(receipt(), request([99, 1]), new Map([["99", "0"]])), { code: "GOODS_RECEIPT_NOT_FOUND" });
  assert.throws(() => planReceiptReversal(receipt(), request([25, 1]), new Map()), { code: "PURCHASING_DEPENDENCY_UNAVAILABLE" });
  assert.throws(() => planReceiptReversal(receipt(), request([25, 6]), new Map([["25", "1"]])), { code: "GR_REVERSAL_QUANTITY_EXCEEDED" });
});
