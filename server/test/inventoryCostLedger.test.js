import assert from "node:assert/strict";
import test from "node:test";
import { lockInventoryCostPools, lockOriginalInventoryCosts, persistInventoryCostBatch,
  readIssueCostAvailability, readInventoryCostInstallation } from "../src/modules/inventory/inventoryCostLedger.js";

const tables = [
  { table_name: "inventory_cost_entries", engine: "InnoDB" },
  { table_name: "inventory_cost_pools", engine: "InnoDB" }
];
const installed = [{ installed: 1 }];
const unavailable = { code: "INVENTORY_DEPENDENCY_UNAVAILABLE" };

function fixture(...results) {
  const calls = [];
  const tx = { async query(sql, params) {
    calls.push({ sql, params });
    assert.ok(results.length, "unexpected query");
    return [results.shift()];
  } };
  return { tx, calls };
}

function issue(overrides = {}) {
  return { movement_id: "42", movement_sku_id: "15", movement_type: "ISSUE", movement_direction: "OUT",
    movement_quantity: "5", entry_id: "80", cost_sku_id: "15", entry_kind: "ISSUE", quantity_delta: "-5",
    value_delta_hkd: "-1.0200", ...overrides };
}

test("Inventory cost installation distinguishes an uninstalled schema and incomplete migration", async () => {
  assert.equal(await readInventoryCostInstallation(fixture([], [{ installed: 0 }]).tx), false);
  assert.equal(await readInventoryCostInstallation(fixture(tables, installed).tx), true);
  const bad = [[tables.slice(0, 1), installed], [tables, [{ installed: 0 }]], [[], installed],
    [[...tables.slice(0, 1), { table_name: "inventory_cost_pools", engine: "MyISAM" }], installed]];
  for (const values of bad) await assert.rejects(readInventoryCostInstallation(fixture(...values).tx), unavailable);
});

test("Inventory shipment preflight confirms each original ISSUE and treats missing cost as a distinct result", async () => {
  const { tx, calls } = fixture(tables, installed, [issue(), issue({ movement_id: "104", entry_id: "98" })]);
  assert.deepEqual(await readIssueCostAvailability(tx, { movementIds: ["104", "42"] }), {
    state: "AVAILABLE", costingEnabled: true
  });
  assert.deepEqual(calls.at(-1).params, ["42", "104"]);
  assert.doesNotMatch(calls.at(-1).sql, /FOR (UPDATE|SHARE)/u);
  assert.deepEqual(await readIssueCostAvailability(fixture(tables, installed, [issue({ entry_id: null })]).tx, {
    movementIds: ["42"]
  }), { state: "MISSING", costingEnabled: true });
});

test("Inventory shipment preflight rejects missing movements, foreign cost facts and uninstalled costing", async () => {
  for (const rows of [[], [issue({ movement_id: "15" })], [issue({ entry_kind: "RECEIPT" })],
    [issue({ movement_direction: "IN" })], [issue({ cost_sku_id: "40" })], [issue({ quantity_delta: "-4" })],
    [issue({ value_delta_hkd: "1.0000" })]]) {
    await assert.rejects(readIssueCostAvailability(fixture(tables, installed, rows).tx, { movementIds: ["42"] }), unavailable);
  }
  await assert.rejects(readIssueCostAvailability(fixture([], [{ installed: 0 }]).tx, { movementIds: ["42"] }), unavailable);
});

test("Inventory shipment preflight rejects duplicate, unsafe, and nondecimal movement identifiers before SQL", async () => {
  const { tx, calls } = fixture();
  for (const movementIds of [[], ["1", "1"], ["0001"], [1], ["92233720368547758080"], ["42x"]]) {
    await assert.rejects(readIssueCostAvailability(tx, { movementIds }), { code: "INVENTORY_INPUT_INVALID" });
  }
  assert.equal(calls.length, 0);
});

test("Inventory cost basis uses current immutable original and correction facts across return kinds", async () => {
  const original = { id: "80", movement_id: "42", sku_id: "15", entry_kind: "RECEIPT", quantity_delta: "5", value_delta_hkd: "1.0200" };
  const request = [{ id: 42, sku_id: 15, direction: "IN", quantity: 5, kind: "RECEIPT" }];
  const { tx, calls } = fixture([original], [
    { original_entry_id: "80", sku_id: "15", entry_kind: "RECEIPT_REVERSAL", quantity_delta: "-2" },
    { original_entry_id: "80", sku_id: "15", entry_kind: "SUPPLIER_RETURN", quantity_delta: "-1" }
  ]);
  assert.deepEqual((await lockOriginalInventoryCosts(tx, request)).get("42"),
    { id: "80", skuId: "15", quantity: 5n, value: 10200n, used: 3n });
  assert.ok(calls.every(call => /FOR SHARE/u.test(call.sql)));
  await assert.rejects(lockOriginalInventoryCosts(fixture([]).tx, request), { code: "INVENTORY_COST_SOURCE_MISSING" });
  await assert.rejects(lockOriginalInventoryCosts(fixture([{ ...original, sku_id: "51" }]).tx, request), unavailable);
  await assert.rejects(lockOriginalInventoryCosts(fixture([original], [
    { original_entry_id: "80", sku_id: "15", entry_kind: "SUPPLIER_RETURN", quantity_delta: "-6" }
  ]).tx, request), unavailable);
});

test("Inventory cost pools are upserted and locked in one ascending SKU sequence", async () => {
  const calls = [];
  const tx = {
    async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; },
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ sku_id: "9", costed_quantity: "14", value_hkd: "1.2345", version: 3 },
        { sku_id: "20", costed_quantity: "0", value_hkd: "0.0000", version: 1 }]];
    }
  };
  const pools = await lockInventoryCostPools(tx, [20, 9, 20], 123);
  assert.deepEqual(calls.map(call => call.params), [["9", 123, "20", 123], ["9", "20"]]);
  assert.match(calls[1].sql, /ORDER BY p\.sku_id FOR UPDATE/u);
  assert.deepEqual(pools.get("9"), { quantity: 14n, value: 12345n, version: 3 });
});

test("Inventory cost writes ledger rows in movement order and updates each locked pool once", async () => {
  const calls = [];
  const tx = { async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: sql.includes("INSERT") ? 2 : 1 }]; } };
  const pools = new Map([["9", { quantity: 0n, value: 0n, version: 3 }]]);
  const first = { skuId: "9", movementId: 340, kind: "OPENING", source: "OPENING_FILE",
    quantityDelta: 5n, valueDelta: 12345n, quantity: 5n, value: 12345n };
  const second = { ...first, movementId: 341, quantityDelta: 2n, valueDelta: 14n, quantity: 7n, value: 12359n };
  await persistInventoryCostBatch(tx, pools, [first, second], 111);
  assert.deepEqual(calls[0].params, [
    340, "9", "OPENING", "5", "1.2345", null, null, "OPENING_FILE", "5", "1.2345", 111,
    341, "9", "OPENING", "2", "0.0014", null, null, "OPENING_FILE", "7", "1.2359", 111
  ]);
  assert.deepEqual(calls[1].params, ["9", "7", "1.2359", 3, 111]);
  assert.match(calls[1].sql, /p\.version = target\.version/u);
});

test("Inventory cost rejects mismatched ledger and locked pool quantities before any write", async () => {
  const tx = { async execute() { assert.fail("no write should happen"); } };
  const pools = new Map([["9", { quantity: 0n, value: 0n, version: 3 }]]);
  await assert.rejects(persistInventoryCostBatch(tx, pools, [{ skuId: "9", quantityDelta: 1n,
    valueDelta: 10n, quantity: 2n, value: 10n }], 111), unavailable);
});
