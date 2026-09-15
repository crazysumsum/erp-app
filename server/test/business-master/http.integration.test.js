import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1";
const integrationTest = enabled ? test : test.skip;

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

integrationTest("TC-012 real HTTP authentication and authorized admin flow", async (t) => {
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } },
    serviceDiscoveryOptions: {
      additionalModuleUrls: [new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href]
    }
  });
  const db = application.services.require("mysqldatabase");
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const roleName = `bm-role-${suffix}`;
  const username = `bm-user-${suffix}`;
  const passwordHash = await hashPassword("Business-Master-Test-1!");
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  for (const permissionName of ["business_master.view", "business_master.mgmt"]) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [permissionName]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleResult.insertId, permission.id]);
  }
  const [userResult] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [username, passwordHash, "Business Master Integration", nowMs, nowMs]
  );
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userResult.insertId, roleResult.insertId]);
  const jwt = application.services.require("jwt");
  const version = await application.services.require("tokenRevocation").currentVersion(String(userResult.insertId));
  const token = await jwt.issue(
    { roles: [roleName], permissions: ["business_master.view", "business_master.mgmt"] },
    { subject: String(userResult.insertId), version, authTime: Math.floor(nowMs / 1000) }
  );
  let termId = null;
  const currencyCode = "NZD";
  t.after(async () => {
    await db.execute("DELETE FROM business_master_audit_logs WHERE actor_user_id = ?", [userResult.insertId]);
    if (termId !== null) await db.execute("DELETE FROM payment_terms WHERE id = ?", [termId]);
    await db.execute("DELETE FROM currencies WHERE code = ?", [currencyCode]);
    await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userResult.insertId]);
    await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleResult.insertId]);
    await db.execute("DELETE FROM users WHERE id = ?", [userResult.insertId]);
    await db.execute("DELETE FROM roles WHERE id = ?", [roleResult.insertId]);
    await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userResult.insertId)]);
    await application.shutdown("business_master_http_test_complete");
  });

  const { url } = await application.start();
  assert.equal((await request(`${url}/api/v1/business-master/currencies`)).status, 401);

  const createKey = randomUUID();
  const createBody = { code: ` ${currencyCode} `, name: "New Zealand Dollar", decimalPlaces: 2 };
  const created = await request(`${url}/api/v1/business-master/currencies`, { method: "POST", token, key: createKey, body: createBody });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.code, currencyCode);
  const replay = await request(`${url}/api/v1/business-master/currencies`, { method: "POST", token, key: createKey, body: createBody });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const reused = await request(`${url}/api/v1/business-master/currencies`, { method: "POST", token, key: createKey, body: { ...createBody, name: "Different" } });
  assert.equal(reused.status, 409, JSON.stringify(reused.body));
  assert.equal(reused.body.error.code, "IDEMPOTENCY_CONFLICT");

  const protectedPatch = await request(`${url}/api/v1/business-master/currencies/${currencyCode}`, {
    method: "PATCH", token, key: randomUUID(), body: { name: "NZ Dollar", decimalPlaces: 3, version: 1 }
  });
  assert.equal(protectedPatch.status, 400);

  const preview = await request(`${url}/api/v1/business-master/currencies/${currencyCode}/impact-preview`, {
    method: "POST", token, key: randomUUID(), body: { operation: "DEACTIVATE", version: 1, proposedChange: {} }
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.results.length, 6);
  assert.equal(preview.body.data.results.every((row) => row.status === "NOT_INSTALLED"), true);
  const rejected = await request(`${url}/api/v1/business-master/currencies/${currencyCode}/deactivate`, {
    method: "POST", token, key: randomUUID(), body: { version: 1, reason: "stale impact test", impactToken: "invalid-token" }
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error.code, "IMPACT_TOKEN_INVALID");
  const deactivated = await request(`${url}/api/v1/business-master/currencies/${currencyCode}/deactivate`, {
    method: "POST", token, key: randomUUID(), body: { version: 1, reason: "integration test", impactToken: preview.body.data.impactToken }
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.status, "INACTIVE");
  const audit = await request(`${url}/api/v1/business-master/audit?entityType=CURRENCY&entityKey=${currencyCode}`, { token });
  assert.equal(audit.status, 200, JSON.stringify(audit.body));
  assert.deepEqual(new Set(audit.body.data.items.map((entry) => entry.result)), new Set(["SUCCESS", "REJECTED"]));

  const term = await request(`${url}/api/v1/business-master/payment-terms`, {
    method: "POST", token, key: randomUUID(), body: { code: `NET-${suffix}`, name: "Net 30", description: "Thirty days", calculationType: "NET_DAYS", dueDays: 30 }
  });
  assert.equal(term.status, 201);
  termId = term.body.data.id;
  const calculated = await request(`${url}/api/v1/business-master/payment-terms/${termId}/calculate`, {
    method: "POST", token, key: randomUUID(), body: { baseDate: "2026-01-31", expectedVersion: 1 }
  });
  assert.equal(calculated.status, 200);
  assert.equal(calculated.body.data.dueDate, "2026-03-02");
});
