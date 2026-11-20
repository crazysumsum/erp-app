import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import { up as createIssueTables } from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { shipmentDraftFixture } from "../fulfillment/p1CancellationFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function fixture(t, { block = false } = {}) {
  const f = await shipmentDraftFixture(t);
  await createIssueTables(f.db);
  const contactId = await f.s.insert("customer_contacts", {
    customer_id: f.s.customerId, name: "Original contact", phone: "55501000",
    email: "original@example.invalid", created_at: f.s.now, updated_at: f.s.now
  });
  await f.s.insert("customer_contact_purposes", {
    contact_id: contactId, customer_id: f.s.customerId, purpose_code: "shipping",
    is_default: 1, created_at: f.s.now, updated_at: f.s.now
  });
  if (block) {
    const [[order]] = await f.db.query("SELECT status FROM sales_orders WHERE id=?", [f.s.orderId]);
    assert.equal(order.status, "CONFIRMED");
    await f.db.execute("UPDATE customers SET status='blocked',version=version+1 WHERE id=?", [f.s.customerId]);
  }
  const draft = await f.create({ ...f.body(), shippingContactId: Number(contactId), shippingContactVersion: 1 });
  const shipmentId = draft.outcome.id;
  const service = new ShipmentConfirmationService(f.options);
  const started = await f.execute(() => service.startConfirmation(shipmentId, { eventId: randomUUID(), version: 1 }));
  return { ...f, contactId, shipmentId, confirm: () => f.execute(() => service.completeConfirmation(started)) };
}

integrationTest("TC-071 confirmed order can ship after its customer is blocked", async t => {
  const f = await fixture(t, { block: true });
  assert.equal((await f.confirm()).outcome, "SHIPPED");
  const [[shipment]] = await f.db.query("SELECT status,customer_id FROM shipments WHERE id=?", [f.shipmentId]);
  assert.equal(shipment.status, "SHIPPED");
  assert.equal(Number(shipment.customer_id), Number(f.s.customerId));
});

integrationTest("TC-071 shipment preserves the exact original customer, address and contact fields", async t => {
  const f = await fixture(t);
  const [[expected]] = await f.db.query(`
    SELECT c.customer_code AS customer_code_snapshot,c.legal_name AS customer_name_snapshot,
      a.label AS address_name_snapshot,a.recipient_company_department AS recipient_company_snapshot,
      p.name AS recipient_name_snapshot,a.address_line1 AS address_line1_snapshot,
      a.address_line2 AS address_line2_snapshot,a.address_line3 AS address_line3_snapshot,
      a.city AS city_snapshot,a.state_region AS region_snapshot,a.postal_code AS postal_code_snapshot,
      COALESCE(a.country_code,'') AS country_code_snapshot,p.name AS contact_name_snapshot,
      p.phone AS contact_phone_snapshot,p.email AS contact_email_snapshot
    FROM customers c JOIN customer_addresses a ON a.customer_id=c.id
    JOIN customer_contacts p ON p.customer_id=c.id
    WHERE c.id=? AND a.id=? AND p.id=?`, [f.s.customerId, f.s.addressId, f.contactId]);
  assert.equal((await f.confirm()).outcome, "SHIPPED");
  await f.db.execute("UPDATE customers SET legal_name='Renamed Customer',version=version+1 WHERE id=?", [f.s.customerId]);
  await f.db.execute("UPDATE customer_addresses SET address_line1='Updated street',version=version+1 WHERE id=?", [f.s.addressId]);
  await f.db.execute("UPDATE customer_contacts SET name='Updated contact',version=version+1 WHERE id=?", [f.contactId]);
  const [[saved]] = await f.db.query("SELECT * FROM shipments WHERE id=?", [f.shipmentId]);
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, saved[key]])), expected);
});

integrationTest("TC-071 shipment refuses a child version changed by a concurrent transaction", async t => {
  for (const kind of ["address", "contact"]) {
    await t.test(kind, async subtest => {
      const f = await fixture(subtest);
      const table = kind === "address" ? "customer_addresses" : "customer_contacts";
      const id = kind === "address" ? f.s.addressId : f.contactId;
      const writer = await mysql.createConnection({ ...f.f.connectionOptions, database: f.f.name });
      let confirmation;
      try {
        const [[connection]] = await writer.query("SELECT CONNECTION_ID() AS id");
        await writer.beginTransaction();
        const [updated] = await writer.execute(`UPDATE ${table} SET version=version+1 WHERE id=? AND version=1`, [id]);
        assert.equal(updated.affectedRows, 1);
        confirmation = f.confirm().then(value => ({ value }), error => ({ error }));
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (!waiting && Date.now() < deadline) {
          const [[result]] = await f.db.query(`
            SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
            JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
            JOIN performance_schema.threads th ON th.THREAD_ID=w.BLOCKING_THREAD_ID
            WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME=? AND th.PROCESSLIST_ID=?`, [f.f.name, table, connection.id]);
          waiting = Number(result.n) > 0;
          if (!waiting) await delay(10);
        }
        assert.ok(waiting, `confirmation must wait on the real ${kind} writer`);
        await writer.commit();
        const result = await confirmation;
        assert.equal(result.error?.code, "SHIPPING_ADDRESS_CHANGED");
        const [[shipment]] = await f.db.query("SELECT status FROM shipments WHERE id=?", [f.shipmentId]);
        assert.equal(shipment.status, "DRAFT");
        const [[issues]] = await f.db.query("SELECT COUNT(*) AS n FROM shipment_issue_details WHERE shipment_id=?", [f.shipmentId]);
        assert.equal(Number(issues.n), 0);
      } finally {
        await writer.rollback();
        await writer.end();
        await confirmation;
      }
    });
  }
});
