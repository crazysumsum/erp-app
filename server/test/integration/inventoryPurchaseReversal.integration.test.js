import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { up as migrateLinks } from "../../database/migrations/0101_create_inventory_purchase_reversal_links.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReceiptContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { purchaseNativeFixture, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";

const native = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_PURCHASE_TESTS === "1" ? test : test.skip;

async function receipt(f) {
  const command = f.command();
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
