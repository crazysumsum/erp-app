import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function request(url, { method = "GET", token, key, body } = {}) {
  return fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json() }));
}

integrationTest("TC-012 Customer HTTP create, replay, list, update and operation result are durable", async (t) => {
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
  const db = application.services.require("mysqldatabase");
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const roleName = `customer-role-${suffix}`;
  const username = `customer-user-${suffix}`;
  const customerCode = `CUS-${suffix}`;
  let userId;
  let roleId;
  let customerId;
  t.after(async () => {
    if (customerId) {
      await db.execute("DELETE FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
      await db.execute("DELETE FROM customer_operation_requests WHERE resource_type = 'customer' AND resource_id = ?", [customerId]);
      await db.execute("DELETE FROM customers WHERE id = ?", [customerId]);
    }
    if (userId) {
      await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
      await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await db.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    if (roleId) {
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
    await application.shutdown("customer_root_http_test_complete");
  });

  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  roleId = Number(role.insertId);
  for (const permissionName of ["customer.view", "customer.mgmt"]) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [permissionName]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  const [user] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [username, await hashPassword("Customer-Root-Test-1!"), "Customer Root Integration", nowMs, nowMs]
  );
  userId = Number(user.insertId);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const jwt = application.services.require("jwt");
  const version = await application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await jwt.issue(
    { roles: [roleName], permissions: ["customer.view", "customer.mgmt"] },
    { subject: String(userId), version, authTime: Math.floor(nowMs / 1000) }
  );

  const { url } = await application.start();
  const createKey = randomUUID();
  const createBody = { customerCode: ` ${customerCode} `, legalName: " Acme Customer Limited ", tradingName: " Acme " };
  const created = await request(`${url}/api/v1/customers/create`, { method: "POST", token, key: createKey, body: createBody });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  customerId = created.body.data.customer.id;
  assert.equal(created.body.data.customer.status, "draft");
  const operationId = created.body.data.operation.operationId;

  const replay = await request(`${url}/api/v1/customers/create`, { method: "POST", token, key: createKey, body: createBody });
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(replay.body.data.customer.id, customerId);

  const listed = await request(`${url}/api/v1/customers?q=${encodeURIComponent(customerCode.slice(0, 7))}`, { token });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.data.items[0].id, customerId);

  const updateBody = {
    legalName: "Acme Customer Limited", tradingName: "Acme Updated", defaultCurrencyCode: null,
    defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null,
    territoryId: null, website: "", generalPhone: "", generalEmail: "", notes: "", version: 1,
    reason: "integration update"
  };
  const updated = await request(`${url}/api/v1/customers/${customerId}/update`, { method: "POST", token, key: randomUUID(), body: updateBody });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.customer.version, 2);

  const operation = await request(`${url}/api/v1/customer-operations/${operationId}`, { token });
  assert.equal(operation.status, 200, JSON.stringify(operation.body));
  assert.equal(operation.body.data.resourceId, customerId);
  assert.equal(operation.body.data.status, "succeeded");
});
