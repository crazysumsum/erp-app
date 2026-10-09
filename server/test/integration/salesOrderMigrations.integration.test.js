import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as keyUp, inspectSalesExternalKeySchema } from "../../database/migrations/0072_create_sales_external_order_keys.js";
import { up as orderUp, inspectSalesOrderSchema } from "../../database/migrations/0073_create_sales_orders.js";
import { up as lineUp, inspectSalesOrderLineSchema } from "../../database/migrations/0074_create_sales_order_lines.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const f = await migrationFixture(t, ["sales_external_order_keys", "sales_orders", "sales_order_lines"]);
  await keyUp(f.scoped); await orderUp(f.scoped); await lineUp(f.scoped);
  f.insertOrder = async (overrides = {}) => {
    const [result] = await f.db.query(`INSERT INTO ${f.names.sales_orders} SET ?`, {
      sales_order_number: `SO-${randomUUID().slice(0, 16)}`, status: "DRAFT", source_type: "MANUAL", customer_id: f.customerId,
      customer_code_snapshot: "Synthetic", customer_name_snapshot: "Synthetic", currency_code: f.currency, fulfillment_warehouse_id: f.warehouseId,
      warehouse_code_snapshot: "Synthetic", warehouse_name_snapshot: "Synthetic", order_date: "2026-10-05", line_count: 1,
      total_amount: "0.0000", created_at: f.now, updated_at: f.now, last_business_updated_at: f.now, ...overrides
    }); return Number(result.insertId);
  };
  f.insertLine = (orderId, overrides = {}) => f.db.query(`INSERT INTO ${f.names.sales_order_lines} SET ?`, {
    sales_order_id: orderId, line_no: 1, sku_id: f.skuId, item_name_snapshot: "Synthetic", sku_code_snapshot: "Synthetic",
    sku_name_snapshot: "Synthetic", sku_uom_id: f.skuUomId, uom_code_snapshot: "EA", uom_name_snapshot: "Each", to_base_factor_snapshot: 1,
    tracking_policy_snapshot: "none", ordered_quantity: "1.000000", ordered_base_quantity: 1, unit_selling_price: "0.0000", price_source: "MANUAL",
    line_amount: "0.0000", created_at: f.now, updated_at: f.now, ...overrides
  });
  return f;
}
integrationTest("TC-016 Sales Order foundation creates empty, preserves upgrade data and reruns with External Key FK", async t => {
  const f = await setup(t); const id = await f.insertOrder(); await f.insertLine(id);
  await keyUp(f.scoped); await orderUp(f.scoped); await lineUp(f.scoped);
  assert.equal(await inspectSalesExternalKeySchema(f.scoped), true); assert.equal(await inspectSalesOrderSchema(f.scoped), true);
  assert.equal(await inspectSalesOrderLineSchema(f.scoped), true);
  const [[row]] = await f.db.query(`SELECT version,credit_status_snapshot,has_backorder FROM ${f.names.sales_orders} WHERE id=?`, [id]);
  assert.deepEqual(row, { version: 1, credit_status_snapshot: "NOT_CONFIGURED", has_backorder: 0 });
  await assert.rejects(() => f.insertOrder({ external_order_key_id: 999999999 }), { code: "ER_NO_REFERENCED_ROW_2" });
  const key = { channel_code: "TEST", external_order_id: "Exact-ID", external_order_id_hash: Buffer.alloc(32, 1), source_type: "CSV", payload_hash: "a".repeat(64),
    status: "PROCESSING", claimed_at: f.now, updated_at: f.now };
  const [inserted] = await f.db.query(`INSERT INTO ${f.names.sales_external_order_keys} SET ?`, key);
  await assert.rejects(() => f.db.query(`INSERT INTO ${f.names.sales_external_order_keys} SET ?`, key), { code: "ER_DUP_ENTRY" });
  await f.db.execute(`UPDATE ${f.names.sales_orders} SET external_order_key_id=? WHERE id=?`, [inserted.insertId, id]);
  await assert.rejects(() => f.db.execute(`DELETE FROM ${f.names.sales_external_order_keys} WHERE id=?`, [inserted.insertId]), { code: "ER_ROW_IS_REFERENCED_2" });
});
integrationTest("TC-016 Draft persistence enforces decimal boundaries, unique lines and quantity projection guards", async t => {
  const f = await setup(t); const id = await f.insertOrder();
  for (const overrides of [{ ordered_quantity: "0" }, { ordered_base_quantity: 0 }, { line_no: 101 }, { to_base_factor_snapshot: 0 },
    { reserved_outstanding_base_quantity: 1, backordered_base_quantity: 1 }, { unit_selling_price: "-1" }])
    await assert.rejects(() => f.insertLine(id, overrides), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await f.insertLine(id, { ordered_quantity: "99999999999999.999999", ordered_base_quantity: "18446744073709551615", unit_selling_price: "999999999999999.9999" });
  await assert.rejects(() => f.insertLine(id), { code: "ER_DUP_ENTRY" });
  const [[line]] = await f.db.query(`SELECT ordered_quantity,unit_selling_price FROM ${f.names.sales_order_lines}`);
  assert.equal(line.ordered_quantity, "99999999999999.999999"); assert.equal(line.unit_selling_price, "999999999999999.9999");
  await f.db.execute(`DELETE FROM ${f.names.sales_orders} WHERE id=?`, [id]);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_order_lines}`))[0][0].n, 0);
});
integrationTest("Sales Order migration rejects drift and list/exact-number queries use planned indexes", async t => {
  const f = await setup(t);
  for (let i = 0; i < 200; i++) await f.insertOrder({ status: i % 2 ? "DRAFT" : "CANCELLED", ...(i === 0 ? { sales_order_number: "SO-TEST" } : {}) });
  for (const [query, index] of [[`SELECT id FROM ${f.names.sales_orders} WHERE status='DRAFT' AND order_date BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY order_date,id LIMIT 20`, "idx_sales_orders_status_date"],
    [`SELECT id FROM ${f.names.sales_orders} WHERE sales_order_number='SO-TEST'`, "uq_sales_order_number"]]) {
    const [plan] = await f.db.query(`EXPLAIN FORMAT=TRADITIONAL ${query}`); assert.equal(plan[0].key, index);
  }
  await f.db.query(`ALTER TABLE ${f.names.sales_order_lines} MODIFY line_amount DECIMAL(19,2) NOT NULL`);
  await assert.rejects(() => lineUp(f.scoped), /column line_amount/u);
});
