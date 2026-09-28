import { inventoryError } from "./inventoryErrors.js";
import { inventoryPositiveInteger } from "./inventoryValidation.js";

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortKey(row) {
  if (row.expiryDate) return [0, row.expiryDate, row.lotKey, row.firstReceiptDate, row.binCode, row.id];
  if (row.lotId !== null) return [1, row.firstReceiptDate, row.lotKey, row.binCode, row.id];
  return [2, row.fifoAnchorDate, row.binCode, row.id];
}

export function rankInventoryCandidates(rows) {
  return [...rows].sort((left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    for (let index = 0; index < a.length; index += 1) {
      const order = compare(a[index], b[index]);
      if (order) return order;
    }
    return 0;
  });
}

export function recommendInventoryCandidates(candidates, requestedQuantity) {
  let remaining = inventoryPositiveInteger(requestedQuantity);
  const recommended = [];
  for (const candidate of candidates) {
    const quantity = Math.min(remaining, candidate.freeQuantity);
    if (quantity > 0) recommended.push({ balanceId: candidate.id, quantity });
    remaining -= quantity;
    if (remaining === 0) return recommended;
  }
  throw inventoryError("ALLOCATION_INSUFFICIENT", { requested: requestedQuantity });
}
