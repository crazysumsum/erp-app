import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as mappingUp, inspectSalesReservationMappingSchema } from "../../database/migrations/0078_create_sales_order_line_reservations.js";
import { up as backorderUp, inspectSalesBackorderSchema } from "../../database/migrations/0079_create_sales_backorder_entries.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const f = await migrationFixture(t, ["sales_order_line_reservations", "sales_backorder_entries"]);
  const scoped = f.scoped;
  // Keep nonce-prefixed probe FK identifiers within MySQL's 64-character limit.
  f.scoped = { query: (sql, args) => scoped.query(sql.replaceAll("fk_sales_order_line_reservations_", "fk_sales_mapping_"), args) };
  const orderId = await f.insert("sales_orders", { sales_order_number: `SO-${randomUUID().slice(0, 16)}`, status: "CONFIRMING", source_type: "MANUAL",
    customer_id: f.customerId, customer_code_snapshot: "Synthetic", customer_name_snapshot: "Synthetic", currency_code: f.currency,
    fulfillment_warehouse_id: f.warehouseId, warehouse_code_snapshot: "Synthetic", warehouse_name_snapshot: "Synthetic", order_date: "2026-10-07",
    line_count: 1, total_amount: "0.0000", created_at: f.now, updated_at: f.now, last_business_updated_at: f.now });
  const lineId = await f.insert("sales_order_lines", { sales_order_id: orderId, line_no: 1, sku_id: f.skuId, item_name_snapshot: "Synthetic",
    sku_code_snapshot: "Synthetic", sku_name_snapshot: "Synthetic", sku_uom_id: f.skuUomId, uom_code_snapshot: "EA", uom_name_snapshot: "Each",
    to_base_factor_snapshot: 1, tracking_policy_snapshot: "none", ordered_quantity: "10.000000", ordered_base_quantity: 10,
    unit_selling_price: "0.0000", price_source: "MANUAL", line_amount: "0.0000", created_at: f.now, updated_at: f.now });
  const event = randomUUID();
  const operation = line => f.insert("inventory_operation_requests", { command_type: line ? "SALES_LINE_RESERVE" : "SALES_BATCH_RESERVE",
    source_module: "SALES", source_document_type: "SALES_ORDER", source_document_id: String(orderId), source_line_id: line,
    source_event_id: event, request_hash: "a".repeat(64), actor_label: "Synthetic", created_at: f.now });
  const rootId = await operation(""), childId = await operation(String(lineId));
  const reservationId = await f.insert("inventory_reservations", { create_operation_id: childId, warehouse_id: f.warehouseId,
    sku_id: f.skuId, original_quantity: 4, outstanding_quantity: 4, purpose: "SALE", status: "ACTIVE", created_at: f.now, updated_at: f.now });
  await mappingUp(f.scoped); await backorderUp(f.scoped);
  const mapping = { sales_order_line_id: lineId, inventory_reservation_id: reservationId, inventory_operation_id: rootId, source_event_id: event,
    original_base_quantity: 4, outstanding_base_quantity: 4, status: "ACTIVE", inventory_version: 1, created_at: f.now, updated_at: f.now };
  const queue = { sales_order_id: orderId, sales_order_line_id: lineId, line_no: 1, warehouse_id: f.warehouseId, sku_id: f.skuId,
    outstanding_base_quantity: 6, status: "OPEN", priority_at: f.now, next_attempt_at: f.now, created_at: f.now, updated_at: f.now };
  return { ...f, orderId, lineId, reservationId, rootId, childId, mapping, queue };
}

integrationTest("TC-021 commitment migrations create empty, preserve rows on upgrade/rerun and expose exact constraints", async t => {
  const f = await setup(t);
  await f.db.query(`INSERT INTO ${f.names.sales_order_line_reservations} SET ?`, f.mapping);
  await f.db.query(`INSERT INTO ${f.names.sales_backorder_entries} SET ?`, f.queue);
  await mappingUp(f.scoped); await backorderUp(f.scoped);
  assert.equal(await inspectSalesReservationMappingSchema(f.scoped), true);
  assert.equal(await inspectSalesBackorderSchema(f.scoped), true);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_order_line_reservations}`))[0][0].n, 1);
  assert.equal((await f.db.query(`SELECT priority_at,outstanding_base_quantity FROM ${f.names.sales_backorder_entries}`))[0][0].outstanding_base_quantity, 6);
});

integrationTest("TC-021 mapping rejects negative/over-counted projections, foreign owner/event and duplicate reservations", async t => {
  const f = await setup(t), table = f.names.sales_order_line_reservations;
  for (const changes of [{ outstanding_base_quantity: -1 }, { consumed_base_quantity: 1 }, { original_base_quantity: 5 },
    { inventory_version: 2 }, { source_event_id: randomUUID() }, { status: "RELEASED" }])
    await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, { ...f.mapping, ...changes }));
  await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, { ...f.mapping, inventory_operation_id: f.childId }), { code: "ER_SIGNAL_EXCEPTION" });
  await f.db.query(`INSERT INTO ${table} SET ?`, f.mapping);
  await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, f.mapping), { code: "ER_DUP_ENTRY" });
  await assert.rejects(() => f.db.execute(`UPDATE ${table} SET source_event_id=?`, [randomUUID()]), { code: "ER_SIGNAL_EXCEPTION" });
  await assert.rejects(() => f.db.execute("DELETE FROM inventory_reservations WHERE id=?", [f.reservationId]), { code: "ER_ROW_IS_REFERENCED_2" });
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=3,consumed_quantity=1,status='PARTIALLY_CONSUMED',version=2 WHERE id=?", [f.reservationId]);
  await f.db.execute(`UPDATE ${table} SET outstanding_base_quantity=3,consumed_base_quantity=1,status='PARTIALLY_CONSUMED',inventory_version=2`);
  assert.equal((await f.db.query(`SELECT outstanding_base_quantity FROM ${table}`))[0][0].outstanding_base_quantity, 3);
});

integrationTest("TC-021 Backorder enforces composite owner, scope, terminal quantities and immutable FIFO identity", async t => {
  const f = await setup(t), table = f.names.sales_backorder_entries;
  for (const changes of [{ sales_order_id: f.orderId + 99999 }, { outstanding_base_quantity: 0 }, { outstanding_base_quantity: 11 },
    { outstanding_base_quantity: -1 }, { line_no: 2 }, { sku_id: f.skuId + 99999 }, { status: "FULFILLED" }])
    await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, { ...f.queue, ...changes }));
  await f.db.query(`INSERT INTO ${table} SET ?`, f.queue);
  await assert.rejects(() => f.db.query(`INSERT INTO ${table} SET ?`, f.queue), { code: "ER_DUP_ENTRY" });
  for (const change of ["priority_at=priority_at+1", "line_no=line_no+1", "created_at=created_at+1"])
    await assert.rejects(() => f.db.execute(`UPDATE ${table} SET ${change}`), { code: "ER_SIGNAL_EXCEPTION" });
  await f.db.execute(`UPDATE ${table} SET outstanding_base_quantity=0,status='FULFILLED',version=2`);
  assert.equal((await f.db.query(`SELECT priority_at,status FROM ${table}`))[0][0].status, "FULFILLED");
});

integrationTest("TC-021 commitment migrations repair missing triggers but reject changed composite FK/column/trigger contracts", async t => {
  const f = await setup(t), table = f.names.sales_backorder_entries;
  const [[trigger]] = await f.db.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=? AND event_manipulation='UPDATE'", [table]);
  assert.match(trigger.name, /^[a-z0-9_]+$/u);
  await f.ddl.query(`DROP TRIGGER ${trigger.name}`); await backorderUp(f.scoped);
  await f.ddl.query(`DROP TRIGGER ${trigger.name}`);
  await f.ddl.query(`CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON ${table} FOR EACH ROW SET NEW.priority_at=OLD.priority_at`);
  await assert.rejects(() => backorderUp(f.scoped), /trigger/u);
  await f.db.query(`ALTER TABLE ${f.names.sales_order_line_reservations} MODIFY inventory_version BIGINT UNSIGNED NOT NULL`);
  await assert.rejects(() => mappingUp(f.scoped), /column inventory_version/u);
  const [[fk]] = await f.db.query(`SELECT constraint_name AS name FROM information_schema.key_column_usage
    WHERE table_schema=DATABASE() AND table_name=? AND column_name='sales_order_line_id' AND referenced_table_name='sales_order_lines'`, [table]);
  assert.match(fk.name, /^[a-z0-9_]+$/u);
  await f.db.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${fk.name},
    ADD FOREIGN KEY (sales_order_line_id) REFERENCES sales_order_lines(id) ON DELETE CASCADE,
    ADD FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE`);
  await assert.rejects(() => backorderUp(f.scoped), /foreign key|composite/u);
});
