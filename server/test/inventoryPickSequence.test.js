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

test("TASK-025 candidate validation rejects invalid bounds before querying", async () => {
  const transaction = { async query() { assert.fail("invalid input must not query"); } };
  const query = { warehouseId: 2, skuId: 12, currentDate: "2026-09-28",
    minimumRemainingDays: 0, trackingPolicy: "none" };
  for (const invalid of [
    { warehouseId: 0 }, { skuId: 1.5 }, { limit: 0 }, { limit: 102 }, { limit: 1.5 },
    { offset: -1 }, { offset: 1.5 }, { offset: 1 }, { trackingPolicy: "unknown" },
    { minimumRemainingDays: -1 }, { minimumRemainingDays: 36_501 },
    { minimumRemainingDays: 1.5 }, { currentDate: "invalid" }, { currentDate: "2026-02-30" }
  ]) {
    await assert.rejects(() => loadInventoryCandidates(transaction, { ...query, ...invalid }),
      (error) => error.code === "INVENTORY_INPUT_INVALID", JSON.stringify(invalid));
  }
});

test("TASK-025 candidates fail closed on corrupt quantity and identity rows", async () => {
  const row = { id: 4, bin_id: 3, lot_id: 5, version: 2, on_hand_quantity: 8,
    allocated_quantity: 3, bin_code: "A", normalized_lot_number: "lot-5",
    expiry_date: "2026-11-01", first_receipt_date: "2026-09-01", fifo_anchor_date: null };
  for (const invalid of [
    { on_hand_quantity: "invalid" }, { allocated_quantity: "invalid" },
    { allocated_quantity: -1 }, { allocated_quantity: 8 },
    { id: 0 }, { bin_id: 0 }, { lot_id: 0 }, { version: 0 }
  ]) {
    const transaction = { async query() { return [[{ ...row, ...invalid }]]; } };
    await assert.rejects(() => loadInventoryCandidates(transaction, {
      warehouseId: 2, skuId: 12, currentDate: "2026-09-28",
      minimumRemainingDays: 0, trackingPolicy: "batch_expiry"
    }), (error) => ["INVENTORY_INPUT_INVALID", "INVENTORY_DEPENDENCY_UNAVAILABLE"].includes(error.code),
    JSON.stringify(invalid));
  }
});

test("TASK-025 pre-Stocktake candidate fallback is allowed only when both P3 tables are absent", async () => {
  const query = { warehouseId: 2, skuId: 12, currentDate: "2026-09-28",
    minimumRemainingDays: 0, trackingPolicy: "none" };
  const missing = new Error("missing table", { cause: { code: "ER_NO_SUCH_TABLE" } });
  const calls = [];
  const transaction = { async query(sql) {
    calls.push(sql);
    if (calls.length === 1) throw missing;
    return [[]];
  } };
  assert.deepEqual(await loadInventoryCandidates(transaction, query), []);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[2], /NOT EXISTS/u);
  const partial = { async query(sql) {
    if (sql.includes("information_schema")) return [[{ table_name: "inventory_stocktakes" }]];
    throw missing;
  } };
  await assert.rejects(() => loadInventoryCandidates(partial, query), missing);
  const failure = Object.assign(new Error("lock failure"), { code: "ER_LOCK_DEADLOCK" });
  await assert.rejects(() => loadInventoryCandidates({ async query() { throw failure; } }, query), failure);
  assert.throws(() => recommendInventoryCandidates([], 1),
    (error) => error.code === "ALLOCATION_INSUFFICIENT");
});

test("TASK-025 FIFO candidates retain bounded offset and caller lock semantics", async () => {
  let captured;
  const transaction = { async query(sql, params) {
    captured = { sql, params };
    return [[{ id: 4, bin_id: 3, lot_id: null, version: 2, on_hand_quantity: 8,
      allocated_quantity: 3, bin_code: "A", normalized_lot_number: null,
      expiry_date: null, first_receipt_date: null, fifo_anchor_date: "2026-09-01" }]];
  } };
  const rows = await loadInventoryCandidates(transaction, {
    warehouseId: 2, skuId: 12, currentDate: "2026-09-28", minimumRemainingDays: 0,
    trackingPolicy: "none", limit: 3, offset: 10, locking: true
  });
  assert.equal(rows[0].lotId, null);
  assert.equal(rows[0].freeQuantity, 5);
  assert.match(captured.sql, /LIMIT \?\s+OFFSET \?\s+FOR SHARE OF b/u);
  assert.deepEqual(captured.params, [2, 12, "2026-09-28", 3, 10]);
});
