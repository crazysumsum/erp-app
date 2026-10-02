import assert from "node:assert/strict";
import test from "node:test";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";

const tx = { async query() { throw new Error("Unexpected SQL"); }, async execute() { throw new Error("Unexpected SQL"); } };
const command = (payload) => ({ actor: { userId: 7, serviceName: "", claimedRoles: [], claimedPermissions: ["sales.mgmt"] },
  source: { documentId: "42", eventId: "event-1" }, correlationId: "request-1", payload });
const demand = { sourceLineId: 1, skuId: 12, orderedBaseQuantity: 5, minimumRemainingDays: 0 };
function service(options = {}) {
  return new InventoryReservationService({ database: { withTransaction() { throw new Error("Caller owns transaction"); } },
    time: { nowMs: () => 100, fileDate: () => "2026-10-02" }, authorize: async () => ({ username: "sam", permissions: ["sales.mgmt"] }),
    itemLookup: {}, operations: {}, locks: {}, audit: {}, ...options });
}
test("Sales batch rejects malformed/unbounded demand before authorization, hashing or SQL", async () => {
  const s = service({ authorize: async () => { throw new Error("Authorization must not run"); } });
  for (const lines of [[], Array(101).fill(demand), [demand, demand], [{ ...demand, orderedBaseQuantity: 0 }],
    [{ ...demand, sourceLineId: "x" }], [{ ...demand, minimumRemainingDays: -1 }], [{ ...demand, unexpected: {} }]]) {
    await assert.rejects(() => s.reserveAvailableForSalesBatchInTransaction(tx,
      command({ warehouseId: 2, expectedOrderVersion: 1, lines })), e =>
      ["INVENTORY_INPUT_INVALID", "INVENTORY_QUANTITY_INVALID"].includes(e.code));
  }
});
test("Sales batch fixes fresh sales.mgmt and numeric aggregate source before any claim", async () => {
  const payload = { warehouseId: 2, expectedOrderVersion: 1, lines: [demand] };
  await assert.rejects(() => service({ authorize: async () => ({ permissions: [] }) }).reserveAvailableForSalesBatchInTransaction(tx, command(payload)), { code: "PERMISSION_STALE" });
  await assert.rejects(() => service().reserveAvailableForSalesBatchInTransaction(tx, { ...command(payload), source: { ...command(payload).source, module: "OTHER" } }), { code: "INVENTORY_INPUT_INVALID" });
  await assert.rejects(() => service().reserveAvailableForSalesBatchInTransaction(tx, { ...command(payload), actor: { ...command(payload).actor, userId: null, serviceName: "job" } }), { code: "INVENTORY_INPUT_INVALID" });
});

import { inventoryOperationHash } from "../../src/modules/inventory/InventoryOperationService.js";
function harness({ stock = 8, reserved = 0, minimumLife = 0 } = {}) {
  const state = { operations: [], reservations: [], control: { id: 1, sku_id: 12, warehouse_id: 2, reserved_quantity: reserved, version: 1 }, events: [] };
  let failAudit = false, profilesDisabled = false;
  const transaction = {
    async query(sql, params) {
      state.events.push(sql.includes("FOR UPDATE") ? "reservation-lock" : "query");
      if (sql.includes("FROM inventory_lots WHERE")) return [[]];
      if (sql.includes("AS eligible_on_hand")) return [[...Array((params.length - 1) / 3)].map((_, i) => ({ source_line_id: params[i * 3], eligible_on_hand: stock }))];
      if (sql.includes("JOIN inventory_operation_requests")) {
        const rows = state.reservations.filter(r => r.id > params[2] && (!sql.includes("outstanding_quantity > 0") || r.outstanding_quantity > 0)).slice(0, 100);
        return [rows.map(r => ({ ...r }))];
      }
      if (sql.includes("FROM inventory_reservations WHERE id IN")) return [state.reservations.filter(r => params.includes(r.id)).map(r => ({ ...r }))];
      if (sql.includes("FROM inventory_allocations")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      if (sql.includes("INSERT INTO inventory_reservations")) {
        const id = state.reservations.length + 1;
        const op = state.operations.find(o => o.operationId === params[0]);
        state.reservations.push({ id, create_operation_id: params[0], source_line_id: op.source.lineId,
          warehouse_id: params[1], sku_id: params[2], original_quantity: params[3], outstanding_quantity: params[4],
          minimum_remaining_days: params[5], consumed_quantity: 0, released_quantity: 0, status: "ACTIVE", version: 1 });
        return [{ insertId: id }];
      }
      if (sql.includes("UPDATE inventory_stock_controls")) {
        state.control.reserved_quantity = params[0]; state.control.version++;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE inventory_reservations")) {
        const row = state.reservations.find(r => r.id === params[3]);
        if (row.version !== params[4]) return [{ affectedRows: 0 }];
        Object.assign(row, { released_quantity: params[0], outstanding_quantity: 0, status: "RELEASED", version: row.version + 1 });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    }
  };
  const operations = {
    async claim(_tx, input) {
      state.events.push(`claim:${input.commandType}`);
      const hash = inventoryOperationHash(input);
      const existing = state.operations.find(o => o.source.eventId === input.source.eventId && o.source.lineId === input.source.lineId);
      if (existing) {
        if (existing.requestHash !== hash) throw Object.assign(new Error("conflict"), { code: "INVENTORY_SOURCE_CONFLICT" });
        if (!existing.completedAt) throw Object.assign(new Error("incomplete"), { code: "CONCURRENT_OPERATION" });
        return { operationId: existing.operationId, replay: existing };
      }
      const row = { operationId: state.operations.length + 1, commandType: input.commandType, requestHash: hash, source: input.source,
        sourceLineId: input.source.lineId, completedAt: null };
      state.operations.push(row);
      return { operationId: row.operationId, replay: null };
    },
    async complete(_tx, input) {
      state.events.push(`complete:${input.operationId}`);
      Object.assign(state.operations.find(o => o.operationId === input.operationId), input);
    },
    async stageSalesBatchMember(_tx, input) { Object.assign(state.operations.find(o => o.operationId === input.operationId), input); },
    async listSalesBatchMembers(_tx, { source, afterId }) {
      return state.operations.filter(o => o.source.eventId === source.eventId && o.source.lineId !== "" && o.operationId > afterId).slice(0, 100).map(o => ({ ...o }));
    }
  };
  const s = service({ operations,
    itemLookup: { async getSalesInventoryProfilesInTransaction(_tx, ids) {
      state.events.push("profiles");
      if (profilesDisabled) throw new Error("Mutable Item must not be read");
      return new Map(ids.map(id => [id, { inventoryTracked: true, trackingPolicy: "none", minimumSaleLifeDays: minimumLife }]));
    } },
    locks: { async lockForCommand(_tx, scope) { state.events.push("stock-lock"); assert.deepEqual(scope.stockControls.map(c => c.skuId), [12]);
      return { warehouses: [{ id: 2, status: "ACTIVE" }], stockControls: [{ ...state.control }] }; } },
    audit: { async recordSucceeded() { if (failAudit) throw new Error("audit failure"); } } });
  return { s, transaction, state, operations,
    disableProfiles() { profilesDisabled = true; }, failAudit() { failAudit = true; },
    async run(callback) {
      const before = structuredClone(state);
      try { return await callback(transaction); } catch (e) { for (const key of Object.keys(state)) state[key] = before[key]; throw e; }
    } };
}
const reserveCommand = (lines = [demand], eventId = "event-1") => ({ ...command({ warehouseId: 2, expectedOrderVersion: 1, lines }), source: { documentId: "42", eventId } });
const releaseCommand = (eventId = "release-1") => ({ ...command({ warehouseId: 2, expectedOrderVersion: 1, intent: "ALL_OUTSTANDING" }), source: { documentId: "42", eventId } });

test("Sales batch claims every line before stock, conserves repeated-SKU ATP and persists zero/partial replay", async () => {
  const h = harness({ minimumLife: 5 });
  const cmd = reserveCommand([{ ...demand, sourceLineId: 3 }, demand, { ...demand, sourceLineId: 2, minimumRemainingDays: 10 }]);
  const result = await h.run(tx => h.s.reserveAvailableForSalesBatchInTransaction(tx, cmd));
  assert.deepEqual(result.lines.map(l => [l.sourceLineId, l.reservedBaseQuantity, l.uncoveredBaseQuantity, l.minimumRemainingDays]), [[1, 5, 0, 5], [2, 3, 2, 10], [3, 0, 5, 5]]);
  assert.equal(result.lines[2].reservationId, null);
  assert.equal(result.lines[2].version, null);
  assert.equal(h.state.control.reserved_quantity, 8);
  assert.equal(h.state.reservations.length, 2);
  assert.equal(h.state.events.filter(e => e.startsWith("claim")).length, 4);
  assert.ok(h.state.events.lastIndexOf("claim:SALES_LINE_RESERVE") < h.state.events.indexOf("profiles"));
  assert.ok(h.state.events.indexOf("profiles") < h.state.events.indexOf("stock-lock"));
  assert.equal(h.state.events.at(-1), "complete:1");
  h.disableProfiles();
  assert.deepEqual(await h.s.reserveAvailableForSalesBatchInTransaction(h.transaction, { ...cmd, payload: { ...cmd.payload, lines: cmd.payload.lines.toReversed() } }), result);
  assert.equal(h.state.reservations.length, 2);
  await assert.rejects(() => h.s.reserveAvailableForSalesBatchInTransaction(h.transaction, reserveCommand([{ ...demand, orderedBaseQuantity: 6 }])), { code: "INVENTORY_SOURCE_CONFLICT" });
});
test("Sales replay rejects missing, extra, incomplete and changed children before touching Item/stock", async () => {
  for (const alter of [h => h.state.operations.pop(), h => { h.state.operations[1].completedAt = null; },
    h => { h.state.operations[1].resultSummary.rootRequestHash = "wrong"; }, h => { h.state.operations.push({ ...h.state.operations[1], operationId: 99 }); }]) {
    const h = harness(); await h.s.reserveAvailableForSalesBatchInTransaction(h.transaction, reserveCommand()); h.disableProfiles(); alter(h);
    await assert.rejects(() => h.s.reserveAvailableForSalesBatchInTransaction(h.transaction, reserveCommand()), { code: "INVENTORY_SOURCE_CONFLICT" });
  }
});
test("Sales batch rollback removes all claims, reservations and controls after a technical failure", async () => {
  const h = harness(); h.failAudit();
  await assert.rejects(() => h.run(tx => h.s.reserveAvailableForSalesBatchInTransaction(tx, reserveCommand())), /audit failure/u);
  assert.equal(h.state.operations.length, 0); assert.equal(h.state.reservations.length, 0); assert.equal(h.state.control.reserved_quantity, 0);
});
test("Sales release traverses over 100 mappings atomically and replays original membership after release", async () => {
  const h = harness({ stock: 1000 });
  for (let i = 0; i < 3; i++) await h.s.reserveAvailableForSalesBatchInTransaction(h.transaction,
    reserveCommand(Array.from({ length: 100 }, (_, n) => ({ ...demand, sourceLineId: n + 1, orderedBaseQuantity: 1 })), `reserve-${i}`));
  h.disableProfiles(); h.state.events.length = 0;
  const result = await h.run(tx => h.s.releaseSalesBatchInTransaction(tx, releaseCommand()));
  assert.equal(result.lineCount, 300); let count = 0;
  for await (const page of result.results) { assert.ok(page.length <= 100); count += page.length; assert.ok(page.every(l => l.status === "RELEASED" && l.version === 2)); }
  assert.equal(count, 300); assert.equal(h.state.control.reserved_quantity, 0);
  assert.ok(h.state.events.lastIndexOf("claim:SALES_LINE_RELEASE") < h.state.events.indexOf("stock-lock"));
  assert.ok(h.state.events.indexOf("stock-lock") < h.state.events.indexOf("reservation-lock"));
  const replay = await h.s.releaseSalesBatchInTransaction(h.transaction, releaseCommand());
  assert.equal(replay.lineCount, 300); count = 0; for await (const page of replay.results) count += page.length;
  assert.equal(count, 300);
});

test("Sales release keeps allocation/version/conservation protection and rolls back earlier pages", async () => {
  for (const fault of ["allocation", "version", "conservation", "technical", "omitted"]) {
    const h = harness({ stock: 500 });
    for (let i = 0; i < 2; i++) await h.s.reserveAvailableForSalesBatchInTransaction(h.transaction,
      reserveCommand(Array.from({ length: 100 }, (_, n) => ({ ...demand, sourceLineId: n + 1, orderedBaseQuantity: 1 })), `reserve-${i}`));
    const originalQuery = h.transaction.query;
    let lockPages = 0;
    h.transaction.query = async (sql, params) => {
      if (sql.includes("inventory_reservations WHERE id IN")) {
        lockPages++;
        if (lockPages === 2 && fault === "technical") throw new Error("second page failure");
        const result = await originalQuery(sql, params);
        if (lockPages === 2 && fault === "version") result[0][0].version++;
        if (lockPages === 2 && fault === "conservation") result[0][0].original_quantity++;
        return result;
      }
      if (fault === "allocation" && lockPages === 2 && sql.includes("FROM inventory_allocations")) return [[{ reservation_id: 101, outstanding: 1 }]];
      if (fault === "omitted" && sql.includes("JOIN inventory_operation_requests") && !sql.includes("FOR SHARE")) {
        const result = await originalQuery(sql, params); return [result[0].filter(r => r.id !== 200)];
      }
      return originalQuery(sql, params);
    };
    await assert.rejects(() => h.run(tx => h.s.releaseSalesBatchInTransaction(tx, releaseCommand())), e =>
      ["VERSION_CONFLICT", "RESERVATION_STATE_CONFLICT", "CONCURRENT_OPERATION"].includes(e.code) || e.message === "second page failure", fault);
    assert.equal(h.state.control.reserved_quantity, 200, fault);
    assert.ok(h.state.reservations.every(r => r.outstanding_quantity === 1 && r.version === 1), fault);
    assert.equal(h.state.operations.filter(o => o.source.eventId === "release-1").length, 0, fault);
  }
});

test("Sales state query reads only owned order/Warehouse pages and rechecks fresh permission", async () => {
  const h = harness(); await h.s.reserveAvailableForSalesBatchInTransaction(h.transaction, reserveCommand());
  const calls = []; const original = h.transaction.query;
  h.transaction.query = async (sql, params) => { calls.push({ sql, params }); return original(sql, params); };
  const result = await h.s.getSalesReservationStatesInTransaction(h.transaction, command({ warehouseId: 2 }));
  assert.equal(result.rows.length, 1); assert.equal(result.nextCursor, null);
  assert.match(calls[0].sql, /source_module = 'SALES'.*source_document_type = 'SALES_ORDER'/u);
  assert.match(calls[0].sql, /LIMIT 100 FOR SHARE OF r, o/u);
  assert.deepEqual(calls[0].params, ["42", 2, 0]);
  await assert.rejects(() => h.s.getSalesReservationStatesInTransaction(h.transaction, command({ warehouseId: 2, afterId: -1 })), { code: "INVENTORY_INPUT_INVALID" });
  await assert.rejects(() => h.s.releaseSalesBatchInTransaction(h.transaction, command({ warehouseId: 2, expectedOrderVersion: 1, intent: "ANY" })), { code: "INVENTORY_INPUT_INVALID" });
});
