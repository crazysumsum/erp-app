import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { inspectCustomerIdentifierSchema } from "../../database/migrations/0044_create_customer_identifiers.js";
import { inspectCustomerCreditSchema } from "../../database/migrations/0045_create_customer_credit_profiles.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Customer-Task8-Test-1!";

function request(url, { method = "GET", token, key, body } = {}) {
  return fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

integrationTest("TC-021..025 real MySQL and HTTP preserve Identifier uniqueness and Credit semantics", async (t) => {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = application.services.require("mysqldatabase");
  assert.equal(await db.withTransaction((connection) => inspectCustomerIdentifierSchema(connection)), true);
  assert.equal(await db.withTransaction((connection) => inspectCustomerCreditSchema(connection)), true);

  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const roleName = `task8-role-${suffix}`;
  const username = `task8-user-${suffix}`;
  const marker = `sensitive-${suffix}`;
  let roleId = null;
  let userId = null;
  const customerIds = [];

  t.after(async () => {
    if (customerIds.length) {
      await db.execute("DELETE FROM customer_audit_logs WHERE customer_id IN (?, ?)", customerIds);
      await db.execute("DELETE FROM customers WHERE id IN (?, ?)", customerIds);
    }
    await db.execute("DELETE FROM currencies WHERE code = 'TXX'");
    if (userId) {
      await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
      await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await db.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    if (roleId) {
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
    await application.shutdown("customer_task8_integration_complete");
  });

  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  roleId = Number(role.insertId);
  for (const permissionName of ["customer.view", "customer.mgmt"]) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [permissionName]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  const [user] = await db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [username, await hashPassword(PASSWORD), "Task 8 Integration", nowMs, nowMs]);
  userId = Number(user.insertId);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  await db.execute("INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at, created_by, updated_by) VALUES ('TXX', 'Inactive Test Currency', 2, 'INACTIVE', 1, ?, ?, ?, ?)", [nowMs, nowMs, userId, userId]);
  for (const label of ["A", "B"]) {
    const code = `T8-${label}-${suffix}`;
    const [customer] = await db.execute("INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key, created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [code, code.toLowerCase(), code, code.toLowerCase(), nowMs, nowMs, userId, userId]);
    customerIds.push(Number(customer.insertId));
  }

  const jwt = application.services.require("jwt");
  const tokenVersion = await application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await jwt.issue({ roles: [roleName], permissions: ["customer.view", "customer.mgmt"] }, { subject: String(userId), version: tokenVersion, authTime: Math.floor(nowMs / 1000) });
  const { url } = await application.start();

  const sharedIdentifier = { identifierType: "tax", issuerCountryCode: "HK", identifierValue: ` ${marker}-12 34 `, validFrom: null, expiresAt: null, notes: marker };
  const raced = await Promise.all(customerIds.map((customerId) => request(`${url}/api/v1/customers/${customerId}/identifiers/create`, { method: "POST", token, key: randomUUID(), body: sharedIdentifier })));
  assert.deepEqual(raced.map((result) => result.status).sort(), [201, 409]);
  const winner = raced.find((result) => result.status === 201).body.data;
  const loserCustomerId = customerIds.find((id) => id !== winner.customerId);
  assert.equal(raced.find((result) => result.status === 409).body.error.code, "IDENTIFIER_TAKEN");

  const second = await request(`${url}/api/v1/customers/${loserCustomerId}/identifiers/create`, { method: "POST", token, key: randomUUID(), body: { ...sharedIdentifier, identifierValue: `UNIQUE-${suffix}` } });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const updateConflict = await request(`${url}/api/v1/customers/${loserCustomerId}/identifiers/${second.body.data.id}/update`, { method: "POST", token, key: randomUUID(), body: { ...sharedIdentifier, version: 1, reason: "replace identifier" } });
  assert.equal(updateConflict.status, 409, JSON.stringify(updateConflict.body));
  assert.equal(updateConflict.body.error.code, "IDENTIFIER_TAKEN");
  const deactivated = await request(`${url}/api/v1/customers/${winner.customerId}/identifiers/${winner.id}/deactivate`, { method: "POST", token, key: randomUUID(), body: { version: 1, reason: "identifier expired" } });
  assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
  assert.equal(deactivated.body.data.status, "inactive");
  const retained = await request(`${url}/api/v1/customers/${loserCustomerId}/identifiers/create`, { method: "POST", token, key: randomUUID(), body: sharedIdentifier });
  assert.equal(retained.status, 409, JSON.stringify(retained.body));

  const absent = await request(`${url}/api/v1/customers/${winner.customerId}/credit-policy`, { token });
  assert.deepEqual(absent.body.data, { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });
  const firstSaves = await Promise.all([
    request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/save`, { method: "POST", token, key: randomUUID(), body: { creditLimit: null, creditCurrencyCode: null, creditStatus: "normal", creditNotes: marker, reason: "first policy", version: null } }),
    request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/save`, { method: "POST", token, key: randomUUID(), body: { creditLimit: "0.0000", creditCurrencyCode: "HKD", creditStatus: "on_hold", creditNotes: marker, reason: "first hold", version: null } })
  ]);
  assert.deepEqual(firstSaves.map((result) => result.status).sort(), [200, 409]);
  assert.equal(firstSaves.find((result) => result.status === 409).body.error.code, "VERSION_CONFLICT");

  const zero = await request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/save`, { method: "POST", token, key: randomUUID(), body: { creditLimit: "0.0000", creditCurrencyCode: "HKD", creditStatus: "on_hold", creditNotes: marker, reason: "standardize hold", version: 1 } });
  assert.equal(zero.status, 200, JSON.stringify(zero.body));
  assert.deepEqual(zero.body.data, { configured: true, creditLimit: "0.0000", currencyCode: "HKD", status: "on_hold", policyVersion: 2 });
  const invalidCurrency = await request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/save`, { method: "POST", token, key: randomUUID(), body: { creditLimit: "1.0000", creditCurrencyCode: "TXX", creditStatus: "normal", creditNotes: "", reason: "invalid currency", version: 2 } });
  assert.equal(invalidCurrency.status, 400, JSON.stringify(invalidCurrency.body));
  assert.equal(invalidCurrency.body.error.code, "CREDIT_POLICY_INVALID");

  const clears = await Promise.all([
    request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/clear`, { method: "POST", token, key: randomUUID(), body: { version: 2, reason: "clear policy", password: PASSWORD } }),
    request(`${url}/api/v1/customers/${winner.customerId}/credit-policy/clear`, { method: "POST", token, key: randomUUID(), body: { version: 2, reason: "clear policy", password: PASSWORD } })
  ]);
  assert.deepEqual(clears.map((result) => result.status).sort(), [200, 409]);
  assert.equal(clears.find((result) => result.status === 409).body.error.code, "VERSION_CONFLICT");
  const cleared = await request(`${url}/api/v1/customers/${winner.customerId}/credit-policy`, { token });
  assert.deepEqual(cleared.body.data, { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null });

  const [[auditCounts]] = await db.query("SELECT COUNT(*) AS total, SUM(action LIKE 'customer.identifier.%') AS identifiers, SUM(action LIKE 'customer.credit.%') AS credit FROM customer_audit_logs WHERE customer_id IN (?, ?)", customerIds);
  assert.deepEqual({ total: Number(auditCounts.total), identifiers: Number(auditCounts.identifiers), credit: Number(auditCounts.credit) }, { total: 6, identifiers: 3, credit: 3 });
  const [[leaks]] = await db.query("SELECT COUNT(*) AS count FROM customer_audit_logs WHERE customer_id IN (?, ?) AND CAST(detail AS CHAR) LIKE ?", [...customerIds, `%${marker}%`]);
  assert.equal(Number(leaks.count), 0);
});
