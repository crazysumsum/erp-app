import assert from "node:assert/strict";
import test from "node:test";
import { purchaseNativeFixture, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReceiptContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";

const native = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_PURCHASE_TESTS === "1" ? test : test.skip;
const service = f => new InventoryPostingService(f);
const post = (f, command, after, provider = service(f)) => f.withRequest(command, async (tx, req) => {
  command.context = issuePurchaseReceiptContext(req, tx, command, purchaseConfirmedLines(command), f.options);
  const result = await provider.postPurchaseReceiptBatchInTransaction(tx, command);
  await after?.(tx, result);
  return result;
});

const errorCode = error => error.code ?? error.publicCode ?? error.cause?.code;
function twoLines(command) {
  command.lines.push({ ...structuredClone(command.lines[0]), sourceLineId: "82",
    commitment: { ...command.lines[0].commitment, purchaseOrderLineId: 7 } });
  return command;
}
async function lotCommand(f, { expiryDate = "2027-01-01", minimum = null } = {}) {
  await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry', min_receipt_life_days=? WHERE id=?", [minimum, f.skuId]);
  const command = f.command(), line = command.lines[0];
  Object.assign(line, { lotNumber: "Lot-A", expiryDate });
  line.commitment.trackingPolicySnapshot = "batch_expiry";
  return command;
}

native("Purchase native A04 completed replay returns original receipt without additional writes", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()), retry = structuredClone(command);
  const result = await post(f, command), before = await effects(f);
  retry.correlationId = "new-request"; retry.lines.reverse();
  const replay = await post(f, retry);
  assert.deepEqual(replay, { ...result, lines: [...result.lines].reverse() });
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A05 same event changed payload rejects without effects", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), retry = structuredClone(command);
  await post(f, command); const before = await effects(f); retry.lines[0].baseQuantity++;
  await assert.rejects(post(f, retry), error => errorCode(error) === "INVENTORY_SOURCE_CONFLICT");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A06 concurrent identical source commits only one result", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()), retry = structuredClone(command);
  const [first, second] = await Promise.all([post(f, command), post(f, retry)]);
  assert.deepEqual(first, second);
  const rows = await effects(f);
  assert.equal(rows.inventory_movements.length, 2); assert.equal(rows.inventory_audit_logs.length, 2);
  assert.equal(rows.inventory_operation_requests.length, 3); assert.equal(Number(rows.inventory_stock_balances[0].on_hand_quantity), 6);
});

native("Purchase native A07 concurrent conflicting source has one winner and no partial loser", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), retry = structuredClone(command);
  retry.lines[0].baseQuantity = 5;
  const settled = await Promise.allSettled([post(f, command), post(f, retry)]);
  assert.equal(settled.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(errorCode(settled.find(row => row.status === "rejected").reason), "INVENTORY_SOURCE_CONFLICT");
  const rows = await effects(f), winner = settled.find(row => row.status === "fulfilled").value;
  assert.equal(rows.inventory_movements.length, 1); assert.equal(rows.inventory_audit_logs.length, 1);
  assert.equal(rows.inventory_operation_requests.length, 2);
  assert.equal(Number(rows.inventory_stock_balances[0].on_hand_quantity), winner.lines[0].baseQuantity);
});

native("Purchase native A08 second Audit fault rolls back first detail and all new identities", async t => {
  const f = await purchaseNativeFixture(t), provider = service(f), before = await effects(f);
  const original = provider.audit.recordSucceeded.bind(provider.audit); let calls = 0;
  provider.audit.recordSucceeded = async (...args) => { if (++calls === 2) throw new Error("synthetic second Audit"); return original(...args); };
  await assert.rejects(post(f, twoLines(f.command()), null, provider), error => error.cause?.message === "synthetic second Audit");
  assert.equal(calls, 2); assert.deepEqual(await effects(f), before);
});

native("Purchase native A09 root completion fault rolls back completed members and movements", async t => {
  const f = await purchaseNativeFixture(t), provider = service(f), before = await effects(f);
  const original = provider.operations.complete.bind(provider.operations); let calls = 0;
  provider.operations.complete = async (tx, input) => {
    calls++; if (input.resultType === "PURCHASE_RECEIPT_BATCH") throw new Error("synthetic root complete");
    return original(tx, input);
  };
  await assert.rejects(post(f, twoLines(f.command()), null, provider), error => error.cause?.message === "synthetic root complete");
  assert.equal(calls, 3); assert.deepEqual(await effects(f), before);
});

native("Purchase native A10 cross Warehouse batch resolves all Lots before Balance locks", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(await lotCommand(f)), provider = service(f);
  const warehouseId = await f.insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES('SECOND','second','Second',1,1)");
  const binId = await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)", [warehouseId]);
  Object.assign(command.lines[1], { warehouseId, binId, lotNumber: "Lot-B" }); command.lines.reverse();
  const lock = provider.locks.lockBalancesAfterLot.bind(provider.locks);
  provider.locks.lockBalancesAfterLot = async (tx, input) => {
    const [[{ count }]] = await tx.query("SELECT COUNT(*) AS count FROM inventory_lots"); assert.equal(count, 2);
    const [[{ claims }]] = await tx.query("SELECT COUNT(*) AS claims FROM inventory_operation_requests"); assert.equal(claims, 3);
    return lock(tx, input);
  };
  await post(f, command, null, provider); const rows = await effects(f);
  assert.equal(rows.inventory_stock_balances.length, 2); assert.equal(rows.inventory_movements.length, 2);
  assert.equal(rows.inventory_lots.length, 2); assert.ok(rows.inventory_stock_balances.every(row => Number(row.on_hand_quantity) === 3));
});

native("Purchase native A11 DB-equivalent Lot numbers reject inconsistent dates atomically", async t => {
  const f = await purchaseNativeFixture(t), command = await lotCommand(f);
  await f.db.execute(`INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at)
    VALUES(?,'Lot-A','Lot-A ','2027-02-01','2026-10-01','PURCHASE',1)`, [f.skuId]);
  const [[match]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_lots WHERE normalized_lot_number='Lot-A'");
  assert.equal(match.count, 1); // The existing PAD SPACE collation, not JS equality.
  const before = await effects(f);
  await assert.rejects(post(f, command), error => errorCode(error) === "LOT_DATA_CONFLICT");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A12 DB binary collation keeps case-distinct Lots as distinct physical dimensions", async t => {
  const f = await purchaseNativeFixture(t), command = await lotCommand(f);
  command.lines.push({ ...structuredClone(command.lines[0]), sourceLineId: "82", lotNumber: "lot-a" });
  await post(f, command); const rows = await effects(f);
  assert.deepEqual(rows.inventory_lots.map(row => row.normalized_lot_number), ["Lot-A", "lot-a"]);
  assert.equal(rows.inventory_stock_balances.length, 2);
  assert.notEqual(rows.inventory_movements[0].lot_id, rows.inventory_movements[1].lot_id);
});

native("Purchase native A13 current lifecycle drift requires reason but persists original commitment", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), before = await effects(f);
  await f.db.execute("UPDATE item_skus SET purchasable=0, inventory_tracked=0 WHERE id=?", [f.skuId]);
  await assert.rejects(post(f, command), error => errorCode(error) === "INVENTORY_INPUT_INVALID");
  assert.deepEqual(await effects(f), before);
  command.lines[0].commitment.skuExceptionReason = "Confirmed order obligation";
  await post(f, command); const rows = await effects(f);
  assert.equal(rows.inventory_movements[0].reason_text, "Confirmed order obligation");
  assert.equal(rows.inventory_operation_requests.find(row => row.source_line_id === "81").result_summary.baseUomId, f.uomId);
});

native("Purchase native A14 stricter current minimum life requires exact evidence and fresh override", async t => {
  const f = await purchaseNativeFixture(t), command = await lotCommand(f, { expiryDate: "2026-10-25", minimum: 5 }), before = await effects(f);
  await assert.rejects(post(f, command), error => errorCode(error) === "LOT_MINIMUM_LIFE_FAILED");
  assert.deepEqual(await effects(f), before);
  command.lines[0].minimumLifeEvidence = { reason: "Approved short dated receipt", minimumLifeDaysApplied: 5, actualRemainingLifeDays: 2 };
  await post(f, command); const rows = await effects(f);
  assert.equal(rows.inventory_movements[0].reason_category, "MINIMUM_LIFE_OVERRIDE");
  assert.equal(rows.inventory_audit_logs[0].after_summary.actualRemainingLifeDays, 2);
});

native("Purchase native A15 expired Lot cannot be admitted by minimum-life override", async t => {
  const f = await purchaseNativeFixture(t), command = await lotCommand(f, { expiryDate: "2026-10-22" }), before = await effects(f);
  await assert.rejects(post(f, command), error => errorCode(error) === "LOT_EXPIRED");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A16 invalid later Bin rolls back root, all claims and Controls", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()), before = await effects(f);
  command.lines[1].binId = 9999;
  await assert.rejects(post(f, command), error => errorCode(error) === "BIN_WAREHOUSE_MISMATCH");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A17 authority revoked after claims is rechecked before stock writes", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), provider = service(f), before = await effects(f);
  const lock = provider.locks.lockForCommand.bind(provider.locks);
  provider.locks.lockForCommand = async (...args) => {
    await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='receiving.operation'", [f.roleId]);
    return lock(...args);
  };
  await assert.rejects(post(f, command, null, provider), error => errorCode(error) === "PERMISSION_STALE");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native A18 every source is claimed before Warehouse locking and no old single post is called", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()), provider = service(f);
  const lock = provider.locks.lockForCommand.bind(provider.locks); let checked = false;
  provider.locks.lockForCommand = async (tx, input) => {
    const [rows] = await tx.query("SELECT source_line_id, completed_at FROM inventory_operation_requests ORDER BY id");
    assert.deepEqual(rows.map(row => row.source_line_id), ["", "81", "82"]);
    assert.ok(rows.every(row => row.completed_at === null)); checked = true; return lock(tx, input);
  };
  provider.postReceiptInTransaction = () => { throw new Error("Forbidden per-line old posting"); };
  await post(f, command, null, provider); assert.equal(checked, true);
});

native("Purchase native A19 full 200-detail batch preserves every scalar result and consecutive balance", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), template = command.lines[0];
  command.lines = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(template), sourceLineId: String(i + 1),
    commitment: { ...template.commitment, purchaseOrderLineId: i + 1 } })).reverse();
  const result = await post(f, command), rows = await effects(f);
  assert.deepEqual(result.lines.map(row => row.sourceLineId), command.lines.map(line => line.sourceLineId));
  assert.equal(rows.inventory_operation_requests.length, 201); assert.equal(rows.inventory_movements.length, 200);
  assert.equal(rows.inventory_audit_logs.length, 200); assert.equal(Number(rows.inventory_stock_balances[0].on_hand_quantity), 600);
  for (const [i, row] of rows.inventory_movements.entries()) {
    assert.deepEqual([Number(row.balance_before), Number(row.balance_after), Number(row.balance_version_after)], [i * 3, (i + 1) * 3, i + 2]);
  }
});

native("Purchase native A20 aggregate safe-integer overflow fails before any stock effect", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()), before = await effects(f);
  command.lines[0].baseQuantity = Number.MAX_SAFE_INTEGER;
  await assert.rejects(post(f, command), error => errorCode(error) === "INVENTORY_QUANTITY_INVALID");
  assert.deepEqual(await effects(f), before);
});

for (const replay of [false, true]) native(`Purchase native final receipt read cannot return after JWT expiry (replay=${replay})`, async t => {
  const f = await purchaseNativeFixture(t), command = f.command();
  if (replay) await post(f, structuredClone(command));
  const before = await effects(f), start = f.time.nowMs();
  await assert.rejects(f.withRequest(command, async (tx, req) => {
    command.context = issuePurchaseReceiptContext(req, tx, command, purchaseConfirmedLines(command), f.options);
    const query = tx.query.bind(tx);
    tx.query = async (sql, ...args) => {
      const result = await query(sql, ...args);
      if (sql.includes("ORDER BY id LIMIT 202 FOR SHARE")) f.time.nowMs = () => start + 906000;
      return result;
    };
    return service(f).postPurchaseReceiptBatchInTransaction(tx, command);
  }), error => errorCode(error) === "JWT_INVALID");
  assert.deepEqual(await effects(f), before);
});

const lookup = (f, command) => f.withRequest(command, tx => new InventoryLookupService({ ...f, ...f.options })
  .findOperationsBySource(tx, { documentType: "GOODS_RECEIPT", ...command.source }), { readOnly: true });

native("Purchase native lookup returns only committed complete results and exact numeric member order", async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(f.command()); command.lines.reverse();
  await f.withRequest(command, async tx => {
    await assert.rejects(tx.execute("UPDATE users SET username=username WHERE id=?", [f.actor.userId]),
      error => error.cause?.code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION");
  }, { readOnly: true });
  assert.deepEqual(await lookup(f, command), { status: "NOT_FOUND" });
  const result = await post(f, command), before = await effects(f);
  assert.deepEqual(await lookup(f, command), { status: "COMPLETED", result: { ...result, lines: [...result.lines].reverse() } });
  assert.deepEqual(await effects(f), before);
});

native("Purchase native lookup rejects current token version revocation", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(); await post(f, command); const before = await effects(f);
  await f.db.execute("INSERT INTO fr_token_versions(subject,version,updated_at) VALUES(?,1,?)", [String(f.actor.userId), f.time.nowMs()]);
  await assert.rejects(lookup(f, command), error => errorCode(error) === "JWT_INVALID");
  assert.deepEqual(await effects(f), before);
});

native("Purchase native lookup rechecks JWT expiry after Operation SELECT", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(); await post(f, command); const before = await effects(f), start = f.time.nowMs();
  await assert.rejects(f.withRequest(command, async tx => {
    const query = tx.query.bind(tx);
    tx.query = async (sql, ...args) => {
      const result = await query(sql, ...args);
      if (sql.includes("ORDER BY id LIMIT 202")) f.time.nowMs = () => start + 906000;
      return result;
    };
    return new InventoryLookupService({ ...f, ...f.options }).findOperationsBySource(tx, { documentType: "GOODS_RECEIPT", ...command.source });
  }, { readOnly: true }), error => errorCode(error) === "JWT_INVALID");
  assert.deepEqual(await effects(f), before);
});

for (const commit of [true, false]) native(`Purchase native lookup uses independent snapshot while owner is uncommitted (commit=${commit})`, async t => {
  const f = await purchaseNativeFixture(t), command = f.command();
  const ready = Promise.withResolvers(), release = Promise.withResolvers();
  const owner = post(f, command, async () => { ready.resolve(); await release.promise; if (!commit) throw new Error("synthetic owner rollback"); });
  const settled = owner.then(value => ({ value }), error => ({ error }));
  // Propagate early failures instead of hanging at a barrier.
  await Promise.race([ready.promise, settled.then(outcome => { if (outcome.error) throw outcome.error; })]);
  try { assert.deepEqual(await lookup(f, command), { status: "NOT_FOUND" }); }
  finally { release.resolve(); }
  const outcome = await settled;
  if (commit) {
    assert.equal(outcome.error, undefined);
    assert.deepEqual(await lookup(f, command), { status: "COMPLETED", result: outcome.value });
  } else {
    assert.equal(outcome.error.cause?.message, "synthetic owner rollback");
    assert.deepEqual(await lookup(f, command), { status: "NOT_FOUND" });
    assert.ok(Object.values(await effects(f)).every(rows => rows.length === 0));
  }
});

native("Purchase native lookup rejects revoked purchasing.view without returning persisted result", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(); await post(f, command); const before = await effects(f);
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='purchasing.view'", [f.roleId]);
  await assert.rejects(lookup(f, command), error => errorCode(error) === "PERMISSION_STALE");
  assert.deepEqual(await effects(f), before);
});

for (const point of ["Lot", "Balance", "Movement"]) native(`Purchase native injected ${point} fault rolls back the complete batch`, async t => {
  const f = await purchaseNativeFixture(t), command = twoLines(point === "Lot" ? await lotCommand(f) : f.command()), before = await effects(f);
  let injected = false;
  await assert.rejects(f.withRequest(command, async (tx, req) => {
    command.context = issuePurchaseReceiptContext(req, tx, command, purchaseConfirmedLines(command), f.options);
    const execute = tx.execute.bind(tx); let movements = 0;
    tx.execute = async (sql, ...args) => {
      const hit = point === "Lot" ? sql.includes("INSERT INTO inventory_lots") : point === "Balance"
        ? sql.includes("UPDATE inventory_stock_balances") : sql.includes("INSERT INTO inventory_movements") && ++movements === 2;
      if (hit) { injected = true; throw new Error(`synthetic ${point} fault`); }
      return execute(sql, ...args);
    };
    return service(f).postPurchaseReceiptBatchInTransaction(tx, command);
  }), error => error.cause?.message === `synthetic ${point} fault`);
  assert.equal(injected, true); assert.deepEqual(await effects(f), before);
});

native("Purchase native actual Warehouse lock wait rechecks committed permission revocation", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), before = await effects(f);
  await f.db.beginTransaction();
  await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE", [f.warehouseId]);
  const outcome = post(f, command).then(value => ({ value }), error => ({ error }));
  let observed = false;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [waiting] = await f.db.query({ sql: `SELECT ENGINE_TRANSACTION_ID FROM performance_schema.data_locks
        WHERE OBJECT_SCHEMA=? AND OBJECT_NAME='inventory_warehouses' AND LOCK_STATUS='WAITING'`, timeout: 500 }, [f.name]);
      if (waiting.length) { observed = true; break; }
      await new Promise(resolve => { setTimeout(resolve, 10); });
    }
    assert.equal(observed, true, "must observe an actual engine Warehouse lock wait");
    await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='receiving.operation'", [f.roleId]);
    await f.db.commit();
  } finally { await f.db.rollback(); }
  const settled = await outcome;
  assert.equal(errorCode(settled.error), "PERMISSION_STALE");
  assert.deepEqual(await effects(f), before);
});
async function effects(f) {
  const tables = ["inventory_operation_requests", "inventory_lots", "inventory_stock_controls", "inventory_stock_balances", "inventory_movements", "inventory_audit_logs"];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0]])));
}

native("Purchase native A01 single receipt persists linked Operation/Balance/Movement/Audit atomically", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), result = await post(f, command), rows = await effects(f);
  assert.equal(result.status, "POSTED"); assert.equal(result.lines.length, 1);
  assert.equal(rows.inventory_operation_requests.length, 2);
  assert.ok(rows.inventory_operation_requests.every(row => row.completed_at !== null));
  const balance = rows.inventory_stock_balances[0], movement = rows.inventory_movements[0], audit = rows.inventory_audit_logs[0];
  assert.equal(Number(balance.on_hand_quantity), 3); assert.equal(Number(balance.allocated_quantity), 0); assert.equal(Number(balance.version), 2);
  assert.equal(movement.id, result.lines[0].movementId); assert.equal(Number(movement.operation_request_id), result.lines[0].operationId);
  assert.equal(movement.direction, "IN"); assert.equal(movement.movement_type, "RECEIPT");
  assert.equal(Number(movement.balance_before), 0); assert.equal(Number(movement.balance_after), 3);
  assert.equal(Number(audit.operation_request_id), result.lines[0].operationId); assert.equal(audit.outcome, "SUCCEEDED");
  assert.equal(audit.action, "receipt.post"); assert.equal(Number(audit.actor_user_id), f.actor.userId);
});

native("Purchase native A02 same bucket different PO lines has consecutive balances and input-order results", async t => {
  const f = await purchaseNativeFixture(t), command = f.command(), first = command.lines[0];
  command.lines.push({ ...first, sourceLineId: "9", baseQuantity: 2, commitment: { ...first.commitment, purchaseOrderLineId: 7 } });
  const result = await post(f, command), rows = await effects(f);
  assert.deepEqual(result.lines.map(row => row.sourceLineId), ["81", "9"]);
  assert.deepEqual(rows.inventory_movements.map(row => [Number(row.quantity), Number(row.balance_before), Number(row.balance_after), Number(row.balance_version_after)]), [[2, 0, 2, 2], [3, 2, 5, 3]]);
  assert.equal(rows.inventory_stock_balances.length, 1); assert.equal(Number(rows.inventory_stock_balances[0].on_hand_quantity), 5);
  assert.equal(rows.inventory_audit_logs.length, 2); assert.equal(rows.inventory_operation_requests.length, 3);
});

native("Purchase native A03 caller failure rolls back every Inventory effect including initial controls", async t => {
  const f = await purchaseNativeFixture(t), before = await effects(f);
  await assert.rejects(post(f, f.command(), async () => { throw new Error("synthetic caller failure"); }),
    error => error.cause?.message === "synthetic caller failure");
  assert.deepEqual(await effects(f), before);
});
