import assert from "node:assert/strict";
import test from "node:test";
import { InventoryTransferService } from "../src/modules/inventory/InventoryTransferService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time = { nowMs: () => 1790000000000, fileDate: () => "2026-10-02" };
function command(action = "create", overrides = {}) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `transfer.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "TRANSFER", eventId: action },
    payload: { sourceWarehouseId: 1, destinationWarehouseId: 2,
      lines: [{ skuId: 12, lotId: null, sourceBinId: 3, stockStatus: "AVAILABLE", quantity: 5 }] },
    ...overrides
  });
}
function fixture(overrides = {}) {
  const database = createFakeInventoryDatabase({
    initialState: { headers: [], lines: [], audits: [] },
    execute: async ({ sql, params, state }) => {
      if (sql.includes("INSERT INTO inventory_transfers")) {
        state.headers.push(params); return [{ insertId: 41, affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO inventory_transfer_lines")) state.lines.push(params);
      return [{ affectedRows: 1, insertId: 51 }];
    }
  });
  let scope;
  const options = {
    database, time, logger: { error() {} },
    authorize: async () => ({ username: "synthetic", permissions: ["inventory.operation"] }),
    itemLookup: { getInventoryProfileInTransaction: async () => ({ skuId: 12, skuCode: "SKU-12",
      usable: true, inventoryTracked: true, trackingPolicy: "none" }) },
    operations: { claim: async () => ({ operationId: 21 }), complete: async () => {} },
    locks: { lockForCommand: async (_transaction, input) => {
      scope = input;
      return { warehouses: [{ id: 1, status: "ACTIVE" }, { id: 2, status: "ACTIVE" }],
        bins: [{ id: 3, warehouse_id: 1, status: "ACTIVE" }], lots: [], transfers: [] };
    } },
    audit: { recordSucceeded: async (tx, record) => { tx.state.audits.push(record); } },
    ...overrides
  };
  return { database, options, service: new InventoryTransferService(options), get scope() { return scope; } };
}

test("TASK-027 creates a complete Draft and audit without quantity or movement writes", async () => {
  const f = fixture();
  const result = await f.service.create(command());
  assert.deepEqual(result, { id: 41, operationId: 21, status: "DRAFT", version: 1, rowCount: 1 });
  assert.equal(f.database.state.headers.length, 1);
  assert.equal(f.database.state.lines.length, 1);
  assert.equal(f.database.state.audits[0].action, "transfer.create");
  assert.deepEqual(f.scope.warehouseIds, [1, 2]);
  assert.deepEqual(f.scope.binIds, [3]);
  assert.equal(f.scope.stockControls, undefined);
  assert.equal(f.scope.balances, undefined);
  assert.ok(f.database.calls.every(({ sql }) => !/INSERT|UPDATE|DELETE/u.test(sql) ||
    !/inventory_stock_|inventory_movements/u.test(sql)));
});

test("TASK-027 rejects stale permission and caller-selected permission contracts before writes", async () => {
  const f = fixture({ authorize: async () => ({ permissions: [] }) });
  await assert.rejects(f.service.create(command()), { code: "PERMISSION_STALE" });
  await assert.rejects(f.service.create(command("create", {
    authorization: { purpose: "transfer.create", requiredCallerPermission: "receiving.operation" }
  })), /authorization contract mismatch/u);
  assert.equal(f.database.state.headers.length, 0);
});

test("TASK-027 Draft creation rolls back if required audit fails", async () => {
  const f = fixture({ audit: { recordSucceeded: async () => { throw new Error("audit unavailable"); } } });
  await assert.rejects(f.service.create(command()), /audit unavailable/u);
  assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
});

test("TASK-027 rejects invalid Draft quantities, same warehouse, empty lines and caller snapshots", async () => {
  for (const payload of [
    { sourceWarehouseId: 1, destinationWarehouseId: 1, lines: [] },
    { sourceWarehouseId: 1, destinationWarehouseId: 2, lines: [] },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((quantity) => ({
      ...command().payload, lines: [{ ...command().payload.lines[0], quantity }]
    })),
    { ...command().payload, lines: [{ ...command().payload.lines[0], skuCodeSnapshot: "forged" }] }
  ]) {
    const f = fixture();
    await assert.rejects(f.service.create(command("create", { payload })),
      (error) => ["INVENTORY_INPUT_INVALID", "INVENTORY_QUANTITY_INVALID"].includes(error.code));
    assert.equal(f.database.state.headers.length, 0);
  }
});

test("TASK-027 replacement rejects duplicate IDs, absent/stale-shaped versions and caller posting fields", async () => {
  const base = { transferId: 41, expectedVersion: 1, ...command().payload };
  for (const payload of [{ ...base, expectedVersion: 0 },
    { ...base, lines: [{ ...base.lines[0], id: 51 }] },
    { ...base, lines: [{ ...base.lines[0], expectedVersion: 1 }] },
    { ...base, lines: Array(2).fill({ ...base.lines[0], id: 51, expectedVersion: 1 }) },
    { ...base, lines: [{ ...base.lines[0], inTransitQuantity: 5 }] }]) {
    const f = fixture();
    await assert.rejects(f.service.update(command("update", { payload })), { code: "INVENTORY_INPUT_INVALID" });
    assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
  }
});

test("TASK-027 cancellation requires a bounded nonblank reason and integer header version", async () => {
  for (const payload of [{ transferId: 41, expectedVersion: 1 },
    { transferId: 41, expectedVersion: 1, reason: "  " },
    { transferId: 41, expectedVersion: 1, reason: "界".repeat(167) },
    { transferId: 41, expectedVersion: 1, reason: "x\n" },
    { transferId: 41, expectedVersion: 0, reason: "cancel" }]) {
    const f = fixture();
    await assert.rejects(f.service.cancel(command("cancel", { payload })), { code: "INVENTORY_INPUT_INVALID" });
    assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
  }
});

test("TASK-028 Dispatch rejects caller quantities, lines, status and unsafe identity/version", async () => {
  const base = { transferId: 41, expectedVersion: 1 };
  for (const payload of [{ ...base, quantity: 3 }, { ...base, lines: [] },
    { ...base, status: "RECEIVED" }, { ...base, transferId: "41" }, { ...base, expectedVersion: 0 }]) {
    const f = fixture();
    await assert.rejects(f.service.dispatch(command("dispatch", { payload })), { code: "INVENTORY_INPUT_INVALID" });
    assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
  }
});

test("TASK-028 Receive requires a bounded nonempty whole-line array", async () => {
  for (const lines of [undefined, [], {}, Array(101).fill({ id: 51, quantity: 5, destinationBinId: 4 })]) {
    const f = fixture();
    await assert.rejects(f.service.receive(command("receive", {
      payload: { transferId: 41, expectedVersion: 2, ...(lines === undefined ? {} : { lines }) }
    })), { code: "INVENTORY_INPUT_INVALID" });
  }
});

test("TASK-028 Receive rejects caller SKU/Lot/Expiry snapshots and malformed line identities", async () => {
  const line = { id: 51, quantity: 5, destinationBinId: 4 };
  for (const invalid of [{ ...line, skuId: 12 }, { ...line, lotId: 1 },
    { ...line, expiryDate: "2026-12-31" }, { ...line, id: "51" }, { ...line, destinationBinId: 0 }]) {
    const f = fixture();
    await assert.rejects(f.service.receive(command("receive", {
      payload: { transferId: 41, expectedVersion: 2, lines: [invalid] }
    })), { code: "INVENTORY_INPUT_INVALID" });
  }
});

test("TASK-028 Receive rejects nonpositive, fractional or unsafe quantities", async () => {
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture();
    await assert.rejects(f.service.receive(command("receive", {
      payload: { transferId: 41, expectedVersion: 2, lines: [{ id: 51, quantity, destinationBinId: 4 }] }
    })), { code: "INVENTORY_QUANTITY_INVALID" });
  }
});

test("TASK-028 posting revalidates current permission and rejects caller-selected contracts", async () => {
  const f = fixture({ authorize: async () => ({ permissions: [] }) });
  for (const action of ["dispatch", "receive"]) {
    await assert.rejects(f.service[action](command(action)), { code: "PERMISSION_STALE" });
    await assert.rejects(f.service[action](command(action, {
      authorization: { purpose: `transfer.${action}`, requiredCallerPermission: "receiving.operation" }
    })), /authorization contract mismatch/u);
  }
  assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
});

for (const action of ["dispatch", "receive"]) {
  test(`TASK-028 ${action} replays the original receipt without reloading or mutating a later state`, async () => {
    const receipt = { id: 41, operationId: 21, version: action === "dispatch" ? 2 : 3,
      status: action === "dispatch" ? "IN_TRANSIT" : "RECEIVED", rowCount: 1 };
    const f = fixture({ operations: { claim: async () => ({ replay: { resultSummary: receipt } }) } });
    const payload = { transferId: 41, expectedVersion: action === "dispatch" ? 1 : 2,
      ...(action === "receive" ? { lines: [{ id: 51, quantity: 5, destinationBinId: 4 }] } : {}) };
    assert.deepEqual(await f.service[action](command(action, { payload })), receipt);
    assert.deepEqual(f.database.state, { headers: [], lines: [], audits: [] });
    assert.equal(f.database.calls.length, 0);
  });
}
