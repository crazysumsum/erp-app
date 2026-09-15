import assert from "node:assert/strict";
import test from "node:test";

import { inspectCustomerPartySchema } from "../../database/migrations/0034_create_customer_party_tables.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerPartyService } from "../../src/modules/customer/CustomerPartyService.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function address(label, line, purposes) {
  return { label, addressLine1: line, purposes, recipientCompanyDepartment: "", addressLine2: "", addressLine3: "", city: "", stateRegion: "", postalCode: "", countryCode: null, phone: "", notes: "", sortOrder: 0 };
}

function contact(name, purposes) {
  return { name, purposes, jobTitle: "", department: "", email: "", phone: "", mobile: "", preferredLanguage: "", notes: "", sortOrder: 0 };
}

integrationTest("TC-018..020 real MySQL serializes default switching and hides cross-owner children", async (t) => {
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = app.services.require("mysqldatabase");
  assert.equal(await db.withTransaction((connection) => inspectCustomerPartySchema(connection)), true);
  const now = Date.now();
  const suffix = String(now);
  const [user] = await db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [`party-${suffix}`, await hashPassword("Customer-Party-Test-1!"), "Party Test", now, now]);
  const userId = Number(user.insertId);
  const customerIds = [];
  for (const code of [`PARTY-A-${suffix}`, `PARTY-B-${suffix}`]) {
    const [result] = await db.execute("INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [code, code.toLowerCase(), code, code.toLowerCase(), now, now, userId, userId]);
    customerIds.push(Number(result.insertId));
  }
  t.after(async () => {
    await db.execute("DELETE FROM customers WHERE id IN (?, ?)", customerIds);
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
    await app.shutdown("customer_party_integration_complete");
  });

  const party = new CustomerPartyService({ database: db, time: { nowMs: () => Date.now() }, actorVerifier: async () => ({ username: "party-test" }), audit: { record: async () => {} } });
  const first = await party.create({ type: "address", customerId: customerIds[0], actorId: userId, ...address("First", "1 Main", [{ code: "shipping", isDefault: false }]) });
  const second = await party.create({ type: "address", customerId: customerIds[0], actorId: userId, ...address("Second", "2 Main", [{ code: "shipping", isDefault: false }]) });

  await Promise.all([
    party.update({ type: "address", customerId: customerIds[0], partyId: first.id, actorId: userId, version: 1, reason: "set default", ...address("First", "1 Main", [{ code: "shipping", isDefault: true }]) }),
    party.update({ type: "address", customerId: customerIds[0], partyId: second.id, actorId: userId, version: 1, reason: "set default", ...address("Second", "2 Main", [{ code: "shipping", isDefault: true }]) })
  ]);
  const [[defaults]] = await db.query("SELECT COUNT(*) AS count FROM customer_address_purposes WHERE customer_id = ? AND purpose_code = 'shipping' AND is_default = 1", [customerIds[0]]);
  assert.equal(Number(defaults.count), 1);

  await assert.rejects(() => party.update({ type: "address", customerId: customerIds[1], partyId: first.id, actorId: userId, version: 2, reason: "wrong owner", ...address("First", "1 Main", []) }), (error) => error.code === "CUSTOMER_PARTY_NOT_FOUND" && error.statusCode === 404);

  const [[winner]] = await db.query("SELECT address_id FROM customer_address_purposes WHERE customer_id = ? AND purpose_code = 'shipping' AND is_default = 1", [customerIds[0]]);
  await party.deactivate({ type: "address", customerId: customerIds[0], partyId: Number(winner.address_id), actorId: userId, version: 2, reason: "office closed" });
  const [[after]] = await db.query("SELECT COUNT(*) AS count FROM customer_address_purposes WHERE customer_id = ? AND purpose_code = 'shipping' AND is_default = 1", [customerIds[0]]);
  assert.equal(Number(after.count), 0);

  const firstContact = await party.create({ type: "contact", customerId: customerIds[0], actorId: userId, ...contact("First Contact", [{ code: "general", isDefault: true }, { code: "billing_ar", isDefault: false }]) });
  const secondContact = await party.create({ type: "contact", customerId: customerIds[0], actorId: userId, ...contact("Second Contact", [{ code: "general", isDefault: false }, { code: "billing_ar", isDefault: true }]) });
  await party.update({ type: "contact", customerId: customerIds[0], partyId: secondContact.id, actorId: userId, version: 1, reason: "primary contact changed", ...contact("Second Contact", [{ code: "general", isDefault: true }, { code: "billing_ar", isDefault: true }]) });
  const [contactDefaults] = await db.query("SELECT purpose_code, COUNT(*) AS count FROM customer_contact_purposes WHERE customer_id = ? AND is_default = 1 GROUP BY purpose_code ORDER BY purpose_code", [customerIds[0]]);
  assert.deepEqual(contactDefaults.map((row) => [row.purpose_code, Number(row.count)]), [["billing_ar", 1], ["general", 1]]);
  await party.deactivate({ type: "contact", customerId: customerIds[0], partyId: secondContact.id, actorId: userId, version: 2, reason: "left company" });
  const [[inactiveDefaults]] = await db.query("SELECT COUNT(*) AS count FROM customer_contact_purposes WHERE contact_id = ? AND is_default = 1", [secondContact.id]);
  assert.equal(Number(inactiveDefaults.count), 0);
  const [[preservedPurposes]] = await db.query("SELECT COUNT(*) AS count FROM customer_contact_purposes WHERE contact_id = ?", [secondContact.id]);
  assert.equal(Number(preservedPurposes.count), 2);
  const [[customerVersion]] = await db.query("SELECT version FROM customers WHERE id = ?", [customerIds[0]]);
  assert.equal(Number(customerVersion.version), 10);
  assert.equal(firstContact.version, 1);
});
