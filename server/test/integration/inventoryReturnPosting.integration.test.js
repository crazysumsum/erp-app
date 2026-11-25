import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReceiptContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { issueInventoryReturnContext } from "../../src/modules/inventory/InventoryReturnContext.js";
import { InventoryReturnPostingService } from "../../src/modules/inventory/InventoryReturnPostingService.js";
import { lockInventoryCostPools, persistInventoryCostBatch } from "../../src/modules/inventory/inventoryCostLedger.js";
import { outboundCost } from "../../src/modules/inventory/inventoryCostMath.js";
import { purchaseNativeFixture, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";

const native = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_PURCHASE_TESTS === "1" ? test : test.skip;
async function snapshot(f) {
  const state = {};
  for (const table of ["inventory_movements", "inventory_stock_balances", "inventory_stock_controls", "inventory_operation_requests",
    "inventory_audit_logs", "inventory_cost_entries", "inventory_cost_pools"]) {
    [state[table]] = await f.db.query(`SELECT * FROM ${table} ORDER BY ${table === "inventory_cost_pools" ? "sku_id" : "id"}`);
  }
  return state;
}

async function syntheticIssuedMovement(f, receiptId, withCost) {
  return f.withRequest(f.command(), async tx => {
    const ops = new InventoryOperationService(), at = f.time.nowMs();
    const claim = await ops.claim(tx, { commandType: "ISSUE_POST",
      source: { module: "INVENTORY", documentType: "TEST_ISSUE_FIXTURE", documentId: "901", lineId: "1", eventId: randomUUID() },
      payload: { quantity: 4 }, actorUserId: f.actor.userId, actorLabel: "Synthetic issued fact", createdAt: at });
    await tx.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL,version=version+1 WHERE sku_id=?", [f.skuId]);
    const skuId = String(f.skuId);
    const pool = await lockInventoryCostPools(tx, [skuId], at);
    const group = randomUUID();
    const [movement] = await tx.execute(`INSERT INTO inventory_movements(movement_group_id,operation_request_id,movement_type,
      location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,
      sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,
      posted_at,posted_by,posted_by_label)
      SELECT ?,?,'ISSUE',location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,'OUT',4,4,0,3,
        sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,?,?,?
      FROM inventory_movements WHERE id=?`, [group, claim.operationId, at, f.actor.userId, "Synthetic", receiptId]);
    if (withCost) await persistInventoryCostBatch(tx, pool, [{ ...outboundCost(pool.get(skuId), 4n),
      skuId, movementId: movement.insertId, kind: "ISSUE", source: "POOL" }], at);
    await ops.complete(tx, { operationId: claim.operationId, resultType: "MOVEMENT_GROUP", resultId: group,
      resultSummary: { status: "POSTED", rowCount: 1 }, completedAt: at });
    return movement.insertId;
  });
}

async function fixture(t, kind, { withCost = true, expiredLot = false } = {}) {
  const f = await purchaseNativeFixture(t, { fullSchema: true });
  const receive = f.command();
  receive.lines[0].baseQuantity = 4;
  if (expiredLot) {
    await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry' WHERE id=?", [f.skuId]);
    Object.assign(receive.lines[0], { lotNumber: "SYNTHETIC-RETURN", expiryDate: "2026-10-29" });
    receive.lines[0].commitment.trackingPolicySnapshot = "batch_expiry";
  }
  const { lines } = await f.withRequest(receive, (tx, req) => {
    receive.context = issuePurchaseReceiptContext(req, tx, receive, purchaseConfirmedLines(receive),
      { ...f.options, costInputs: [{ sourceLineId: "81", currencyCode: "HKD", unitPrice: "1.0001", toBaseFactor: 1 }] });
    return new InventoryPostingService(f).postPurchaseReceiptBatchInTransaction(tx, receive);
  });
  const originalMovementId = String(kind === "supplier" ? lines[0].movementId : await syntheticIssuedMovement(f, lines[0].movementId, withCost));
  const [[original]] = await f.db.query("SELECT lot_id FROM inventory_movements WHERE id=?", [originalMovementId]);
  const lotId = original.lot_id === null ? null : String(original.lot_id);
  if (expiredLot) f.time.fileDate = () => "2026-10-30";
  const permission = `returns.${kind}.mgmt`;
  await f.db.query("INSERT IGNORE INTO permissions(name,created_at) VALUES (?,1)", [permission]);
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?", [f.roleId, permission]);
  f.actor.claimedPermissions.push(permission);
  const command = (quantities = [1]) => ({ actor: { userId: f.actor.userId, claimedRoles: f.actor.claimedRoles,
    claimedPermissions: f.actor.claimedPermissions }, source: { documentId: "42", eventId: randomUUID() },
    lines: quantities.map((quantity, i) => ({ sourceLineId: String(i + 1), originalMovementId, baseQuantity: String(quantity),
      binId: String(f.binId), ...(kind === "supplier" ? { stockStatus: "AVAILABLE" } : {}) })) });
  const service = new InventoryReturnPostingService(f);
  const submit = input => f.withRequest(input, (tx, req) => {
    req.apiRoute.path = `/api/v1/${kind}-returns/:id/post`;
    const facts = input.lines.map(({ sourceLineId }) => ({ sourceLineId, originalMovementId,
      warehouseId: String(f.warehouseId), skuId: String(f.skuId), lotId }));
    const proof = issueInventoryReturnContext(req, tx, input, facts, { ...f.options, kind });
    return kind === "customer" ? service.postCustomerReturnReceiptBatchInTransaction(tx, input, proof)
      : service.postSupplierReturnIssueBatchInTransaction(tx, input, proof);
  });
  return { ...f, command, submit, originalMovementId, lotId };
}

native("Supplier return batch uses the original receipt cost and a repeated event returns the same movement IDs", async t => {
  const f = await fixture(t, "supplier"), command = f.command([1, 2]), result = await f.submit(command);
  const state = await snapshot(f), original = state.inventory_cost_entries[0];
  assert.deepEqual(result.lines.map(row => row.sourceLineId), ["1", "2"]);
  assert.deepEqual(state.inventory_cost_entries.slice(1).map(row => [row.entry_kind, row.original_entry_id,
    row.value_delta_hkd, row.original_value_hkd, String(row.movement_id)]),
  [["SUPPLIER_RETURN", original.id, "-1.0001", "1.0001", result.lines[0].movementId],
    ["SUPPLIER_RETURN", original.id, "-2.0002", "2.0002", result.lines[1].movementId]]);
  assert.deepEqual(state.inventory_cost_pools.map(row => [row.costed_quantity, row.value_hkd]), [[1, "1.0001"]]);
  assert.deepEqual(await f.submit(command), result);
  assert.deepEqual(await snapshot(f), state);
  await assert.rejects(f.submit(f.command([2])), { code: "INSUFFICIENT_STOCK" });
  assert.deepEqual(await snapshot(f), state);
});

native("Customer return preserves the original expired lot in quarantine and restores its ISSUE cost", async t => {
  const f = await fixture(t, "customer", { expiredLot: true }), result = await f.submit(f.command([2]));
  const state = await snapshot(f), entry = state.inventory_cost_entries.at(-1), movement = state.inventory_movements.at(-1);
  assert.deepEqual([String(movement.id), movement.movement_type, movement.direction, movement.stock_status],
    [result.lines[0].movementId, "CUSTOMER_RETURN", "IN", "QUARANTINED"]);
  assert.deepEqual([entry.entry_kind, entry.original_entry_id, entry.original_value_hkd, entry.value_delta_hkd],
    ["CUSTOMER_RETURN", state.inventory_cost_entries[1].id, "2.0002", "2.0002"]);
  assert.equal(String(movement.lot_id), f.lotId);
  const [[lot]] = await f.db.query("SELECT COUNT(*) AS count, MIN(DATE_FORMAT(expiry_date,'%Y-%m-%d')) AS expiry FROM inventory_lots");
  assert.deepEqual([Number(lot.count), lot.expiry], [1, "2026-10-29"]);
  assert.deepEqual(state.inventory_cost_pools.map(row => [row.costed_quantity, row.value_hkd]), [[2, "2.0002"]]);
});

native("Parallel customer returns observe the shared original cap after a real Warehouse lock wait", async t => {
  const f = await fixture(t, "customer"), commands = [f.command([3]), f.command([3])];
  // Distinct returns can refer to the same original issue, but have separate caller operation scopes.
  commands[1].source.documentId = "43";
  await f.db.beginTransaction();
  await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const pending = Promise.allSettled(commands.map(command => f.submit(command)));
  let waited = false;
  try {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const [[row]] = await f.db.query({ sql: `SELECT COUNT(*) AS total FROM performance_schema.data_locks
        WHERE OBJECT_SCHEMA=? AND OBJECT_NAME='inventory_warehouses' AND LOCK_STATUS='WAITING'`, timeout: 500 }, [f.name]);
      if (Number(row.total) === 2) { waited = true; break; }
      await new Promise(resolve => { setTimeout(resolve, 10); });
    }
  } finally { await f.db.rollback(); }
  const results = await pending;
  assert.equal(waited, true);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const index = results.findIndex(result => result.status === "rejected");
  assert.equal(results[index].reason.code, "REVERSAL_NOT_ALLOWED");
  const before = await snapshot(f);
  await assert.rejects(f.submit(commands[index]), { code: "REVERSAL_NOT_ALLOWED" });
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(before.inventory_cost_pools.map(row => [row.costed_quantity, row.value_hkd]), [[3, "3.0003"]]);
});

native("Supplier return cannot consume current Reserved coverage", async t => {
  const f = await fixture(t, "supplier");
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=4 WHERE warehouse_id=? AND sku_id=?", [f.warehouseId, f.skuId]);
  const before = await snapshot(f);
  await assert.rejects(f.submit(f.command()), { code: "REVERSAL_NOT_ALLOWED" });
  assert.deepEqual(await snapshot(f), before);
});

for (const kind of ["customer", "supplier"]) {
  native(`${kind} return refuses a bin in another warehouse without physical or financial effects`, async t => {
    const f = await fixture(t, kind), order = f.command();
    const other = await f.insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES('OTHER','other','Synthetic',1,1)");
    order.lines[0].binId = String(await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'O','o',1,1)", [other]));
    const before = await snapshot(f);
    await assert.rejects(f.submit(order), { code: "INVENTORY_RETURN_WAREHOUSE_MISMATCH" });
    assert.deepEqual(await snapshot(f), before);
  });
}

native("Missing original ISSUE cost blocks customer return without stock or pool effects", async t => {
  const f = await fixture(t, "customer", { withCost: false }), before = await snapshot(f);
  await assert.rejects(f.submit(f.command()), { code: "INVENTORY_COST_SOURCE_MISSING" });
  assert.deepEqual(await snapshot(f), before);
});

native("Second cost entry failure rolls back both return lines, their operations, and audits", async t => {
  const f = await fixture(t, "supplier"), before = await snapshot(f);
  await f.db.query(`CREATE TRIGGER test_return_cost_fault BEFORE INSERT ON inventory_cost_entries FOR EACH ROW
    BEGIN IF NEW.entry_kind='SUPPLIER_RETURN' AND NEW.pool_quantity_after=2 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic second return cost failure'; END IF; END`);
  await assert.rejects(f.submit(f.command([1, 1])),
    error => error.cause?.code === "ER_SIGNAL_EXCEPTION" || error.cause?.cause?.code === "ER_SIGNAL_EXCEPTION");
  assert.deepEqual(await snapshot(f), before);
});
