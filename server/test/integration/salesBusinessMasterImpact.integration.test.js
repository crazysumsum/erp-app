import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SalesBusinessMasterImpactChecker } from "../../src/modules/sales/SalesBusinessMasterImpactChecker.js";
import { migrationFixture } from "../sales/phase1/fixtures.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Sales impact reads real Quotation/Order Currency and Payment Term references with revision watermark", async t => {
  const f = await migrationFixture(t, []);
  const termCode = `SI-${randomUUID().slice(0, 8)}`;
  const termId = await f.insert("payment_terms", { code: termCode, code_key: termCode.toLowerCase(), name: "Synthetic term", calculation_type: "NET_DAYS", due_days: 30,
    status: "ACTIVE", version: 1, created_at: f.now, updated_at: f.now });
  const header = { customer_id: f.customerId, customer_code_snapshot: "Synthetic", customer_name_snapshot: "Synthetic",
    currency_code: f.currency, payment_term_id: termId, line_count: 1, total_amount: "0.0000", version: 1,
    created_at: f.now, updated_at: f.now, last_business_updated_at: f.now };
  const quotationId = await f.insert("sales_quotations", { ...header, quotation_number: `QI-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    status: "ISSUED", quotation_date: "2026-01-01", valid_until: "2026-12-31" });
  const orderId = await f.insert("sales_orders", { ...header, sales_order_number: `SI-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    source_type: "MANUAL", status: "CANCELLED", fulfillment_warehouse_id: f.warehouseId, warehouse_code_snapshot: "Synthetic", warehouse_name_snapshot: "Synthetic", order_date: "2026-01-01" });
  const checker = new SalesBusinessMasterImpactChecker({ database: f.db });
  for (const subject of [{ entityType: "CURRENCY", entityKey: f.currency }, { entityType: "PAYMENT_TERM", entityKey: termId }]) {
    const before = await checker.check(subject);
    assert.equal(before.status, "READY"); assert.equal(before.activeDefaultCount, 0);
    assert.equal(before.openUseCount, 1); assert.equal(before.historicalCount, 1);
    await f.db.execute("UPDATE sales_orders SET version=version+1,updated_at=updated_at+1 WHERE id=?", [orderId]);
    const after = await checker.check(subject);
    assert.notEqual(after.watermark, before.watermark); assert.equal(after.historicalCount, before.historicalCount);
  }
  const beforeExpiry = await checker.check({ entityType: "CURRENCY", entityKey: f.currency });
  await f.db.execute("UPDATE sales_quotations SET status='EXPIRED',version=version+1,updated_at=updated_at+1 WHERE id=?", [quotationId]);
  const afterExpiry = await checker.check({ entityType: "CURRENCY", entityKey: f.currency });
  assert.equal(afterExpiry.openUseCount, 0); assert.equal(afterExpiry.historicalCount, 2);
  assert.notEqual(afterExpiry.watermark, beforeExpiry.watermark);
});
