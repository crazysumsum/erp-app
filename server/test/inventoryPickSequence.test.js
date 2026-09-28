import assert from "node:assert/strict";
import test from "node:test";

import {
  loadInventoryCandidates,
  rankInventoryCandidates,
  recommendInventoryCandidates
} from "../src/modules/inventory/InventoryPickSequenceService.js";

test("TASK-021 ranks expiry lots before lot and no-lot FIFO with stable bin and balance ties", () => {
  const rows = [
    { id: 8, lotId: null, fifoAnchorDate: "2026-01-01", binCode: "A", freeQuantity: 2 },
    { id: 7, lotId: 7, firstReceiptDate: "2026-01-02", lotKey: "B", binCode: "A", freeQuantity: 2 },
    { id: 6, lotId: 6, expiryDate: "2026-11-01", firstReceiptDate: "2026-01-01", lotKey: "A", binCode: "A", freeQuantity: 2 },
    { id: 5, lotId: 5, expiryDate: "2026-10-01", firstReceiptDate: "2026-01-01", lotKey: "A", binCode: "B", freeQuantity: 4 },
    { id: 4, lotId: 5, expiryDate: "2026-10-01", firstReceiptDate: "2026-01-01", lotKey: "A", binCode: "A", freeQuantity: 3 },
    { id: 9, lotId: null, fifoAnchorDate: "2026-01-01", binCode: "A", freeQuantity: 1 }
  ];
  const ranked = rankInventoryCandidates(rows);
  assert.deepEqual(ranked.map(({ id }) => id), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(recommendInventoryCandidates(ranked, 6), [
    { balanceId: 4, quantity: 3 }, { balanceId: 5, quantity: 3 }
  ]);
});

test("TASK-021 candidate query is scoped, eligible, versioned and bounded", async () => {
  const calls = [];
  const transaction = { async query(sql, params) {
    calls.push({ sql, params });
    return [[{
      id: 4, bin_id: 3, lot_id: 5, version: 2, on_hand_quantity: 8,
      allocated_quantity: 3, bin_code: "A", normalized_lot_number: "lot-5",
      expiry_date: "2026-11-01", first_receipt_date: "2026-09-01", fifo_anchor_date: null
    }, {
      id: 5, bin_id: 4, lot_id: 6, version: 1, on_hand_quantity: 8,
      allocated_quantity: 0, bin_code: "B", normalized_lot_number: "lot-6",
      expiry_date: "2026-10-27", first_receipt_date: "2026-09-01", fifo_anchor_date: null
    }]];
  } };
  const rows = await loadInventoryCandidates(transaction, {
    warehouseId: 2, skuId: 12, currentDate: "2026-09-28", minimumRemainingDays: 30,
    trackingPolicy: "batch_expiry", limit: 101
  });
  assert.deepEqual(rows.map(({ id, binId, freeQuantity, version }) => ({ id, binId, freeQuantity, version })),
    [{ id: 4, binId: 3, freeQuantity: 5, version: 2 }]);
  assert.match(calls[0].sql, /b\.stock_status = 'AVAILABLE'/u);
  assert.match(calls[0].sql, /bn\.status = 'ACTIVE'/u);
  assert.match(calls[0].sql, /inventory_bin_locks/u);
  assert.match(calls[0].sql, /LIMIT \?/u);
  assert.deepEqual(calls[0].params, [2, 12, "2026-10-28", 101]);
});
