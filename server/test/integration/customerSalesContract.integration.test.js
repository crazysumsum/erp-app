import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { validateSalesOrderInput } from "../../src/handlers/sales/salesSchemas.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";
import { SalesLookupService } from "../../src/modules/sales/SalesLookupService.js";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { setup, stock } from "../sales/phase2/fixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("TC-070 Sales consumes the Customer 2.1 active/default/current-policy contract", async t => {
  const orderInput = f => ({ eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency,
    fulfillmentWarehouseId: f.warehouseId, orderDate: f.time.fileDate(),
    lines: [{ skuId: f.skuId, skuUomId: f.skuUomId, quantity: "10.000000", unitSellingPrice: "1.0000" }] });
  assert.throws(() => validateSalesOrderInput({ ...orderInput({ customerId: 1, currency: "HKD", warehouseId: 1,
    time: { fileDate: () => "2026-10-14" }, skuId: 1, skuUomId: 1 }), shippingAddress: "spoof" }),
  { code: "SALES_INPUT_INVALID" });

  const f = await setup(t), lookup = new SalesLookupService(f);
  const [[customer]] = await f.db.query("SELECT customer_code FROM customers WHERE id=?", [f.customerId]);
  assert.equal((await lookup.list({ claims: f.claims, kind: "customers", input: { q: customer.customer_code } })).total, 1);
  await f.db.execute("UPDATE customers SET status='blocked',version=version+1 WHERE id=?", [f.customerId]);
  assert.equal((await lookup.list({ claims: f.claims, kind: "customers", input: { q: customer.customer_code } })).total, 0);
  await assert.rejects(() => new SalesOrderService(f).update({ claims: f.claims, id: f.request.id,
    input: { ...orderInput(f), version: 1 } }), { code: "CUSTOMER_NOT_SALEABLE" });

  const termCode = `C70-${randomUUID().slice(0, 8)}`;
  const termId = await f.insert("payment_terms", { code: termCode, code_key: termCode.toLowerCase(), name: "TC-070 term",
    calculation_type: "NET_DAYS", due_days: 30, status: "ACTIVE", version: 1, created_at: f.now, updated_at: f.now });
  f.beforeParents.push(() => f.db.execute("UPDATE customers SET default_payment_term_id=NULL WHERE id=?", [f.customerId]));
  await f.db.execute("UPDATE customers SET status='active',default_payment_term_id=?,version=version+1 WHERE id=?", [termId, f.customerId]);

  const order = await new SalesOrderService(f).update({ claims: f.claims, id: f.request.id,
    input: { ...orderInput(f), version: 1 } });
  assert.equal(order.salesOrder.paymentTermId, termId);
  assert.equal(order.salesOrder.paymentTermCode, termCode);
  assert.equal(CustomerLookupService.contract, "customer-purpose-provider-contracts/aligned-design-2.1");

  await stock(f, 10);
  const intent = await f.service().startConfirmation({ ...f.request, input: { ...f.request.input, version: 2 } });
  await f.db.execute("UPDATE customers SET legal_name='TC-070 current name',version=version+1 WHERE id=?", [f.customerId]);
  await f.insert("customer_credit_profiles", { customer_id: f.customerId, credit_limit: "25.0000",
    credit_currency_code: f.currency, credit_status: "normal", last_change_reason: "TC-070 current policy",
    version: 1, created_at: f.now, updated_at: f.now }, "customer_id");
  const result = await f.service().completeConfirmation({ eventId: intent.eventId, claims: f.claims, leaseOwner: intent.leaseOwner });
  assert.equal(result.salesOrder.customerName, "TC-070 current name");
  assert.equal(result.salesOrder.paymentTermId, termId);
  const [[credit]] = await f.db.query(`SELECT credit_status_snapshot,credit_limit_snapshot,credit_policy_version_snapshot
    FROM sales_orders WHERE id=?`, [f.request.id]);
  assert.deepEqual(credit, { credit_status_snapshot: "NORMAL", credit_limit_snapshot: "25.0000", credit_policy_version_snapshot: 1 });
});
