import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("TC-018 and TC-027 real MySQL lookup enforces status, ownership, purpose and version", async (t) => {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const database = application.services.require("mysqldatabase");
  const lookup = new CustomerLookupService({ database });
  const suffix = randomUUID().slice(0, 8);
  const nowMs = Date.now();
  const customerIds = [];

  t.after(async () => {
    if (customerIds.length) await database.execute("DELETE FROM customers WHERE id IN (?, ?)", customerIds);
    await application.shutdown("customer_task9_lookup_integration_complete");
  });

  for (const [label, status] of [["ACTIVE", "active"], ["BLOCKED", "blocked"]]) {
    const code = `T9-${label}-${suffix}`;
    const legalName = `Task 9 ${label} ${suffix}`;
    const [created] = await database.execute(
      `INSERT INTO customers
         (customer_code, customer_code_key, legal_name, legal_name_key, trading_name, trading_name_key,
          default_currency_code, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'HKD', ?, 1, ?, ?)`,
      [code, code.toLowerCase(), legalName, legalName.toLowerCase(), label, label.toLowerCase(), status, nowMs, nowMs]
    );
    customerIds.push(Number(created.insertId));
  }
  const [address] = await database.execute(
    `INSERT INTO customer_addresses
       (customer_id, label, address_line1, country_code, status, version, created_at, updated_at)
     VALUES (?, 'Warehouse', '1 Main Street', 'HK', 'active', 1, ?, ?)`,
    [customerIds[0], nowMs, nowMs]
  );
  await database.execute(
    `INSERT INTO customer_address_purposes
       (address_id, customer_id, purpose_code, is_default, created_at, updated_at)
     VALUES (?, ?, 'shipping', 1, ?, ?)`,
    [address.insertId, customerIds[0], nowMs, nowMs]
  );
  const [contact] = await database.execute(
    `INSERT INTO customer_contacts
       (customer_id, name, email, status, version, created_at, updated_at)
     VALUES (?, 'Receiver', 'receiver@example.test', 'active', 1, ?, ?)`,
    [customerIds[0], nowMs, nowMs]
  );
  await database.execute(
    `INSERT INTO customer_contact_purposes
       (contact_id, customer_id, purpose_code, is_default, created_at, updated_at)
     VALUES (?, ?, 'shipping', 1, ?, ?)`,
    [contact.insertId, customerIds[0], nowMs, nowMs]
  );
  await database.execute(
    `INSERT INTO customer_credit_profiles
       (customer_id, credit_limit, credit_currency_code, credit_status, credit_notes, last_change_reason,
        version, created_at, updated_at)
     VALUES (?, '0.0000', 'HKD', 'on_hold', 'must not project', 'integration setup', 1, ?, ?)`,
    [customerIds[0], nowMs, nowMs]
  );

  assert.equal((await lookup.findById(customerIds[0], { purpose: "new_sale", atMs: nowMs })).status, "active");
  assert.equal(await lookup.findById(customerIds[1], { purpose: "new_sale", atMs: nowMs }), null);
  assert.equal((await lookup.findById(customerIds[1], { purpose: "history", atMs: nowMs })).status, "blocked");
  const page = await lookup.listActive({ q: `Task 9 ACTIVE ${suffix}`, page: 1, pageSize: 10, purpose: "new_sale", atMs: nowMs });
  assert.deepEqual(page.items.map((item) => item.customerId), [customerIds[0]]);
  assert.deepEqual(await lookup.getCreditPolicy(customerIds[0], { atMs: nowMs }), {
    configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 1
  });
  const addresses = await lookup.listAddresses(customerIds[0], { purpose: "shipping", atMs: nowMs });
  assert.equal(addresses[0].addressId, Number(address.insertId));
  assert.equal("notes" in addresses[0], false);

  await assert.rejects(
    () => lookup.assertAddressUsable(customerIds[1], Number(address.insertId), { purpose: "shipping", expectedVersion: 1, atMs: nowMs }),
    (error) => error.code === "CUSTOMER_PARTY_NOT_FOUND"
  );
  await database.withTransaction(async (connection) => {
    const lockedAddress = await lookup.assertAddressUsableInTransaction(connection, customerIds[0], Number(address.insertId), { purpose: "shipping", expectedVersion: 1, atMs: nowMs });
    const lockedContact = await lookup.assertContactUsableInTransaction(connection, customerIds[0], Number(contact.insertId), { purpose: "shipping", expectedVersion: 1, atMs: nowMs });
    assert.equal(lockedAddress.customerVersion, 1);
    assert.equal(lockedContact.contactId, Number(contact.insertId));
  });
});
