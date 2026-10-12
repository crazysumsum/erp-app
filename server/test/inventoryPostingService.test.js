import assert from "node:assert/strict";
import test from "node:test";

import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";
import { createFakeInventoryDatabase, INVENTORY_FAILURE_POINTS } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = Date.parse("2026-09-28T04:00:00.000Z");

async function highRiskSetup(overrides = {}) {
  const proof = await import("../src/modules/inventory/inventoryHighRiskContext.js");
  const { normalizeAdjustmentCommand } = await import("../src/modules/inventory/inventoryAdjustmentPosting.js");
  const { normalizeReversalCommand } = await import("../src/modules/inventory/inventoryReversalPosting.js");
  let now = NOW;
  const deviceId = "a".repeat(64);
  const binding = { id: 5, user_id: 7, device_id: deviceId, public_key: Buffer.from("synthetic-public-key"), status: "approved" };
  const roles = ["warehouse-operator"];
  const permissions = ["inventory.view", "inventory.adjust"];
  const command = overrides.command ?? adjustmentCommand();
  command.actor.claimedRoles = roles;
  const reversal = command.authorization.purpose === "movement.reverse";
  const normalized = reversal ? normalizeReversalCommand({ query() {}, execute() {} }, command)
    : normalizeAdjustmentCommand({ query() {}, execute() {} }, command, command.authorization.purpose);
  const abort = new AbortController();
  const req = { auth: { type: "jwt-device-password", claims: { sub: "7", did: deviceId, roles, permissions,
    exp: Math.floor(NOW / 1000) + 900, auth_time: Math.floor(NOW / 1000), ver: 0 }, deviceBinding: binding },
    method: "POST", apiRoute: { path: command.authorization.purpose === "adjustment.post"
      ? "/api/v1/inventory/adjustments" : reversal ? "/api/v1/inventory/movements/:id/reverse"
        : "/api/v1/inventory/status-transfers", authType: "jwt-device-password" },
    input: { params: reversal ? { id: String(command.payload.movementId) } : {} },
    requestTimeout: { signal: abort.signal }, get: () => String(NOW) };
  const options = { time: { nowMs: () => now }, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 28800, clockToleranceSeconds: 5 };
  const calls = [];
  const tx = { async query(sql, params) {
    calls.push({ sql, params });
    assert.equal((sql.match(/\?/gu) ?? []).length, params.length);
    if (sql.includes("FROM users")) return [[{ id: 7, username: "operator", status: overrides.status ?? "active" }]];
    if (sql.includes("FROM user_roles")) return [[{ role_id: 9, name: "warehouse-operator" }]];
    if (sql.includes("FROM role_permissions")) return [(overrides.permissions ?? permissions).map(name => ({ name }))];
    if (sql.includes("FROM user_devices")) return [[{ ...binding, ...overrides.binding }]];
    if (sql.includes("FROM fr_token_versions")) return overrides.version === undefined ? [[]] : [[{ version: overrides.version }]];
    assert.fail(sql);
  }, execute() { assert.fail("security guard must be read-only"); } };
  const issue = () => proof.issueInventoryHighRiskContext(req, normalized, options);
  return { proof, command: normalized, req, options, issue, tx, calls, abort, advance(ms) { now += ms; } };
}

test("ADJ031-PROOF opaque context rejects JSON/copies, changed intent, action and repeated submission", async () => {
  const setup = await highRiskSetup();
  const context = setup.issue();
  assert.equal(JSON.stringify(context), "{}");
  for (const forged of [undefined, {}, { ...context }, JSON.parse(JSON.stringify(context))]) {
    assert.throws(() => setup.proof.consumeInventoryHighRiskContext(forged, setup.command), { code: "PERMISSION_STALE" });
  }
  assert.throws(() => setup.proof.consumeInventoryHighRiskContext(context, { ...setup.command,
    payload: { ...setup.command.payload, quantity: 3 } }), { code: "PERMISSION_STALE" });
  assert.throws(() => setup.proof.consumeInventoryHighRiskContext(context, { ...setup.command,
    authorization: { purpose: "status_transfer.post", requiredCallerPermission: "inventory.adjust" } }), { code: "PERMISSION_STALE" });
  assert.equal(setup.calls.length, 0);
  const guard = setup.proof.consumeInventoryHighRiskContext(context, setup.command);
  const actor = await guard.check(setup.tx, { locking: true });
  assert.equal(actor.id, 7);
  assert.deepEqual(guard.audit, { deviceId: "a".repeat(64), signedRequestAt: NOW });
  assert.throws(() => setup.proof.consumeInventoryHighRiskContext(context, setup.command), { code: "PERMISSION_STALE" });
  assert.throws(setup.issue, { code: "PERMISSION_STALE" });
});

test("ADJ031-PROOF current guard uses declared read-lock order and preserves native revocation rejection", async () => {
  for (const [overrides, code] of [[{ permissions: ["inventory.view"] }, "PERMISSION_STALE"],
    [{ status: "inactive" }, "PERMISSION_STALE"], [{ binding: { status: "revoked" } }, "DEVICE_REVOKED"],
    [{ binding: { public_key: Buffer.from("changed") } }, "DEVICE_MISMATCH"], [{ version: 1 }, "JWT_INVALID"]]) {
    const setup = await highRiskSetup(overrides);
    const guard = setup.proof.consumeInventoryHighRiskContext(setup.issue(), setup.command);
    await assert.rejects(() => guard.check(setup.tx, { locking: true }), { code });
  }
  const setup = await highRiskSetup();
  const context = setup.issue();
  await setup.proof.checkInventoryHighRiskContext(setup.tx, context, setup.command);
  assert.ok(setup.calls.every(call => !call.sql.includes("FOR SHARE")), "preflight cannot hold auth locks over stock/cache waits");
  setup.calls.length = 0;
  const guard = setup.proof.consumeInventoryHighRiskContext(context, setup.command);
  await guard.check(setup.tx, { locking: true });
  assert.ok(setup.calls.every(call => call.sql.includes("FOR SHARE")));
  assert.deepEqual(setup.calls.map(call => /FROM (\w+)/u.exec(call.sql)[1]),
    ["users", "user_roles", "role_permissions", "user_devices", "fr_token_versions"]);
});

test("ADJ031-PROOF original signed time is not renewed by waits and abort/expiry remain fail-closed", async () => {
  const stale = await highRiskSetup();
  const guard = stale.proof.consumeInventoryHighRiskContext(stale.issue(), stale.command);
  stale.advance(60_000);
  guard.assertTime();
  stale.advance(1);
  assert.throws(() => guard.assertTime(), { code: "DEVICE_SIGNATURE_STALE" });
  const future = await highRiskSetup();
  future.req.get = () => String(NOW + 60_001);
  assert.throws(future.issue, { code: "DEVICE_SIGNATURE_STALE" });
  const expired = await highRiskSetup();
  expired.req.auth.claims.exp = Math.floor(NOW / 1000) - 5;
  assert.throws(expired.issue, { code: "JWT_INVALID" });
  const session = await highRiskSetup();
  session.req.auth.claims.auth_time -= 28801;
  assert.throws(session.issue, { code: "SESSION_EXPIRED" });
  const aborted = await highRiskSetup();
  const abortGuard = aborted.proof.consumeInventoryHighRiskContext(aborted.issue(), aborted.command);
  aborted.abort.abort(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }));
  assert.throws(() => abortGuard.assertTime(), { code: "REQUEST_TIMEOUT" });
  const duringRead = await highRiskSetup();
  const readGuard = duringRead.proof.consumeInventoryHighRiskContext(duringRead.issue(), duringRead.command);
  const original = duringRead.tx.query;
  duringRead.tx.query = async (...args) => { const result = await original(...args);
    if (args[0].includes("FROM fr_token_versions")) duringRead.advance(60_001); return result; };
  await assert.rejects(() => readGuard.check(duringRead.tx, { locking: true }), { code: "DEVICE_SIGNATURE_STALE" });
});

function adjustmentCommand(payload = {}, action = "adjustment.post") {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.view", "inventory.adjust"] },
    authorization: { purpose: action, requiredCallerPermission: "inventory.adjust" },
    source: { module: "INVENTORY", documentType: "ADJUSTMENT", documentId: "adjust-1", eventId: "post-1" },
    payload: { quantity: 2, uomId: 8, reasonText: "Physical count corrected", reasonCategory: "COUNT_GAIN",
      direction: "IN", warehouseId: 2, binId: 35, skuId: 12, stockStatus: "AVAILABLE", expectedBalanceVersion: null, ...payload } });
}

function reversalCommand(payload = {}, source = {}) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.view", "inventory.adjust"] },
    authorization: { purpose: "movement.reverse", requiredCallerPermission: "inventory.adjust" },
    source: { module: "INVENTORY", documentType: "REVERSAL", documentId: "reverse-1", eventId: "post-1", ...source },
    payload: { movementId: 101, reasonText: "Undo original posting", expectedBalances: [{ balanceId: 501, expectedVersion: 3 }], ...payload } });
}
function originalMovement(overrides = {}) {
  return { id: 101, movement_group_id: "original-group", operation_request_id: 81, movement_type: "RECEIPT",
    location_kind: "BIN", warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null, stock_status: "AVAILABLE",
    direction: "IN", quantity: 2, balance_before: 3, balance_after: 5, balance_version_after: 2,
    reservation_id: null, allocation_id: null, transfer_id: null, transfer_line_id: null, stocktake_id: null,
    stocktake_line_id: null, reversal_of_movement_id: null, expiry_date_snapshot: null, ...overrides };
}
async function reversalSetup(options = {}) {
  const { service, database: receiptDb } = setup(options);
  const initial = receiptDb.state;
  initial.balances = options.balances ?? [{ ...initial.balance, fifo_anchor_date: "2026-01-01" }];
  initial.originals = options.originals ?? [originalMovement()];
  initial.originalOperation = { id: 81, command_type: "RECEIPT_POST", result_type: "MOVEMENT_GROUP",
    result_id: "original-group", result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", movementId: 101 },
    completed_at: NOW - 1000, ...options.originalOperation };
  initial.bins = options.bins ?? [initial.bin, { ...initial.bin, id: 36, bin_code: "A-02" }];
  initial.workflows = { reservation: { status: "Consumed", outstanding: 0 }, allocation: { status: "Consumed", quantity: 2 } };
  const security = await highRiskSetup({ command: reversalCommand(), ...options.security });
  let currentProof;
  const database = createFakeInventoryDatabase({ initialState: initial, failAt: options.failAt,
    async query({ sql, params, state }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("FROM inventory_movements")) {
        if (sql.includes("reversal_of_movement_id IN")) {
          assert.ok(sql.includes("FOR UPDATE")); return [options.alreadyReversed ? [{ id: 999 }] : []];
        }
        return [state.originals.filter(row => sql.includes("WHERE id = ?") ? row.id === params[0] : row.movement_group_id === params[0])];
      }
      if (sql.includes("FROM inventory_operation_requests")) {
        assert.ok(sql.includes("FOR UPDATE")); return [[state.originalOperation]];
      }
      if (sql.includes("FROM inventory_lots")) return [state.lots.filter(row => params.includes(row.id))];
      if (sql.includes("FROM inventory_stock_balances")) {
        assert.ok(sql.includes("FOR UPDATE") || sql.includes("FOR SHARE"));
        if (sql.includes("b.stock_status = 'AVAILABLE'")) return [state.balances.filter(row => row.stock_status === "AVAILABLE")
          .map(row => ({ ...row, expiry_date: state.lots.find(lot => lot.id === row.lot_id)?.expiry_date ?? null }))];
        options.beforeBalances?.(state, currentProof);
        return [state.balances];
      }
      return security.tx.query(sql, params);
    },
    async execute({ sql, params, state }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("UPDATE inventory_operation_requests")) {
        assert.ok(database.calls.some(call => call.sql.includes("FROM fr_token_versions") && call.sql.includes("FOR SHARE")));
        assert.equal(state.operation.actorUserId, null);
        assert.deepEqual(params, [7, 91, "MOVEMENT_REVERSE"]);
        options.beforeBind?.(currentProof);
        if (options.bindZero) return [{ affectedRows: 0 }];
        state.operation.actorUserId = params[0];
      } else if (sql.includes("UPDATE inventory_stock_balances")) {
        const row = state.balances.find(row => row.id === params[3] && row.version === params[4]);
        if (!row || options.updateConflict) return [{ affectedRows: 0 }];
        row.on_hand_quantity = params[0]; row.fifo_anchor_date = params[1]; row.version++;
      } else if (sql.includes("INSERT INTO inventory_movements")) {
        if (options.duplicate) throw Object.assign(new Error(options.duplicate), { code: "ER_DUP_ENTRY", sqlMessage: options.duplicate });
        const id = 701 + state.movements.length; state.movements.push({ id, params });
        return [{ insertId: id, affectedRows: 1 }];
      } else assert.fail(sql);
      return [{ affectedRows: 1 }];
    } });
  service.database = database;
  service.locks = { async lockForCommand(tx, input) {
    assert.equal(input.balances, undefined, "historical bucket must never be upserted");
    assert.equal(tx.state.operation.actorUserId, null);
    assert.ok(!database.calls.some(call => call.sql.includes("FOR SHARE")), "no security lock before business waits");
    options.afterStockWait?.(security, currentProof);
    return { warehouses: [tx.state.warehouse], bins: tx.state.bins, binLocks: tx.state.binLocks,
      stockControls: [{ warehouse_id: 2, sku_id: 12, reserved_quantity: options.reserved ?? 0 }], lots: tx.state.lots };
  }, lockBalancesAfterLot() { assert.fail("no balance insertion during Reversal"); } };
  service.itemLookup.resolveUomInTransaction = () => assert.fail("original Base quantity must not be reconverted");
  return { service, database, security, async submit(input = reversalCommand()) {
    currentProof = await highRiskSetup({ command: input, ...options.security });
    return service.reverseMovement(currentProof.command, currentProof.issue());
  } };
}

test("REV032-RECEIPT reverses original Base quantity using current version and append-only attribution", async () => {
  const fixture = await reversalSetup(); const before = fixture.database.state;
  const result = await fixture.submit(); const state = fixture.database.state;
  assert.deepEqual(result, { status: "POSTED", operationId: 91, movementGroupId: "11111111-1111-4111-8111-111111111111", lineCount: 1 });
  assert.deepEqual(state.originals, before.originals); assert.deepEqual(state.originalOperation, before.originalOperation);
  assert.deepEqual(state.workflows, before.workflows);
  assert.deepEqual([state.balances[0].on_hand_quantity, state.balances[0].version, state.balances[0].fifo_anchor_date], [3, 4, "2026-01-01"]);
  assert.equal(state.operation.actorUserId, 7); assert.equal(state.movements.length, 1); assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, "movement.reverse"); assert.equal(state.audits[0].afterSummary.signedRequestAt, NOW);
  const balanceRead = fixture.database.calls.findIndex(call => call.sql.includes("FROM inventory_stock_balances") && call.sql.includes("FOR UPDATE"));
  const groupRead = fixture.database.calls.findIndex(call => call.sql.includes("FROM inventory_movements") && call.sql.includes("FOR UPDATE"));
  assert.ok(groupRead > balanceRead);
});

test("REV032-VERSIONS exact full current guard set rejects stale/missing/extra and absent historical buckets", async () => {
  for (const expectedBalances of [[{ balanceId: 501, expectedVersion: 2 }], [{ balanceId: 502, expectedVersion: 3 }],
    [{ balanceId: 501, expectedVersion: 3 }, { balanceId: 502, expectedVersion: 3 }]]) {
    const fixture = await reversalSetup(), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(reversalCommand({ expectedBalances })), error => ["VERSION_CONFLICT", "REVERSAL_NOT_ALLOWED"].includes(error.code));
    assert.deepEqual(fixture.database.state, before);
  }
  const fixture = await reversalSetup({ balances: [] }), before = fixture.database.state;
  await assert.rejects(() => fixture.submit(), { code: "REVERSAL_NOT_ALLOWED" });
  assert.deepEqual(fixture.database.state, before);
});

test("REV032-GROUP refuses forbidden, incomplete, mixed and malformed original groups", async () => {
  for (const type of ["TRANSFER", "STOCKTAKE", "OPENING", "REVERSAL", "UNKNOWN"]) {
    const fixture = await reversalSetup({ originals: [originalMovement({ movement_type: type })] }), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { code: "MOVEMENT_TYPE_NOT_REVERSIBLE" }); assert.deepEqual(fixture.database.state, before);
  }
  for (const options of [{ originals: [originalMovement({ location_kind: "IN_TRANSIT", bin_id: null })] },
    { originals: [] }, { originalOperation: { completed_at: null } }, { originalOperation: { result_id: "other-group" } },
    { originals: [originalMovement(), originalMovement({ id: 102, operation_request_id: 82 })] },
    { originals: [originalMovement({ balance_after: 99 })] }]) {
    const fixture = await reversalSetup(options), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), error => ["MOVEMENT_TYPE_NOT_REVERSIBLE", "REVERSAL_NOT_ALLOWED", "INVENTORY_RESOURCE_NOT_FOUND"].includes(error.code));
    assert.deepEqual(fixture.database.state, before);
  }
});

test("REV032-ONCE current link and exact native unique constraint reject whole group without swallowing unrelated duplicate", async () => {
  for (const options of [{ alreadyReversed: true }, { alreadyReversed: true, beforeBalances: state => { state.balances[0].version++; } },
    { duplicate: "Duplicate entry for key 'inventory_movements.uq_inventory_movement_reversal'" }]) {
    const fixture = await reversalSetup(options), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { code: "MOVEMENT_ALREADY_REVERSED" }); assert.deepEqual(fixture.database.state, before);
  }
  const fixture = await reversalSetup({ duplicate: "Duplicate entry for key 'unrelated_index'" }), before = fixture.database.state;
  await assert.rejects(() => fixture.submit(), { code: "ER_DUP_ENTRY" }); assert.deepEqual(fixture.database.state, before);
});

test("REV032-ROLLBACK every native checkpoint, actor-bind failure, CAS conflict and expired proof has zero effects", async () => {
  for (const failAt of INVENTORY_FAILURE_POINTS) {
    const fixture = await reversalSetup({ failAt }), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { faultPoint: failAt }); assert.deepEqual(fixture.database.state, before);
  }
  for (const options of [{ bindZero: true }, { updateConflict: true }, { beforeBind: proof => proof.advance(60_001) },
    { beforeBind: proof => proof.abort.abort(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" })) }]) {
    const fixture = await reversalSetup(options), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), error => ["CONCURRENT_OPERATION", "DEVICE_SIGNATURE_STALE", "REQUEST_TIMEOUT"].includes(error.code));
    assert.deepEqual(fixture.database.state, before);
  }
});

test("REV032-DOMAIN-REPLAY completed original result bypasses changed stock/Item but rechecks current security", async () => {
  const fixture = await reversalSetup(), input = reversalCommand();
  const first = await fixture.submit(input), before = fixture.database.state;
  fixture.service.itemLookup.getInventoryProfileInTransaction = () => assert.fail("completed replay cannot read Item");
  const last = fixture.database.calls.length;
  assert.deepEqual(await fixture.submit(input), first); assert.deepEqual(fixture.database.state, before);
  assert.ok(!fixture.database.calls.slice(last).some(call => /FROM inventory_(stock_balances|movements|lots)/u.test(call.sql)));
  await assert.rejects(() => fixture.submit(reversalCommand({ reasonText: "Other intent" })), { code: "INVENTORY_SOURCE_CONFLICT" });
  const originalQuery = fixture.security.tx.query;
  fixture.security.tx.query = (sql, params) => sql.includes("FROM user_devices")
    ? [[{ id: 5, user_id: 7, device_id: "a".repeat(64), status: "revoked", public_key: Buffer.from("synthetic-public-key") }]] : originalQuery(sql, params);
  await assert.rejects(() => fixture.submit(input), { code: "DEVICE_REVOKED" }); assert.deepEqual(fixture.database.state, before);
});

test("REV032-RESERVED gross OUT cannot spend allocated stock or increase uncovered Reserved", async () => {
  for (const options of [{ reserved: 4 }, { balances: [{ id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
    stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 4, version: 3, fifo_anchor_date: "2026-01-01" }] }]) {
    const fixture = await reversalSetup(options), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { code: "REVERSAL_NOT_ALLOWED" }); assert.deepEqual(fixture.database.state, before);
  }
  const fixture = await reversalSetup({ reserved: 10, originals: [originalMovement({ movement_type: "ADJUSTMENT", direction: "OUT", balance_before: 7, balance_after: 5 })],
    originalOperation: { command_type: "ADJUSTMENT_POST", result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", lineCount: 1 } } });
  await fixture.submit(); assert.equal(fixture.database.state.balances[0].on_hand_quantity, 7);
});

test("REV032-ISSUE original outgoing stock restores without reviving consumed workflow or allocations", async () => {
  const fixture = await reversalSetup({ originals: [originalMovement({ movement_type: "ISSUE", direction: "OUT",
    reservation_id: 21, allocation_id: 31, balance_before: 7, balance_after: 5 })],
  originalOperation: { command_type: "ISSUE_POST", result_summary: { status: "POSTED", operationId: 81,
    movementGroupId: "original-group", reservationId: 21, rowCount: 1, allocationSnapshot: "[101]" } } });
  const before = fixture.database.state; await fixture.submit();
  assert.equal(fixture.database.state.balances[0].on_hand_quantity, 7);
  assert.deepEqual(fixture.database.state.workflows, before.workflows);
  assert.equal(fixture.database.state.balances[0].allocated_quantity, 0);
});

test("REV032-ADJUSTMENT both original directions undo only original Base quantity", async () => {
  for (const direction of ["IN", "OUT"]) {
    const fixture = await reversalSetup({ originals: [originalMovement({ movement_type: "ADJUSTMENT", direction,
      balance_before: direction === "IN" ? 3 : 7 })], originalOperation: { command_type: "ADJUSTMENT_POST",
    result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", lineCount: 1 } } });
    await fixture.submit(); assert.equal(fixture.database.state.balances[0].on_hand_quantity, direction === "IN" ? 3 : 7);
  }
});

test("REV032-PAIRS Bin Move and Status undo in descending original ID with per-bucket chained versions", async () => {
  for (const type of ["BIN_MOVE", "STATUS_TRANSFER"]) {
    const out = originalMovement({ movement_type: type, direction: "OUT", balance_before: 5, balance_after: 3 });
    const incoming = originalMovement({ id: 102, movement_type: type, direction: "IN", balance_before: 3, balance_after: 5,
      bin_id: type === "BIN_MOVE" ? 36 : 35, stock_status: type === "BIN_MOVE" ? "AVAILABLE" : "DAMAGED" });
    const balances = [out, incoming].map((row, i) => ({ id: 501 + i, warehouse_id: row.warehouse_id, sku_id: row.sku_id,
      bin_id: row.bin_id, lot_id: null, stock_status: row.stock_status, on_hand_quantity: row.balance_after,
      allocated_quantity: 0, version: 3 + i, fifo_anchor_date: "2026-01-01" }));
    const options = { originals: [out, incoming], balances, originalOperation: { command_type: type === "BIN_MOVE" ? "BIN_MOVE_POST" : "STATUS_TRANSFER_POST",
      result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", lineCount: type === "BIN_MOVE" ? 1 : 2 } } };
    const fixture = await reversalSetup(options);
    const input = reversalCommand({ expectedBalances: [{ balanceId: 501, expectedVersion: 3 }, { balanceId: 502, expectedVersion: 4 }] });
    const result = await fixture.submit(input); assert.equal(result.lineCount, 2);
    assert.deepEqual(fixture.database.state.balances.map(row => [row.on_hand_quantity, row.version]), [[5,4],[3,5]]);
    assert.deepEqual(fixture.database.state.movements.map(row => [row.params[7], row.params[12]]), [["OUT",102],["IN",101]]);
    const invalid = await reversalSetup({ ...options, originals: [out, { ...incoming, quantity: 1, balance_after: 4 }] });
    const before = invalid.database.state;
    await assert.rejects(() => invalid.submit(input), { code: "REVERSAL_NOT_ALLOWED" }); assert.deepEqual(invalid.database.state, before);
  }
});

test("REV032-LOT-LIFE-FIFO expired original Lot returns unchanged, never covers Sale Reserved, and per-leg anchors remain exact", async () => {
  const lot = { id: 601, sku_id: 12, lot_number: "OLD", normalized_lot_number: "OLD", expiry_date: "2026-01-01",
    manufacture_date: null, first_receipt_date: "2025-01-01", created_by: null };
  const fixture = await reversalSetup({ initialState: { lots: [lot] }, reserved: 10,
    profile: { trackingPolicy: "batch_expiry", minimumReceiptLifeDays: 60, minimumSaleLifeDays: 0 },
    originals: [originalMovement({ movement_type: "ADJUSTMENT", direction: "OUT", lot_id: 601,
      expiry_date_snapshot: lot.expiry_date, balance_before: 7, balance_after: 5 })],
    balances: [{ id: 501, warehouse_id: 2, sku_id: 12, bin_id: 35, lot_id: 601, stock_status: "AVAILABLE",
      on_hand_quantity: 0, allocated_quantity: 0, version: 3, fifo_anchor_date: null }],
    originalOperation: { command_type: "ADJUSTMENT_POST", result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", lineCount: 1 } } });
  await fixture.submit(); assert.deepEqual(fixture.database.state.lots, [lot]);
  assert.deepEqual([fixture.database.state.balances[0].on_hand_quantity, fixture.database.state.balances[0].fifo_anchor_date], [2, "2026-09-28"]);
  const empty = await reversalSetup({ originals: [originalMovement({ quantity: 5, balance_before: 0 })] });
  await empty.submit(); assert.equal(empty.database.state.balances[0].fifo_anchor_date, null);
});

test("REV032-REVOKE-ORDER fresh final guard rejects committed security change after business wait without early locks", async () => {
  for (const kind of ["permission", "device", "deadline", "abort"]) {
    let reached = false;
    const fixture = await reversalSetup({ afterStockWait(security, proof) {
      reached = true;
      if (kind === "deadline") proof.advance(60_001);
      if (kind === "abort") proof.abort.abort(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }));
      const original = security.tx.query;
      if (kind === "permission") security.tx.query = (sql, params) => sql.includes("FROM role_permissions") ? [[{ name: "inventory.view" }]] : original(sql, params);
      if (kind === "device") security.tx.query = (sql, params) => sql.includes("FROM user_devices") ? [[{ status: "revoked" }]] : original(sql, params);
    } });
    const before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { code: kind === "permission" ? "PERMISSION_STALE" : kind === "device" ? "DEVICE_REVOKED"
      : kind === "deadline" ? "DEVICE_SIGNATURE_STALE" : "REQUEST_TIMEOUT" });
    assert.equal(reached, true); assert.deepEqual(fixture.database.state, before);
  }
});

test("REV032-COMPATIBILITY current unusable/serial/tracking/location/counting/overflow rules fail closed and forged proof cannot write", async () => {
  for (const options of [{ profile: { inventoryTracked: false } }, { profile: { usable: false } }, { profile: { trackingPolicy: "serial" } },
    { profile: { trackingPolicy: "batch_expiry" } }, { initialState: { warehouse: { id: 2, status: "INACTIVE" } } },
    { bins: [{ id: 35, warehouse_id: 3, status: "ACTIVE" }] }, { initialState: { binLocks: [{ bin_id: 35 }] } },
    { balances: [{ id: 501, warehouse_id: 2, sku_id: 12, bin_id: 35, lot_id: null, stock_status: "AVAILABLE",
      on_hand_quantity: 5, allocated_quantity: 0, version: 3, fifo_anchor_date: null }],
      beforeBalances: state => { state.balances[0].on_hand_quantity = Number.MAX_SAFE_INTEGER; },
      originals: [originalMovement({ movement_type: "ADJUSTMENT", direction: "OUT", balance_before: 7 })],
      originalOperation: { command_type: "ADJUSTMENT_POST", result_summary: { status: "POSTED", operationId: 81, movementGroupId: "original-group", lineCount: 1 } } }]) {
    const fixture = await reversalSetup(options), before = fixture.database.state;
    await assert.rejects(() => fixture.submit(), { code: "REVERSAL_NOT_ALLOWED" }); assert.deepEqual(fixture.database.state, before);
  }
  const fixture = await reversalSetup();
  await assert.rejects(() => fixture.service.reverseMovement(reversalCommand(), {}), { code: "PERMISSION_STALE" });
  assert.deepEqual(fixture.database.calls, []);
});

async function adjustmentSetup(options = {}) {
  const security = await highRiskSetup(options.security);
  const { service, database: original } = setup(options);
  const initial = original.state;
  initial.balances = options.absent ? [] : [initial.balance];
  let currentProof;
  const dimensionMatch = (row, params, offset) => [row.warehouse_id, row.sku_id, row.bin_id, row.lot_id ?? 0, row.stock_status]
    .every((value, index) => value === params[offset + index]);
  const database = createFakeInventoryDatabase({ initialState: initial, failAt: options.failAt,
    async query({ sql, params, state }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("FROM inventory_lots")) return [state.lots.filter(row => sql.includes("WHERE id = ?")
        ? row.id === params[0] : row.sku_id === params[0] && row.normalized_lot_number === params[1])];
      if (sql.includes("FROM inventory_stock_balances")) {
        if (sql.includes("b.id = ?")) return [state.balances.filter(row => row.id === params[0]).map(row => ({ ...row,
          normalized_lot_number: state.lots.find(lot => lot.id === row.lot_id)?.normalized_lot_number }))];
        if (sql.includes("b.stock_status = 'AVAILABLE'")) return [state.balances.filter(row => row.stock_status === "AVAILABLE")
          .map(row => ({ ...row, expiry_date: state.lots.find(lot => lot.id === row.lot_id)?.expiry_date ?? null }))];
        return [state.balances.filter(row => params.some((_, offset) => offset % 5 === 0 && dimensionMatch(row, params, offset)))];
      }
      return security.tx.query(sql, params);
    },
    async execute({ sql, params, state }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("INSERT INTO inventory_lots")) {
        if (options.lotInsertConflict) throw Object.assign(new Error("synthetic duplicate"), { code: "ER_DUP_ENTRY" });
        state.lots.push({ id: 601, sku_id: params[0], lot_number: params[1], normalized_lot_number: params[2],
          expiry_date: params[3], manufacture_date: params[4], first_receipt_date: params[5], created_by: params[8] });
        return [{ insertId: 601, affectedRows: 1 }];
      } else if (sql.includes("UPDATE inventory_operation_requests") || sql.includes("UPDATE inventory_lots")) {
        assert.ok(database.calls.some(call => call.sql.includes("FROM fr_token_versions") && call.sql.includes("FOR SHARE")),
          "actor binding must follow the complete current security guard");
        const target = sql.includes("UPDATE inventory_operation_requests") ? "operation" : "lot";
        options.beforeBind?.(target, currentProof);
        if (options.bindZero === target) return [{ affectedRows: 0 }];
        if (options.bindError === target) throw Object.assign(new Error("synthetic binding error"), { code: "ER_LOCK_WAIT_TIMEOUT" });
        if (target === "operation") {
          assert.equal(state.operation.actorUserId, null);
          assert.equal(params[1], 91);
          assert.equal(params[2], state.operation.commandType);
          state.operation.actorUserId = params[0];
        } else {
          const row = state.lots.find(value => value.id === params[1] && value.created_by === null);
          if (!row) return [{ affectedRows: 0 }];
          row.created_by = params[0];
        }
      } else if (sql.includes("UPDATE inventory_stock_balances")) {
        const row = state.balances.find(value => value.id === params[3] && value.version === params[4]);
        if (!row || options.updateConflict) return [{ affectedRows: 0 }];
        row.on_hand_quantity = params[0]; row.fifo_anchor_date = params[1]; row.version++;
      } else if (sql.includes("INSERT INTO inventory_movements")) {
        const id = state.movements.length + 701; state.movements.push({ id, params });
        return [{ insertId: id, affectedRows: 1 }];
      } else assert.fail(sql);
      return [{ affectedRows: 1 }];
    }
  });
  service.database = database;
  service.locks = {
    async lockForCommand(tx, input) {
      assert.equal(input.balances, undefined);
      return { warehouses: [tx.state.warehouse], bins: [tx.state.bin], binLocks: tx.state.binLocks,
        stockControls: [{ warehouse_id: 2, sku_id: 12, reserved_quantity: options.reserved ?? 0 }], lots: tx.state.lots };
    },
    async lockBalancesAfterLot(tx, { balances }) {
      for (const dimension of balances) {
        const values = [dimension.warehouseId, dimension.skuId, dimension.binId, dimension.lotId ?? 0, dimension.stockStatus];
        if (!tx.state.balances.some(row => dimensionMatch(row, values, 0))) tx.state.balances.push({ id: 502 + tx.state.balances.length,
          warehouse_id: dimension.warehouseId, sku_id: dimension.skuId, bin_id: dimension.binId, lot_id: dimension.lotId,
          stock_status: dimension.stockStatus, on_hand_quantity: 0, allocated_quantity: 0, fifo_anchor_date: null, version: 1 });
      }
      options.beforeStock?.(tx);
      options.afterStockWait?.(currentProof);
      return tx.state.balances;
    }
  };
  return { service, database, security, async submit(input = adjustmentCommand()) {
    const proof = await highRiskSetup({ ...options.security, command: input });
    currentProof = proof;
    const method = input.authorization.purpose === "adjustment.post" ? "postAdjustment" : "postStatusTransfer";
    return service[method](proof.command, proof.issue());
  } };
}

test("ADJ031-UOM positive Adjustment posts immutable converted result and original source replay", async () => {
  const fixture = await adjustmentSetup();
  const input = adjustmentCommand({ expectedBalanceVersion: 3 });
  const result = await fixture.submit(input);
  assert.deepEqual(result, { status: "POSTED", operationId: 91,
    movementGroupId: "11111111-1111-4111-8111-111111111111", lineCount: 1,
    inputQuantity: 2, inputUom: { id: 8, code: "CASE" }, baseQuantity: 24, baseUom: { id: 5, code: "EA" } });
  assert.equal(fixture.database.state.balances[0].on_hand_quantity, 29);
  assert.equal(fixture.database.state.movements.length, 1);
  assert.equal(fixture.database.state.audits[0].afterSummary.signedRequestAt, NOW);
  fixture.service.itemLookup.resolveUomInTransaction = async () => { assert.fail("completed replay cannot reconvert UOM"); };
  assert.deepEqual(await fixture.submit(input), result);
  assert.equal(fixture.database.state.movements.length, 1);
  await assert.rejects(() => fixture.submit(adjustmentCommand({ expectedBalanceVersion: 3, quantity: 3 })), { code: "INVENTORY_SOURCE_CONFLICT" });
});

test("ADJ031-ACTOR-BIND new Operation and owned new Lot bind only after the final guard and replay stays immutable", async () => {
  let reached = 0;
  const fixture = await adjustmentSetup({ absent: true, profile: { trackingPolicy: "batch_expiry" },
    beforeStock(tx) {
      reached++;
      assert.equal(tx.state.operation.actorUserId, null);
      assert.equal(tx.state.lots[0].created_by, null);
      assert.equal(tx.state.movements.length, 0);
    } });
  const input = adjustmentCommand({ lotNumber: "NEW-ACTOR", expiryDate: "2027-01-01" });
  const result = await fixture.submit(input);
  const committed = fixture.database.state;
  assert.equal(reached, 1);
  assert.equal(committed.operation.actorUserId, 7);
  assert.equal(committed.lots[0].created_by, 7);
  assert.equal(committed.audits[0].actorUserId, 7);
  const bindings = () => fixture.database.calls.filter(call => /UPDATE inventory_(operation_requests|lots)/u.test(call.sql));
  assert.equal(bindings().length, 2);
  assert.deepEqual(await fixture.submit(input), result);
  assert.deepEqual(fixture.database.state, committed);
  assert.equal(bindings().length, 2);
});

test("ADJ031-ACTOR-BIND zero/error/deadline/abort during either binding rolls back every artifact", async () => {
  for (const target of ["operation", "lot"]) for (const failure of ["zero", "error", "deadline", "abort"]) {
    let reached = false;
    const fixture = await adjustmentSetup({ absent: true, profile: { trackingPolicy: "batch_expiry" },
      bindZero: failure === "zero" ? target : null, bindError: failure === "error" ? target : null,
      beforeBind(actual, proof) {
        if (actual !== target) return;
        reached = true;
        if (failure === "deadline") proof.advance(60_001);
        if (failure === "abort") proof.abort.abort(Object.assign(new Error("timeout"), { code: "REQUEST_TIMEOUT" }));
      } });
    const before = fixture.database.state;
    await assert.rejects(() => fixture.submit(adjustmentCommand({ lotNumber: "ROLLBACK-ACTOR", expiryDate: "2027-01-01" })),
      { code: failure === "deadline" ? "DEVICE_SIGNATURE_STALE" : failure === "abort" ? "REQUEST_TIMEOUT" : "CONCURRENT_OPERATION" });
    assert.equal(reached, true, "the intended binding must actually be reached");
    assert.deepEqual(fixture.database.state, before);
  }
});

test("ADJ031-ACTOR-BIND existing NULL Lot creator is never backfilled and an actual new-Lot insert race rolls back", async () => {
  const lot = { id: 601, sku_id: 12, lot_number: "EXISTING", normalized_lot_number: "EXISTING", expiry_date: "2027-01-01",
    manufacture_date: null, first_receipt_date: "2026-01-01", created_by: null };
  const fixture = await adjustmentSetup({ absent: true, initialState: { lots: [lot] }, profile: { trackingPolicy: "batch_expiry" } });
  await fixture.submit(adjustmentCommand({ lotNumber: "EXISTING", expiryDate: "2027-01-01" }));
  assert.deepEqual(fixture.database.state.lots[0], lot);
  assert.equal(fixture.database.calls.filter(call => call.sql.includes("UPDATE inventory_lots")).length, 0);
  const raced = await adjustmentSetup({ absent: true, lotInsertConflict: true, profile: { trackingPolicy: "batch_expiry" } });
  const before = raced.database.state;
  await assert.rejects(() => raced.submit(adjustmentCommand({ lotNumber: "RACED", expiryDate: "2027-01-01" })), { code: "CONCURRENT_OPERATION" });
  assert.deepEqual(raced.database.state, before);
});

test("ADJ031-STATUS all six directions conserve stock with paired legs and free quantity protection", async () => {
  for (const from of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) for (const to of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    if (from === to) continue;
    const fixture = await adjustmentSetup({ uom: { toBaseFactor: 1 }, initialState: { balance: {
      id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null, stock_status: from,
      on_hand_quantity: 5, allocated_quantity: 1, fifo_anchor_date: "2026-01-01", version: 3 } } });
    const input = adjustmentCommand({}, "status_transfer.post");
    input.payload = { sourceBalanceId: 501, destinationStatus: to, expectedSourceVersion: 3,
      expectedDestinationVersion: null, quantity: 2, uomId: 8, reasonText: "Inspection confirmed" };
    const result = await fixture.submit(input);
    assert.equal(result.lineCount, 2);
    assert.deepEqual(fixture.database.state.balances.map(row => [row.on_hand_quantity, row.allocated_quantity]), [[3,1],[2,0]]);
    assert.equal(fixture.database.state.movements.length, 2);
    assert.equal(fixture.database.state.balances[1].fifo_anchor_date, "2026-09-28");
  }
});

test("ADJ031-OUT-RESERVED negative Adjustment cannot spend allocated or increase uncovered Reserved", async () => {
  for (const [options, amount, code] of [[{ reserved: 4 }, 2, "INSUFFICIENT_ATP"],
    [{ initialState: { balance: { id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
      stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 4, version: 3 } } }, 2, "INSUFFICIENT_STOCK"]]) {
    const fixture = await adjustmentSetup({ ...options, uom: { toBaseFactor: 1 } });
    const before = fixture.database.state;
    const input = adjustmentCommand();
    input.payload = { direction: "OUT", balanceId: 501, expectedBalanceVersion: 3, quantity: amount, uomId: 8,
      reasonCategory: "DAMAGE", reasonText: "Physical damage" };
    await assert.rejects(() => fixture.submit(input), { code });
    assert.deepEqual(fixture.database.state, before);
  }
});

test("ADJ031-LOCKS-VERSION absent/present expectations and missing proof leave zero effects", async () => {
  for (const [absent, version] of [[false, null], [false, 2], [true, 3]]) {
    const fixture = await adjustmentSetup({ absent });
    const before = fixture.database.state;
    await assert.rejects(() => fixture.submit(adjustmentCommand({ expectedBalanceVersion: version })), { code: "VERSION_CONFLICT" });
    assert.deepEqual(fixture.database.state, before);
  }
  const fixture = await adjustmentSetup();
  await assert.rejects(() => fixture.service.postAdjustment(adjustmentCommand({ expectedBalanceVersion: 3 }), {}), { code: "PERMISSION_STALE" });
  assert.equal(fixture.database.calls.length, 0);
});

test("ADJ031-IN-LOT new Lot reuses exact Receipt resolution and all checkpoints roll back", async () => {
  for (const failAt of [null, ...INVENTORY_FAILURE_POINTS]) {
    const fixture = await adjustmentSetup({ absent: true, failAt, profile: { trackingPolicy: "batch_expiry" } });
    const before = fixture.database.state;
    const input = adjustmentCommand({ lotNumber: " NEW-LOT ", expiryDate: "2027-01-01" });
    if (failAt) {
      await assert.rejects(() => fixture.submit(input), { faultPoint: failAt });
      assert.deepEqual(fixture.database.state, before);
    } else {
      await fixture.submit(input);
      assert.equal(fixture.database.state.lots[0].first_receipt_date, "2026-09-28");
      assert.equal(fixture.database.state.lots[0].normalized_lot_number, "NEW-LOT");
      assert.equal(fixture.database.state.balances[0].lot_id, 601);
    }
  }
});

test("ADJ031-INPUT strict single-op normalization requires UOM, original versions and unmixed targets", async () => {
  const { normalizeAdjustmentCommand } = await import("../src/modules/inventory/inventoryAdjustmentPosting.js");
  const tx = { query() {}, execute() {} };
  const normalized = normalizeAdjustmentCommand(tx, adjustmentCommand(), "adjustment.post");
  assert.equal(normalized.payload.expectedBalanceVersion, null);
  assert.equal(normalized.payload.uomId, 8);
  for (const payload of [{ uomId: undefined }, { quantity: "2" }, { skuId: true },
    { expectedBalanceVersion: undefined }, { expectedBalanceVersion: 4_294_967_296 },
    { balanceId: 1 }, { lotId: 1 }, { firstReceiptDate: "2026-01-01" }, { isHighRisk: true },
    { minimumLifeOverride: {} }, { lines: [] }, { quantityUnit: "BASE" }, { reasonCategory: "UNKNOWN" }]) {
    assert.throws(() => normalizeAdjustmentCommand(tx, adjustmentCommand(payload), "adjustment.post"));
  }
  const out = adjustmentCommand();
  out.payload = { direction: "OUT", balanceId: 501, expectedBalanceVersion: 3, quantity: 2, uomId: 8,
    reasonText: "Damage found", reasonCategory: "DAMAGE" };
  assert.equal(normalizeAdjustmentCommand(tx, out, "adjustment.post").payload.balanceId, 501);
  assert.throws(() => normalizeAdjustmentCommand(tx, { ...out, payload: { ...out.payload, expectedBalanceVersion: null } }, "adjustment.post"));
  const status = adjustmentCommand({}, "status_transfer.post");
  status.payload = { sourceBalanceId: 501, destinationStatus: "DAMAGED", expectedSourceVersion: 3,
    expectedDestinationVersion: null, quantity: 2, uomId: 8, reasonText: "Damage inspection" };
  assert.equal(normalizeAdjustmentCommand(tx, status, "status_transfer.post").payload.expectedDestinationVersion, null);
  assert.throws(() => normalizeAdjustmentCommand(tx, { ...status, payload: { ...status.payload, reasonCategory: "DAMAGE" } }, "status_transfer.post"));
});

test("ADJ031-REASON normalized reasons obey UTF-8 bytes, control rejection and OTHER code-point floor", async () => {
  const { normalizeAdjustmentCommand } = await import("../src/modules/inventory/inventoryAdjustmentPosting.js");
  const normalize = (reasonText, reasonCategory = "COUNT_GAIN") => normalizeAdjustmentCommand({ query() {}, execute() {} },
    adjustmentCommand({ reasonText, reasonCategory }), "adjustment.post").payload;
  assert.equal(normalize("  count  ").reasonText, "count");
  assert.equal(normalize("界".repeat(166)).reasonText.length, 166);
  for (const invalid of ["", "  ", "界".repeat(167), "x".repeat(501), "reason\ntext", "reason\u007ftext"]) {
    assert.throws(() => normalize(invalid), { code: "INVENTORY_INPUT_INVALID" });
  }
  assert.equal(normalize("😀".repeat(10), "OTHER").reasonCategory, "OTHER");
  assert.throws(() => normalize("😀".repeat(9) + "  ", "OTHER"), { code: "INVENTORY_INPUT_INVALID" });
  for (const reasonCategory of ["COUNT_GAIN", "COUNT_LOSS", "DAMAGE", "EXPIRY", "DATA_CORRECTION", "TRANSFER_VARIANCE", "OTHER"]) {
    assert.equal(normalize("Complete physical explanation", reasonCategory).reasonCategory, reasonCategory);
  }
});

test("TASK-030 Bin Move validates the whole document before authorizing or writing", async () => {
  const { service, database } = setup();
  const before = database.state;
  for (const lines of [[], [{ sourceBalanceId: 501, destinationBinId: 36, quantity: 1,
    expectedSourceVersion: 3 }], [{ sourceBalanceId: "501", destinationBinId: 36,
    quantity: 1, expectedSourceVersion: 3, expectedDestinationVersion: null }]]) {
    await assert.rejects(() => service.postBinMove(inventoryCommandFixture({
      actor: { claimedPermissions: ["inventory.operation"] },
      authorization: { purpose: "bin_move.post", requiredCallerPermission: "inventory.operation" },
      payload: { warehouseId: 2, lines }
    })), { code: "INVENTORY_INPUT_INVALID" });
  }
  assert.deepEqual(database.state, before);
  assert.deepEqual(database.calls, []);
});

function command(payload = {}, overrides = {}) {
  return inventoryCommandFixture({
    actor: {
      claimedPermissions: ["inventory.operation", ...(overrides.overridePermission ? ["receiving.expiry.override"] : [])]
    },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    correlationId: "request-1",
    payload: {
      skuId: 12,
      quantity: 2,
      uomId: 8,
      warehouseId: 2,
      binId: 35,
      stockStatus: "AVAILABLE",
      ...payload
    },
    source: overrides.source
  });
}

function setup({ failAt = null, profile = {}, uom = {}, initialState = {}, currentPermissions, lookupError } = {}) {
  const state = {
    warehouse: { id: 2, warehouse_code: "WH-1", status: "ACTIVE" },
    bin: { id: 35, warehouse_id: 2, bin_code: "A-01", status: "ACTIVE" },
    binLocks: [],
    balance: {
      id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
      stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 0, version: 3
    },
    lots: [], movements: [], audits: [], completed: null,
    ...structuredClone(initialState)
  };
  const database = createFakeInventoryDatabase({
    initialState: state,
    failAt,
    async query({ sql, params, state: draft }) {
      if (sql.includes("FROM inventory_lots")) {
        const row = draft.lots.find((lot) => lot.sku_id === params[0] && lot.normalized_lot_number === params[1]);
        return [[row].filter(Boolean)];
      }
      return [[]];
    },
    async execute({ sql, params, state: draft }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("INSERT INTO inventory_lots")) {
        let lot = draft.lots.find((value) => value.sku_id === params[0] && value.normalized_lot_number === params[2]);
        if (!lot) {
          lot = {
            id: 601, sku_id: params[0], lot_number: params[1], normalized_lot_number: params[2],
            expiry_date: params[3], manufacture_date: params[4], first_receipt_date: params[5]
          };
          draft.lots.push(lot);
        }
        return [{ insertId: lot.id, affectedRows: 1 }];
      }
      if (sql.includes("UPDATE inventory_stock_balances")) {
        draft.balance.on_hand_quantity += params[0];
        draft.balance.version += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        draft.movements.push({ id: 701, params });
        return [{ insertId: 701, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  });
  const itemProfile = {
    skuId: 12, skuCode: "SKU-12", skuName: "Widget", skuStatus: "active", itemStatus: "active",
    inventoryTracked: true, trackingPolicy: "none", shelfLifeDays: null,
    minimumReceiptLifeDays: 0, minimumSaleLifeDays: 0,
    baseUom: { uomId: 5, uomCode: "EA" }, usable: true, reasons: [],
    ...profile
  };
  const itemLookup = {
    async getInventoryProfileInTransaction() {
      if (lookupError) throw lookupError;
      return structuredClone(itemProfile);
    },
    async resolveUomInTransaction() {
      return { skuId: 12, uomId: 8, uomCode: "CASE", toBaseFactor: 12, isBase: false, ...uom };
    }
  };
  const operations = {
    async claim(transaction, input) {
      if (transaction.state.completed && transaction.state.operation?.source.eventId === input.source.eventId) {
        if (JSON.stringify(transaction.state.operation.payload) !== JSON.stringify(input.payload)) {
          throw Object.assign(new Error("source conflict"), { code: "INVENTORY_SOURCE_CONFLICT" });
        }
        return { operationId: 91, replay: { resultSummary: transaction.state.completed } };
      }
      transaction.state.operation = input;
      transaction.state.completed = null;
      return { operationId: 91, replay: null };
    },
    async complete(transaction, input) { transaction.state.completed = input.resultSummary; }
  };
  const locks = {
    async lockForCommand(transaction) {
      return {
        warehouses: [transaction.state.warehouse].filter(Boolean),
        stockControls: [{ id: 401, warehouse_id: 2, sku_id: 12 }],
        bins: [transaction.state.bin].filter(Boolean),
        binLocks: transaction.state.binLocks,
        lots: transaction.state.lots
      };
    },
    async lockBalancesAfterLot(transaction, input) {
      transaction.state.balance.lot_id = input.balances[0].lotId;
      return [transaction.state.balance];
    }
  };
  const audit = {
    async recordSucceeded(transaction, input) { transaction.state.audits.push(input); }
  };
  const service = new InventoryPostingService({
    database,
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    itemLookup,
    operations,
    locks,
    audit,
    authorize: async (_transaction, input) => ({
      id: input.actorId,
      username: "sam",
      permissions: [...(currentPermissions ?? input.claimedPermissions)]
    }),
    createMovementGroupId: () => "11111111-1111-4111-8111-111111111111"
  });
  return { service, database };
}

function internalReceipt(permission, payload = {}, overrides = {}) {
  return {
    actor: {
      userId: 7,
      serviceName: "",
      claimedRoles: ["warehouse-operator"],
      claimedPermissions: [permission]
    },
    source: {
      documentId: "receipt-42",
      lineId: "10",
      eventId: "posted-1",
      ...overrides.source
    },
    correlationId: "request-1",
    payload: {
      skuId: 12,
      quantity: 2,
      uomId: 8,
      warehouseId: 2,
      binId: 35,
      ...payload
    },
    ...overrides.command
  };
}

function binMoveCommand(lines = [binMoveLine()], payload = {}, source = {}) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "bin_move.post", requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "BIN_MOVE", eventId: "bin-move-1", ...source },
    payload: { warehouseId: 2, lines, ...payload } });
}
function binMoveLine(overrides = {}) {
  return { sourceBalanceId: 501, destinationBinId: 36, quantity: 2,
    expectedSourceVersion: 3, expectedDestinationVersion: null, ...overrides };
}
function binMoveSetup(options = {}) {
  const { service, database: receiptDb } = setup(options);
  const state = receiptDb.state;
  state.balances = [state.balance, ...(options.destination ? [{ ...state.balance,
    id: 502, bin_id: 36, on_hand_quantity: 4, version: 5 }] : [])];
  state.balances[0].fifo_anchor_date = "2026-01-01";
  state.bins = [state.bin, { ...state.bin, id: 36, bin_code: "A-02" }];
  const database = createFakeInventoryDatabase({ initialState: state, failAt: options.failAt,
    query: async ({ sql, params, state: draft }) => {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("FOR UPDATE")) return [draft.balances];
      return [draft.balances.filter(row => params.includes(row.id))];
    },
    execute: async ({ sql, params, state: draft }) => {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("UPDATE inventory_stock_balances")) {
        const row = draft.balances.find(row => row.id === params[3] && row.version === params[4]);
        if (!row || options.updateConflict) return [{ affectedRows: 0 }];
        row.on_hand_quantity = params[0]; row.fifo_anchor_date = params[1]; row.version++;
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        const id = draft.movements.length + 701;
        draft.movements.push({ id, params });
        return [{ insertId: id, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  });
  service.database = database;
  service.locks = {
    async lockForCommand(tx, input) {
      assert.equal(input.balances, undefined, "do not create destination before absence/version checks");
      return { warehouses: [tx.state.warehouse].filter(Boolean), bins: tx.state.bins,
        stockControls: [{ warehouse_id: 2, sku_id: 12 }], binLocks: tx.state.binLocks, lots: tx.state.lots };
    },
    async lockBalancesAfterLot(tx, { balances }) {
      for (const dimension of balances) {
        if (!tx.state.balances.some(row => row.bin_id === dimension.binId)) {
          tx.state.balances.push({ ...state.balance, id: 502, bin_id: dimension.binId,
            on_hand_quantity: 0, allocated_quantity: 0, fifo_anchor_date: null, version: 1 });
        }
      }
      return tx.state.balances;
    }
  };
  return { service, database };
}

test("TASK-030 multi-line Move creates one Operation/group with paired snapshot/version chains", async () => {
  const { service, database } = binMoveSetup();
  const result = await service.postBinMove(binMoveCommand([binMoveLine(), binMoveLine()]));
  assert.deepEqual(result, { status: "POSTED", operationId: 91,
    movementGroupId: "11111111-1111-4111-8111-111111111111", lineCount: 2 });
  assert.equal(database.state.operation.commandType, "BIN_MOVE_POST");
  assert.deepEqual(database.state.balances.map(row => [row.on_hand_quantity, row.allocated_quantity, row.version]), [[1,0,5],[4,0,3]]);
  assert.deepEqual(database.state.movements.map(row => row.params.slice(7,12)),
    [["OUT",2,5,3,4],["IN",2,0,2,2],["OUT",2,3,1,5],["IN",2,2,4,3]]);
  assert.equal(database.state.balances[0].fifo_anchor_date, "2026-01-01");
  assert.equal(database.state.balances[1].fifo_anchor_date, "2026-09-28");
  assert.equal(database.state.audits.length, 4);
  assert.deepEqual(database.state.completed, result);
});

test("TASK-030 normalized source replay is immutable but reauthorizes and conflicts on line order", async () => {
  const { service, database } = binMoveSetup();
  const input = binMoveCommand([binMoveLine({ quantity: 1 }), binMoveLine({ quantity: 2 })], { reason: "  shelf move  " });
  const first = await service.postBinMove(input);
  const before = database.state;
  assert.deepEqual(await service.postBinMove({ ...input, payload: { ...input.payload, reason: "shelf move" } }), first);
  assert.deepEqual(database.state, before);
  await assert.rejects(() => service.postBinMove({ ...input, payload: { ...input.payload, lines: [...input.payload.lines].reverse() } }),
    { code: "INVENTORY_SOURCE_CONFLICT" });
  service.authorize = async () => ({ permissions: [] });
  await assert.rejects(() => service.postBinMove(input), { code: "PERMISSION_STALE" });
  assert.deepEqual(database.state, before);
});

test("TASK-030 source/destination starting versions and absence expectations fail with zero effects", async () => {
  for (const [destination, lines] of [[false, [binMoveLine({ expectedSourceVersion: 2 })]],
    [true, [binMoveLine()]], [false, [binMoveLine({ expectedDestinationVersion: 5 })]],
    [true, [binMoveLine({ expectedDestinationVersion: 4 })]],
    [false, [binMoveLine(), binMoveLine({ expectedSourceVersion: 4 })]],
    [false, [binMoveLine(), binMoveLine({ expectedDestinationVersion: 2 })]]]) {
    const { service, database } = binMoveSetup({ destination });
    const before = database.state;
    await assert.rejects(() => service.postBinMove(binMoveCommand(lines)), { code: "VERSION_CONFLICT" });
    assert.deepEqual(database.state, before);
  }
});

test("TASK-030 gross OUT cannot spend allocated stock or incoming stock", async () => {
  const { service, database } = binMoveSetup({ destination: true, initialState: { balance: {
    id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null, stock_status: "AVAILABLE",
    on_hand_quantity: 5, allocated_quantity: 2, version: 3 } } });
  const before = database.state;
  for (const lines of [[binMoveLine({ quantity: 4, expectedDestinationVersion: 5 })],
    [binMoveLine({ sourceBalanceId: 502, destinationBinId: 35, quantity: 1,
      expectedSourceVersion: 5, expectedDestinationVersion: 3 }),
    binMoveLine({ quantity: 4, expectedDestinationVersion: 5 })]]) {
    await assert.rejects(() => service.postBinMove(binMoveCommand(lines)), { code: "INSUFFICIENT_STOCK" });
    assert.deepEqual(database.state, before);
  }
});

test("TASK-030 every transaction checkpoint rolls back zero-row creation and all earlier legs", async () => {
  for (const failAt of INVENTORY_FAILURE_POINTS) {
    const { service, database } = binMoveSetup({ failAt });
    const before = database.state;
    await assert.rejects(() => service.postBinMove(binMoveCommand()), error => error.faultPoint === failAt);
    assert.deepEqual(database.state, before);
  }
});

test("TASK-030 rejects unsafe arithmetic, version exhaustion, update races and unavailable profile", async () => {
  for (const [options, code] of [[{ destination: true, initialState: { balance: {
    id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null, stock_status: "AVAILABLE",
    on_hand_quantity: Number.MAX_SAFE_INTEGER, allocated_quantity: 0, version: 3 } } }, "INVENTORY_QUANTITY_INVALID"],
    [{ initialState: { balance: { id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12,
      lot_id: null, stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 0,
      version: 4_294_967_295 } } }, "CONCURRENT_OPERATION"],
    [{ updateConflict: true }, "CONCURRENT_OPERATION"], [{ profile: { usable: false } }, "INVENTORY_INPUT_INVALID"]]) {
    const { service, database } = binMoveSetup(options);
    const before = database.state;
    const lines = options.destination ? [binMoveLine({ sourceBalanceId: 502, destinationBinId: 35,
      expectedSourceVersion: 5, expectedDestinationVersion: 3 })]
      : [binMoveLine({ expectedSourceVersion: options.initialState?.balance?.version ?? 3 })];
    await assert.rejects(() => service.postBinMove(binMoveCommand(lines)), { code });
    assert.deepEqual(database.state, before);
  }
});

test("TASK-014 Receipt converts Pack UOM and atomically updates Balance, Movement, Audit and operation", async () => {
  const { service, database } = setup();

  const result = await service.postReceipt(command());

  assert.deepEqual(result.inputUom, { id: 8, code: "CASE" });
  assert.deepEqual(result.baseUom, { id: 5, code: "EA" });
  assert.equal(result.inputQuantity, 2);
  assert.equal(result.baseQuantity, 24);
  assert.deepEqual(result.balance, { id: 501, onHandQuantity: 29, allocatedQuantity: 0, version: 4 });
  assert.equal(database.state.movements.length, 1);
  assert.equal(database.state.audits.length, 1);
  assert.equal(database.state.completed.movementId, 701);
});

test("TASK-014 completed source replays without another quantity effect", async () => {
  const { service, database } = setup();
  const first = await service.postReceipt(command());
  const replay = await service.postReceipt(command());

  assert.deepEqual(replay, first);
  assert.equal(database.state.balance.on_hand_quantity, 29);
  assert.equal(database.state.movements.length, 1);
  assert.equal(database.state.audits.length, 1);
});

test("TASK-014 same source with different receipt content conflicts", async () => {
  const { service, database } = setup();
  await service.postReceipt(command());

  await assert.rejects(
    () => service.postReceipt(command({ quantity: 3 })),
    (error) => error.code === "INVENTORY_SOURCE_CONFLICT"
  );
  assert.equal(database.state.balance.on_hand_quantity, 29);
  assert.equal(database.state.movements.length, 1);
});

test("TASK-014 posts each allowlisted manual stock status", async () => {
  for (const stockStatus of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    const { service } = setup({ initialState: { balance: {
      id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
      stock_status: stockStatus, on_hand_quantity: 0, allocated_quantity: 0, version: 1
    } } });
    const result = await service.postReceipt(command({ stockStatus }));
    assert.equal(result.stockStatus, stockStatus);
  }
});

test("TASK-014 injected failures leave no partial current state, Movement, Audit or operation", async () => {
  for (const failAt of INVENTORY_FAILURE_POINTS) {
    const { service, database } = setup({ failAt });
    await assert.rejects(() => service.postReceipt(command()), { faultPoint: failAt });
    assert.equal(database.state.balance.on_hand_quantity, 5, failAt);
    assert.equal(database.state.movements.length, 0, failAt);
    assert.equal(database.state.audits.length, 0, failAt);
    assert.equal(database.state.completed, null, failAt);
  }
});

test("TASK-014 fails closed for unusable, untracked and serial SKUs and inactive locations", async () => {
  for (const [options, code] of [
    [{ profile: { usable: false, reasons: ["NOT_ACTIVE"] } }, "INVENTORY_INPUT_INVALID"],
    [{ profile: { inventoryTracked: false } }, "SKU_NOT_INVENTORY_TRACKED"],
    [{ profile: { trackingPolicy: "serial" } }, "SERIAL_TRACKING_UNSUPPORTED"],
    [{ initialState: { warehouse: { id: 2, warehouse_code: "WH-1", status: "INACTIVE" } } }, "WAREHOUSE_INVALID"],
    [{ initialState: { bin: { id: 35, warehouse_id: 2, bin_code: "A-01", status: "INACTIVE" } } }, "BIN_INVALID"]
  ]) {
    const { service, database } = setup(options);
    await assert.rejects(() => service.postReceipt(command()), (error) => error.code === code);
    assert.equal(database.state.movements.length, 0);
  }
});

test("TASK-014 records exact minimum-life override evidence and rejects conflicting Lot data", async () => {
  const { service, database } = setup({
    profile: { trackingPolicy: "batch_expiry", minimumReceiptLifeDays: 60 }
  });
  const payload = {
    lotNumber: "LOT-A", expiryDate: "2026-11-12", manufactureDate: "2026-09-01",
    minimumLifeOverride: {
      permission: "receiving.expiry.override",
      reason: "Approved short-dated receipt",
      minimumLifeDaysApplied: 60,
      actualRemainingLifeDays: 45,
      actorId: 7,
      receiptId: "receipt-42",
      requestId: "request-1"
    }
  };

  const { minimumLifeOverride: _override, ...withoutOverride } = payload;
  await assert.rejects(
    () => service.postReceipt(command(withoutOverride)),
    (error) => error.code === "LOT_MINIMUM_LIFE_FAILED"
  );
  const result = await service.postReceipt(command(payload, { overridePermission: true }));
  assert.equal(result.lotId, 601);
  assert.equal(database.state.audits[0].afterSummary.minimumLifeDaysApplied, 60);
  assert.equal(database.state.audits[0].afterSummary.actualRemainingLifeDays, 45);

  await assert.rejects(
    () => service.postReceipt(command(
      {
        ...payload,
        expiryDate: "2026-11-13",
        minimumLifeOverride: { ...payload.minimumLifeOverride, actualRemainingLifeDays: 46 }
      },
      { overridePermission: true, source: { eventId: "posted-2" } }
    )),
    (error) => error.code === "LOT_DATA_CONFLICT"
  );
});

test("TASK-014 never overrides expired Lots and rejects mismatched override evidence", async () => {
  const options = { profile: { trackingPolicy: "batch_expiry", minimumReceiptLifeDays: 60 } };
  const expired = setup(options).service;
  await assert.rejects(
    () => expired.postReceipt(command({ lotNumber: "LOT-X", expiryDate: "2026-09-27" })),
    (error) => error.code === "LOT_EXPIRED"
  );

  const invalid = setup(options).service;
  await assert.rejects(
    () => invalid.postReceipt(command({
      lotNumber: "LOT-X",
      expiryDate: "2026-11-12",
      minimumLifeOverride: {
        permission: "receiving.expiry.override",
        reason: "Approved short-dated receipt",
        minimumLifeDaysApplied: 60,
        actualRemainingLifeDays: 44,
        actorId: 7,
        receiptId: "receipt-42",
        requestId: "request-1"
      }
    }, { overridePermission: true })),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});

test("TASK-015 Receiving contract owns authorization and source mapping", async () => {
  const { service, database } = setup();
  const input = internalReceipt("receiving.operation", { stockStatus: "AVAILABLE" });

  const result = await database.withTransaction(
    (transaction) => service.postReceivingReceiptInTransaction(transaction, input)
  );

  assert.equal(result.stockStatus, "AVAILABLE");
  assert.deepEqual(database.state.operation.source, {
    module: "PURCHASING_RECEIVING",
    documentType: "GOODS_RECEIPT",
    documentId: "receipt-42",
    lineId: "10",
    eventId: "posted-1"
  });
  const replay = await database.withTransaction(
    (transaction) => service.postReceivingReceiptInTransaction(transaction, input)
  );
  assert.deepEqual(replay, result);
  assert.equal(database.state.movements.length, 1);
  await assert.rejects(
    () => database.withTransaction((transaction) => service.postReceivingReceiptInTransaction(
      transaction,
      internalReceipt("receiving.operation", { stockStatus: "AVAILABLE" }, {
        command: { authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" } }
      })
    )),
    (error) => error.code === "INVENTORY_INPUT_INVALID" && error.details.field === "authorization"
  );
  await assert.rejects(
    () => database.withTransaction((transaction) => service.postReceivingReceiptInTransaction(
      transaction,
      internalReceipt("inventory.operation", { stockStatus: "AVAILABLE" })
    )),
    /required caller permission/
  );
});

test("TASK-015 Customer Return contract fixes permission, source and QUARANTINED status", async () => {
  const { service, database } = setup();
  const result = await database.withTransaction(
    (transaction) => service.postCustomerReturnReceiptInTransaction(
      transaction,
      internalReceipt("returns.operation")
    )
  );

  assert.equal(result.stockStatus, "QUARANTINED");
  assert.equal(database.state.operation.payload.stockStatus, "QUARANTINED");
  assert.deepEqual(database.state.operation.source, {
    module: "RETURNS",
    documentType: "CUSTOMER_RETURN",
    documentId: "receipt-42",
    lineId: "10",
    eventId: "posted-1"
  });
  await assert.rejects(
    () => database.withTransaction((transaction) => service.postCustomerReturnReceiptInTransaction(
      transaction,
      internalReceipt("returns.operation", { stockStatus: "AVAILABLE" })
    )),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});

test("TASK-015 caller and Inventory writes share one transaction boundary", async () => {
  const callerFailure = setup({ initialState: { sourceStatus: "DRAFT" } });
  await assert.rejects(
    () => callerFailure.database.withTransaction(async (transaction) => {
      transaction.state.sourceStatus = "POSTING";
      await callerFailure.service.postReceivingReceiptInTransaction(
        transaction,
        internalReceipt("receiving.operation", { stockStatus: "AVAILABLE" })
      );
      throw new Error("caller source write failed");
    }),
    /caller source write failed/
  );
  assert.equal(callerFailure.database.state.sourceStatus, "DRAFT");
  assert.equal(callerFailure.database.state.balance.on_hand_quantity, 5);

  const inventoryFailure = setup({ failAt: "movement", initialState: { sourceStatus: "DRAFT" } });
  await assert.rejects(
    () => inventoryFailure.database.withTransaction(async (transaction) => {
      transaction.state.sourceStatus = "POSTING";
      await inventoryFailure.service.postReceivingReceiptInTransaction(
        transaction,
        internalReceipt("receiving.operation", { stockStatus: "AVAILABLE" })
      );
    }),
    { faultPoint: "movement" }
  );
  assert.equal(inventoryFailure.database.state.sourceStatus, "DRAFT");
  assert.equal(inventoryFailure.database.state.balance.on_hand_quantity, 5);
});

test("TASK-015 fails closed for missing transaction, revoked permission and unavailable Item", async () => {
  const input = internalReceipt("receiving.operation", { stockStatus: "AVAILABLE" });
  await assert.rejects(
    () => setup().service.postReceivingReceiptInTransaction(null, input),
    /caller-owned transaction executor/
  );

  const revoked = setup({ currentPermissions: [] });
  await assert.rejects(
    () => revoked.database.withTransaction(
      (transaction) => revoked.service.postReceivingReceiptInTransaction(transaction, input)
    ),
    (error) => error.code === "PERMISSION_STALE"
  );
  assert.equal(revoked.database.state.balance.on_hand_quantity, 5);

  const unavailable = setup({ lookupError: Object.assign(new Error("Item unavailable"), { code: "ITEM_UNAVAILABLE" }) });
  await assert.rejects(
    () => unavailable.database.withTransaction(
      (transaction) => unavailable.service.postReceivingReceiptInTransaction(transaction, input)
    ),
    { code: "ITEM_UNAVAILABLE" }
  );
  assert.equal(unavailable.database.state.balance.on_hand_quantity, 5);
});
