import assert from "node:assert/strict";
import test from "node:test";

import { rankInventoryCandidates, recommendInventoryCandidates } from "../src/modules/inventory/InventoryPickSequenceService.js";

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
