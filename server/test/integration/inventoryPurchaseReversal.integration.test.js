import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { up as migrateLinks } from "../../database/migrations/0101_create_inventory_purchase_reversal_links.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
import { issuePurchaseReceiptContext, issuePurchaseReversalContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { purchaseNativeFixture, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";

const native = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_PURCHASE_TESTS === "1" ? test : test.skip;

async function receipt(f, command = f.command()) {
  return f.withRequest(command, async (tx, req) => {
    command.context = issuePurchaseReceiptContext(req, tx, command, purchaseConfirmedLines(command), f.options);
    return new InventoryPostingService(f).postPurchaseReceiptBatchInTransaction(tx, command);
  });
}

// Schema-only FK fixtures: real receipt plus explicitly inserted reversal fact, not a provider B success claim.
async function linkFixture(f) {
  const originalId = (await receipt(f)).lines[0].movementId;
  const member = await new InventoryOperationService().claim(f.db, { commandType: "PURCHASE_REVERSE_LINE",
    source: { module: "PURCHASING_RECEIVING", documentType: "GOODS_RECEIPT_REVERSAL", documentId: "51", lineId: "91", eventId: randomUUID() },
    payload: { schemaFixture: true }, actorUserId: f.actor.userId, actorLabel: "Synthetic schema fixture", createdAt: 1,
    requestId: "schema-fixture", correlationId: "schema-fixture" });
  const [[original]] = await f.db.query("SELECT * FROM inventory_movements WHERE id=?", [originalId]);
  const { id: _id, ...row } = original;
  Object.assign(row, { movement_group_id: randomUUID(), operation_request_id: member.operationId, movement_type: "REVERSAL",
    direction: "OUT", quantity: 1, balance_before: 3, balance_after: 2, balance_version_after: 2, reversal_of_movement_id: null });
  const fields = Object.keys(row), movementId = await f.insert(`INSERT INTO inventory_movements
    (${fields.map(field => `\`${field}\``).join(",")}) VALUES (${fields.map(() => "?").join(",")})`, Object.values(row));
  return { originalId, movementId, operationId: member.operationId };
}

native("Purchase reversal native R01 fresh schema and rerun preserve generic full reversal uniqueness", async t => {
  const f = await purchaseNativeFixture(t);
  await migrateLinks(f.db); await migrateLinks(f.db);
  const [columns] = await f.db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='inventory_purchase_reversal_links' ORDER BY ordinal_position");
  assert.deepEqual(columns.map(row => row.COLUMN_NAME ?? row.column_name),
    ["id", "original_movement_id", "reversal_movement_id", "operation_request_id", "quantity", "created_at"]);
  const [triggers] = await f.db.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='inventory_purchase_reversal_links'");
  assert.equal(triggers.length, 2);
  const [legacy] = await f.db.query("SHOW INDEX FROM inventory_movements WHERE Key_name='uq_inventory_movement_reversal'");
  assert.equal(legacy.length, 1); assert.equal(Number(legacy[0].Non_unique), 0);
  assert.equal(legacy[0].Column_name, "reversal_of_movement_id");
});

async function reversalFixture(t, { twoLines = false, lotTracked = false, lineCount = twoLines ? 2 : 1 } = {}) {
  const f = await purchaseNativeFixture(t); await migrateLinks(f.db);
  const input = f.command();
  if (lotTracked) {
    await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry' WHERE id=?", [f.skuId]);
    Object.assign(input.lines[0], { lotNumber: "LOT-A", expiryDate: "2027-12-31" });
    input.lines[0].commitment.trackingPolicySnapshot = "batch_expiry";
  }
  for (let i = 1; i < lineCount; i++) input.lines.push({ ...structuredClone(input.lines[0]), sourceLineId: String(81 + i),
    commitment: { ...input.lines[0].commitment, purchaseOrderLineId: 6 + i } });
  const original = await receipt(f, input);
  await (await import("../../database/migrations/0004_add_device_binding_tables.js")).up(f.db);
  f.actor.claimedPermissions.push("inventory.adjust");
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'", [f.roleId]);
  const key = Buffer.from("explicit trusted native fixture, not real signature proof"), did = "a".repeat(64);
  const deviceId = await f.insert("INSERT INTO user_devices(user_id,device_id,public_key,status,requested_at) VALUES(?,?,?,'approved',1)",
    [f.actor.userId, did, key]);
  const command = (quantity = 1) => ({ actor: structuredClone(f.actor), correlationId: randomUUID(),
    source: { documentId: input.source.documentId, eventId: randomUUID() }, goodsReceiptId: input.source.documentId,
    reasonText: "Correct received quantity", lines: original.lines.map(line => ({ sourceLineId: line.sourceLineId,
      originalSourceLineId: line.sourceLineId, originalMovementId: line.movementId, baseQuantity: quantity })) });
  const submit = (value, { ownerStatus = "CONFIRMED", provider = new InventoryPostingService(f), after } = {}) =>
    f.withRequest(value, async (tx, req) => {
      req.auth.type = req.apiRoute.authType = "jwt-device-password";
      req.apiRoute.path = "/api/v1/goods-receipts/:id/reversals/create";
      req.auth.claims.did = did;
      req.auth.deviceBinding = { id: deviceId, user_id: f.actor.userId, device_id: did, public_key: key, status: "approved" };
      req.get = () => String(f.time.nowMs());
      value.context = issuePurchaseReversalContext(req, tx, value, { ...f.options, signatureMaxSkewSeconds: 300,
        ownerProof: { goodsReceiptId: value.goodsReceiptId, status: ownerStatus, details: value.lines.map(line => ({
          sourceLineId: line.sourceLineId, goodsReceiptId: value.goodsReceiptId, originalMovementId: line.originalMovementId })) } });
      const result = await provider.reversePurchaseReceiptBatchInTransaction(tx, value);
      if (after) await after(tx, result);
      return result;
    });
  const snapshot = async () => {
    const result = {};
    for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements", "inventory_operation_requests",
      "inventory_audit_logs", "inventory_purchase_reversal_links"]) {
      [result[table]] = await f.db.query(`SELECT * FROM ${table} ORDER BY id`);
    }
    return result;
  };
  return { ...f, original, input, reversal: command, submit, snapshot, deviceId };
}

native("Purchase reversal native R04 repeated partial events, full depletion and exact terminal replay", async t => {
  const f = await reversalFixture(t), first = f.reversal(1), a = await f.submit(first);
  const b = await f.submit(f.reversal(2), { ownerStatus: "PARTIALLY_REVERSED" });
  assert.equal(a.lines[0].originalMovementId, f.original.lines[0].movementId);
  assert.notEqual(a.lines[0].movementId, b.lines[0].movementId);
  const beforeReplay = await f.snapshot();
  assert.deepEqual(await f.submit(first, { ownerStatus: "REVERSED" }), a);
  assert.deepEqual(await f.snapshot(), beforeReplay);
  const [[balance]] = await f.db.query("SELECT on_hand_quantity,fifo_anchor_date FROM inventory_stock_balances");
  assert.equal(Number(balance.on_hand_quantity), 0); assert.equal(balance.fifo_anchor_date, null);
  const [links] = await f.db.query("SELECT original_movement_id,quantity FROM inventory_purchase_reversal_links ORDER BY id");
  assert.deepEqual(links.map(r => [Number(r.original_movement_id), Number(r.quantity)]), [[f.original.lines[0].movementId, 1], [f.original.lines[0].movementId, 2]]);
  await assert.rejects(f.submit(f.reversal(1), { ownerStatus: "REVERSED" }));
  assert.deepEqual(await f.snapshot(), beforeReplay);
});

native("Purchase reversal native R05 overdraw in second detail rolls back all claims and effects", async t => {
  const f = await reversalFixture(t, { twoLines: true }), before = await f.snapshot(), command = f.reversal(1);
  command.lines[1].baseQuantity = 4;
  await assert.rejects(f.submit(command), e => e.code === "REVERSAL_NOT_ALLOWED"); assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R06 second Audit fault rolls back movements, links and balances", async t => {
  const f = await reversalFixture(t, { twoLines: true }), before = await f.snapshot();
  const real = new InventoryPostingService(f), audit = real.audit; let count = 0;
  const provider = new InventoryPostingService({ ...f, audit: { async recordSucceeded(...args) {
    if (++count === 2) throw new Error("injected second purchase reversal Audit");
    return audit.recordSucceeded(...args);
  } } });
  await assert.rejects(f.submit(f.reversal(), { provider }));
  assert.equal(count, 2); assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R07 caller failure after provider completion rolls back the entire batch", async t => {
  const f = await reversalFixture(t), before = await f.snapshot(), command = f.reversal(); let completed = false;
  const injected = new Error("injected consumer NOT NULL/FK/projection failure after real Inventory result");
  await assert.rejects(f.submit(command, { after: async (tx, result) => {
    assert.equal(result.status, "POSTED");
    const [[link]] = await tx.query("SELECT COUNT(*) AS count FROM inventory_purchase_reversal_links");
    assert.equal(Number(link.count), 1); completed = true;
    assert.deepEqual(await reversalLookup(f, command), { status: "NOT_FOUND" });
    throw injected;
  } }), error => error === injected || error.cause === injected);
  assert.equal(completed, true); assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await reversalLookup(f, command), { status: "NOT_FOUND" });
});

async function ownRecordLocks(tx, table) {
  const [rows] = await tx.query(`SELECT l.INDEX_NAME AS index_name,l.LOCK_MODE AS mode,l.LOCK_DATA AS data
    FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID
    WHERE t.PROCESSLIST_ID=CONNECTION_ID() AND l.OBJECT_SCHEMA=DATABASE() AND l.OBJECT_NAME=? AND l.LOCK_TYPE='RECORD'`, [table]);
  assert.ok(rows.length > 0, `Missing actual record-lock instrumentation for ${table}`);
  return rows;
}

native("Purchase reversal native R08 original receipt Operation proof uses shared locks, never member-first exclusive", async t => {
  const f = await reversalFixture(t);
  await f.submit(f.reversal(), { after: async tx => {
    const locks = await ownRecordLocks(tx, "inventory_operation_requests");
    for (const id of [f.original.operationId, ...f.original.lines.map(line => line.operationId)]) {
      const records = locks.filter(lock => lock.index_name === "PRIMARY" && lock.data === String(id));
      assert.ok(records.length > 0, `Original operation ${id} lock was not observed`);
      assert.ok(records.every(lock => /^S(?:,|$)/u.test(lock.mode)), JSON.stringify(records));
    }
  } });
});

native("Purchase reversal native R09 Reserved coverage does not take late locks on unrelated Lots", async t => {
  const f = await reversalFixture(t, { lotTracked: true }), other = structuredClone(f.input);
  other.actor = structuredClone(f.actor);
  other.source = { documentId: "43", eventId: randomUUID() }; other.lines[0].lotNumber = "LOT-B";
  await receipt(f, other);
  const [[lot]] = await f.db.query("SELECT id FROM inventory_lots WHERE lot_number='LOT-B'");
  await f.submit(f.reversal(), { after: async tx => {
    const locks = await ownRecordLocks(tx, "inventory_lots");
    assert.ok(!locks.some(lock => lock.index_name === "PRIMARY" && lock.data === String(lot.id) && !lock.mode.split(",").includes("GAP")), JSON.stringify(locks));
  } });
});

async function waitForWarehouseWait(f, minimum = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [[row]] = await f.db.query({ sql: `SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w
      JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND l.ENGINE=w.ENGINE
      WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='inventory_warehouses'`, timeout: Math.min(1000, Math.max(1, deadline - Date.now())) }, [f.name]);
    if (Number(row.count) >= minimum) return;
    await new Promise(resolve => { setTimeout(resolve, 10); });
  }
  assert.fail(`Did not observe ${minimum} actual Warehouse lock waits`);
}

native("Purchase reversal native R10 coverage sees new ineligible Lot committed while waiting, not a NULL expiry", async t => {
  const f = await reversalFixture(t, { lotTracked: true });
  await f.db.execute("UPDATE item_skus SET min_sale_life_days=10 WHERE id=?", [f.skuId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=3");
  // Controlled late stock fixture, not a claimed Receipt workflow success. No Operation-range locks hide the Warehouse wait.
  await f.db.beginTransaction();
  await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const [lot] = await f.db.execute(`INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,
    first_receipt_date,sku_code_snapshot,created_at,created_by) VALUES(?,'LOT-NEW','LOT-NEW','2026-10-24','2026-10-23','PURCHASE',1,?)`, [f.skuId, f.actor.userId]);
  await f.db.execute(`INSERT INTO inventory_stock_balances(warehouse_id,sku_id,bin_id,lot_id,stock_status,on_hand_quantity,
    allocated_quantity,fifo_anchor_date,version,created_at,updated_at) VALUES(?,?,?,?,'AVAILABLE',100,0,'2026-10-23',1,1,1)`,
  [f.warehouseId, f.skuId, f.binId, lot.insertId]);
  let pending; const command = f.reversal();
  try {
    pending = f.submit(command).then(value => ({ value }), error => ({ error }));
    await waitForWarehouseWait(f);
    await f.db.commit();
  } finally { await f.db.rollback(); }
  const outcome = await pending;
  assert.equal(outcome.error?.code, "CONCURRENT_OPERATION", JSON.stringify(outcome));
  const beforeRetry = await f.snapshot();
  await assert.rejects(f.submit(command), error => error.code === "REVERSAL_NOT_ALLOWED");
  assert.deepEqual(await f.snapshot(), beforeRetry);
  const [[count]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_purchase_reversal_links");
  assert.equal(Number(count.count), 0);
  const [balances] = await f.db.query(`SELECT b.on_hand_quantity,l.lot_number FROM inventory_stock_balances b
    JOIN inventory_lots l ON l.id=b.lot_id ORDER BY l.lot_number`);
  assert.deepEqual(balances.map(row => [row.lot_number, Number(row.on_hand_quantity)]), [["LOT-A", 3], ["LOT-NEW", 100]]);
});

native("Purchase reversal native R11 actual competing events cannot cumulatively exceed original quantity", async t => {
  const f = await reversalFixture(t), a = f.reversal(2), b = f.reversal(2);
  await f.db.beginTransaction(); await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const pending = Promise.allSettled([f.submit(a), f.submit(b)]);
  try { await waitForWarehouseWait(f, 2); } finally { await f.db.rollback(); }
  const results = await pending;
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  const failed = results.find(row => row.status === "rejected");
  assert.ok(["REVERSAL_NOT_ALLOWED", "CONCURRENT_OPERATION"].includes(failed.reason.code));
  if (failed.reason.code === "CONCURRENT_OPERATION") {
    const retry = results[0].status === "rejected" ? a : b;
    await assert.rejects(f.submit(retry), error => error.code === "REVERSAL_NOT_ALLOWED");
  }
  const [[link]] = await f.db.query("SELECT SUM(quantity) AS quantity,COUNT(*) AS count FROM inventory_purchase_reversal_links");
  assert.equal(Number(link.quantity), 2); assert.equal(Number(link.count), 1);
  const [[balance]] = await f.db.query("SELECT on_hand_quantity FROM inventory_stock_balances"); assert.equal(Number(balance.on_hand_quantity), 1);
});

native("Purchase reversal native R12 same-event concurrent submissions return identical results once", async t => {
  const f = await reversalFixture(t), a = f.reversal(), b = structuredClone(a);
  const [first, second] = await Promise.all([f.submit(a), f.submit(b)]);
  assert.deepEqual(first, second);
  const [[row]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_purchase_reversal_links"); assert.equal(Number(row.count), 1);
});

for (const [id, name, revoke, expected] of [
  ["R13", "role permission", f => f.db.execute(`DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
    WHERE rp.role_id=? AND p.name='inventory.adjust'`, [f.roleId]), "PERMISSION_STALE"],
  ["R14", "device", f => f.db.execute("UPDATE user_devices SET status='revoked' WHERE id=?", [f.deviceId]), "DEVICE_REVOKED"]
]) native(`Purchase reversal native ${id} ${name} revocation during actual Warehouse wait rolls back`, async t => {
  const f = await reversalFixture(t), before = await f.snapshot();
  await f.db.beginTransaction(); await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const pending = f.submit(f.reversal()).then(value => ({ value }), error => ({ error }));
  try { await waitForWarehouseWait(f); await revoke(f); await f.db.commit(); } finally { await f.db.rollback(); }
  const outcome = await pending; assert.equal(outcome.error?.code, expected, JSON.stringify(outcome));
  assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R15 per-Bucket allocated floor blocks an otherwise reversible quantity", async t => {
  const f = await reversalFixture(t); await f.db.execute("UPDATE inventory_stock_balances SET allocated_quantity=2");
  const before = await f.snapshot(); await assert.rejects(f.submit(f.reversal(2)), e => e.code === "REVERSAL_NOT_ALLOWED");
  assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R16 final Warehouse-SKU Reserved coverage cannot decrease", async t => {
  const f = await reversalFixture(t); await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=3");
  const before = await f.snapshot(); await assert.rejects(f.submit(f.reversal()), e => e.code === "REVERSAL_NOT_ALLOWED");
  assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R17 expired original Lot may unwind without worsening existing uncovered Reserved", async t => {
  const f = await reversalFixture(t, { lotTracked: true });
  f.time.nowMs = () => Date.parse("2028-01-01T01:00:00Z"); f.time.fileDate = () => "2028-01-01";
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=3");
  const [before] = await f.db.query("SELECT * FROM inventory_lots");
  const result = await f.submit(f.reversal()); assert.equal(result.status, "POSTED");
  const [after] = await f.db.query("SELECT * FROM inventory_lots"); assert.deepEqual(after, before);
  const [[row]] = await f.db.query("SELECT on_hand_quantity,allocated_quantity FROM inventory_stock_balances");
  assert.deepEqual([Number(row.on_hand_quantity), Number(row.allocated_quantity)], [2, 0]);
});

native("Purchase reversal native R18 low sale-life original Lot is excluded from Reserved eligibility", async t => {
  const f = await reversalFixture(t, { lotTracked: true });
  await f.db.execute("UPDATE item_skus SET min_sale_life_days=10000 WHERE id=?", [f.skuId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=3");
  assert.equal((await f.submit(f.reversal())).status, "POSTED");
  const [[row]] = await f.db.query("SELECT on_hand_quantity FROM inventory_stock_balances"); assert.equal(Number(row.on_hand_quantity), 2);
});

native("Purchase reversal native R19 current inactive SKU alone does not forbid unwinding original commitment", async t => {
  const f = await reversalFixture(t); await f.db.execute("UPDATE item_skus SET status='inactive' WHERE id=?", [f.skuId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=3");
  assert.equal((await f.submit(f.reversal())).status, "POSTED");
});

native("Purchase reversal native R20 original Movement cannot be claimed by another GR owner proof", async t => {
  const f = await reversalFixture(t), command = f.reversal(), before = await f.snapshot();
  command.goodsReceiptId = command.source.documentId = "43";
  await assert.rejects(f.submit(command), e => e.code === "REVERSAL_NOT_ALLOWED"); assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R21 original Movement must match the exact original GR Detail", async t => {
  const f = await reversalFixture(t), command = f.reversal(), before = await f.snapshot();
  command.lines[0].sourceLineId = command.lines[0].originalSourceLineId = "82";
  await assert.rejects(f.submit(command), e => e.code === "REVERSAL_NOT_ALLOWED"); assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R22 second Operation completion failure rolls back every line and root", async t => {
  const f = await reversalFixture(t, { twoLines: true }), before = await f.snapshot(), real = new InventoryOperationService(); let calls = 0;
  const provider = new InventoryPostingService({ ...f, operations: { claim: real.claim.bind(real), async complete(...args) {
    if (++calls === 2) throw new Error("injected second operation completion"); return real.complete(...args);
  } } });
  await assert.rejects(f.submit(f.reversal(), { provider })); assert.equal(calls, 2); assert.deepEqual(await f.snapshot(), before);
});

native("Purchase reversal native R23 full200-detail batch preserves input mapping and sequential shared-Bucket effects", async t => {
  const f = await reversalFixture(t, { lineCount: 200 }), command = f.reversal(); command.lines.reverse();
  const result = await f.submit(command);
  assert.deepEqual(result.lines.map(line => line.sourceLineId), command.lines.map(line => line.sourceLineId));
  assert.equal(new Set(result.lines.map(line => line.operationId)).size, 200);
  const [[balance]] = await f.db.query("SELECT on_hand_quantity,version FROM inventory_stock_balances");
  assert.equal(Number(balance.on_hand_quantity), 400); assert.equal(Number(balance.version), 401);
  const [rows] = await f.db.query("SELECT balance_before,balance_after,quantity,reversal_of_movement_id FROM inventory_movements WHERE movement_type='REVERSAL' ORDER BY id");
  assert.equal(rows.length, 200); rows.forEach((row, i) => {
    assert.deepEqual([Number(row.balance_before), Number(row.balance_after), Number(row.quantity), row.reversal_of_movement_id], [600 - i, 599 - i, 1, null]);
  });
  const [[links]] = await f.db.query("SELECT COUNT(*) AS count,SUM(quantity) AS quantity FROM inventory_purchase_reversal_links");
  assert.deepEqual([Number(links.count), Number(links.quantity)], [200, 200]);
  const [facts] = await f.db.query(`SELECT m.id,m.operation_request_id,m.movement_group_id,m.quantity,
    l.original_movement_id,l.operation_request_id AS link_operation_id,o.source_line_id,o.source_document_id,o.source_event_id
    FROM inventory_movements m JOIN inventory_purchase_reversal_links l ON l.reversal_movement_id=m.id
    JOIN inventory_operation_requests o ON o.id=m.operation_request_id ORDER BY m.id`);
  assert.equal(facts.length, 200);
  for (const line of result.lines) {
    const fact = facts.find(row => Number(row.id) === line.movementId);
    assert.ok(fact);
    assert.deepEqual([Number(fact.operation_request_id), Number(fact.link_operation_id), fact.movement_group_id,
      Number(fact.original_movement_id), Number(fact.quantity), fact.source_line_id, fact.source_document_id, fact.source_event_id],
    [line.operationId, line.operationId, line.movementGroupId, line.originalMovementId, line.baseQuantity,
      line.sourceLineId, command.goodsReceiptId, command.source.eventId]);
    assert.equal(f.original.lines.find(value => value.sourceLineId === line.sourceLineId).movementId, line.originalMovementId);
  }
});

const reversalLookup = (f, command, override = {}) => f.withRequest(command,
  tx => new InventoryLookupService({ ...f, ...f.options }).findOperationsBySource(tx,
    { documentType: "GOODS_RECEIPT_REVERSAL", ...command.source, ...override }), { readOnly: true });

native("Purchase reversal native R24 fresh read-only ABI query returns original committed results by GR and event", async t => {
  const f = await reversalFixture(t), command = f.reversal(); let queriedWhileUncommitted = false;
  const result = await f.submit(command, { after: async () => {
    assert.deepEqual(await reversalLookup(f, command), { status: "NOT_FOUND" }); queriedWhileUncommitted = true;
  } });
  assert.equal(queriedWhileUncommitted, true);
  assert.deepEqual(await reversalLookup(f, command), { status: "COMPLETED", result });
  assert.deepEqual(await reversalLookup(f, command, { eventId: randomUUID() }), { status: "NOT_FOUND" });
  assert.deepEqual(await reversalLookup(f, command, { documentId: "43" }), { status: "NOT_FOUND" });
  assert.deepEqual(await reversalLookup(f, command, { documentType: "GOODS_RECEIPT" }), { status: "NOT_FOUND" });
});

native("Purchase reversal native R02 link constraints enforce positive, unique and real FK identity", async t => {
  const f = await purchaseNativeFixture(t); await migrateLinks(f.db);
  const row = await linkFixture(f);
  const insert = (original, movement, operation, quantity) => f.db.execute(`INSERT INTO inventory_purchase_reversal_links
    (original_movement_id,reversal_movement_id,operation_request_id,quantity,created_at) VALUES(?,?,?,?,1)`, [original, movement, operation, quantity]);
  await assert.rejects(insert(row.originalId, row.movementId, row.operationId, 0), e => e.code === "ER_CHECK_CONSTRAINT_VIOLATED");
  await assert.rejects(insert(9007199254740991, row.movementId, row.operationId, 1), e => e.code === "ER_NO_REFERENCED_ROW_2");
  await insert(row.originalId, row.movementId, row.operationId, 1);
  await assert.rejects(insert(row.originalId, row.movementId, row.operationId, 1), e => e.code === "ER_DUP_ENTRY");
  const [rows] = await f.db.query("SELECT original_movement_id,reversal_movement_id,operation_request_id,quantity FROM inventory_purchase_reversal_links");
  assert.deepEqual(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]))),
    [{ original_movement_id: row.originalId, reversal_movement_id: row.movementId, operation_request_id: row.operationId, quantity: 1 }]);
});

native("Purchase reversal native R03 link UPDATE and DELETE remain immutable after rerun", async t => {
  const f = await purchaseNativeFixture(t); await migrateLinks(f.db);
  const row = await linkFixture(f);
  await f.db.execute(`INSERT INTO inventory_purchase_reversal_links
    (original_movement_id,reversal_movement_id,operation_request_id,quantity,created_at) VALUES(?,?,?,1,1)`,
  [row.originalId, row.movementId, row.operationId]);
  await migrateLinks(f.db);
  const [before] = await f.db.query("SELECT * FROM inventory_purchase_reversal_links");
  await assert.rejects(f.db.query("UPDATE inventory_purchase_reversal_links SET quantity=2"), e => e.sqlState === "45000");
  await assert.rejects(f.db.query("DELETE FROM inventory_purchase_reversal_links"), e => e.sqlState === "45000");
  const [after] = await f.db.query("SELECT * FROM inventory_purchase_reversal_links"); assert.deepEqual(after, before);
});
