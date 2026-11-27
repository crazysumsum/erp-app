import { purchasingError } from "./purchasingErrors.js";

const unavailable = () => purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
const byId = rows => new Map(rows.map(row => [Number(row.id), row]));

function quantity(value) {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return BigInt(value);
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw unavailable();
}

/** Build the projections that will be written after Inventory accepts the whole batch. */
export function planReceiptReversal({ order, receipt, purchaseLines, receiptLines, details }, requested, returned) {
  const poLines = byId(purchaseLines), grLines = byId(receiptLines), physical = byId(details);
  const numberReceived = quantity(receipt.total_received_base_quantity);
  const alreadyReversed = quantity(receipt.total_reversed_base_quantity);
  let detailReceived = 0n, detailReversed = 0n;
  for (const detail of details) {
    detailReceived += quantity(detail.received_base_quantity);
    detailReversed += quantity(detail.reversed_base_quantity);
  }
  if (detailReceived !== numberReceived || detailReversed !== alreadyReversed || !(returned instanceof Map)) throw unavailable();

  const byPurchaseLine = new Map();
  let added = 0n;
  const reversedDetails = requested.map(({ goodsReceiptDetailId, baseQuantity }) => {
    const detail = physical.get(goodsReceiptDetailId);
    if (!detail) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
    const poLineId = Number(detail.purchase_order_line_id), skuId = Number(detail.sku_id);
    const poLine = poLines.get(poLineId), grLine = grLines.get(Number(detail.goods_receipt_line_id));
    const originalMovementId = Number(detail.inventory_movement_id);
    if (Number(detail.goods_receipt_id) !== Number(receipt.id) || Number(detail.purchase_order_id) !== Number(order.id) ||
        Number(poLine?.sku_id) !== skuId || Number(grLine?.sku_id) !== skuId || Number(grLine?.purchase_order_line_id) !== poLineId ||
        !Number.isSafeInteger(originalMovementId) || originalMovementId < 1) throw unavailable();

    const prior = quantity(detail.reversed_base_quantity);
    const returnedQuantity = returned.get(String(goodsReceiptDetailId));
    if (typeof returnedQuantity !== "string") throw unavailable();
    const available = quantity(detail.received_base_quantity) - prior - quantity(returnedQuantity);
    if (available < 0n) throw unavailable();
    const delta = quantity(baseQuantity);
    if (delta > available) throw purchasingError("GR_REVERSAL_QUANTITY_EXCEEDED");
    byPurchaseLine.set(poLineId, (byPurchaseLine.get(poLineId) ?? 0n) + delta);
    added += delta;
    return { id: goodsReceiptDetailId, poLineId, skuId, originalMovementId, baseQuantity, reversed: String(prior + delta) };
  });

  let hasOutstanding = false, hasReceived = false;
  const updatedLines = [];
  for (const line of purchaseLines) {
    const id = Number(line.id), delta = byPurchaseLine.get(id) ?? 0n;
    const ordered = quantity(line.ordered_base_quantity);
    const net = quantity(line.net_received_base_quantity) - delta;
    if (net < 0n) throw unavailable();
    const outstanding = order.status !== "CLOSED" && line.closed_at === null && net + quantity(line.closed_remaining_base_quantity) < ordered;
    hasOutstanding ||= outstanding;
    hasReceived ||= net > 0n;
    if (delta > 0n) updatedLines.push({
      id, net: String(net), reversed: String(quantity(line.reversed_base_quantity) + delta), outstanding, over: net > ordered
    });
  }
  const orderStatus = order.status === "CLOSED" ? "CLOSED" : !hasOutstanding ? "FULLY_RECEIVED" : hasReceived ? "PARTIALLY_RECEIVED" : "CONFIRMED";
  const totalReversed = alreadyReversed + added;
  return {
    receiptStatus: totalReversed === numberReceived ? "REVERSED" : "PARTIALLY_REVERSED",
    orderStatus, hasOutstanding, quantity: String(added), totalReversed: String(totalReversed),
    details: reversedDetails, purchaseLines: updatedLines
  };
}
