/**
 * `POST /api/v1/user/profile` 的自助改資料端點，對一個真的、已經 migrate 過的
 * MySQL 驗收。設計說明見 docs/user_management/design_spec.md §4.5、「已確認的
 * 決定」表（`users.email`）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedUser(db, { username, password }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();
  const [result] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  return { userId: result.insertId, username };
}

async function cleanupUser(db, userId) {
  await db.execute("DELETE FROM user_audit_logs WHERE actor_user_id = ? OR target_id = ?", [
    userId,
    userId
  ]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");
  return async (userId) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    return jwt.issue({ roles: [], permissions: [] }, { subject: String(userId), version, authTime });
  };
}

function authed(token, body) {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

test("a user can update their own displayName and email, and it is audited", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const user = await seedUser(db, { username: `it-profile-${randomUUID().slice(0, 8)}`, password });

  t.after(async () => {
    await cleanupUser(db, user.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(user.userId);

  const requestId = `it-req-${randomUUID()}`;
  const request = authed(token, { displayName: "New Name", email: "new@example.com" });
  request.headers["X-Request-Id"] = requestId;

  const response = await fetch(`${url}/api/v1/user/profile`, request);
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.displayName, "New Name");
  assert.equal(body.data.email, "new@example.com");

  const meResponse = await fetch(`${url}/api/v1/user/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meBody = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(meBody.data.displayName, "New Name");
  assert.equal(meBody.data.email, "new@example.com");

  const [[auditRow]] = await db.query(
    "SELECT action, detail, request_id, ip FROM user_audit_logs WHERE target_id = ? AND action = 'user.profile'",
    [user.userId]
  );
  assert.ok(auditRow, "expected a user.profile audit row");
  assert.equal(auditRow.request_id, requestId);
  assert.ok(auditRow.ip);
  assert.deepEqual(auditRow.detail, {
    displayName: { before: "Integration Test User", after: "New Name" },
    email: { before: "", after: "new@example.com" }
  });
});

test("an empty email clears it back to unset", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const user = await seedUser(db, { username: `it-profile-${randomUUID().slice(0, 8)}`, password });
  await db.execute("UPDATE users SET email = ? WHERE id = ?", ["old@example.com", user.userId]);

  t.after(async () => {
    await cleanupUser(db, user.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(user.userId);

  const response = await fetch(
    `${url}/api/v1/user/profile`,
    authed(token, { displayName: "Integration Test User", email: "" })
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.data.email, "");

  const [[row]] = await db.query("SELECT email FROM users WHERE id = ?", [user.userId]);
  assert.equal(row.email, null, "an empty email must be stored as NULL, not an empty string");
});

test("an invalid email format is rejected by schema validation", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const user = await seedUser(db, { username: `it-profile-${randomUUID().slice(0, 8)}`, password });

  t.after(async () => {
    await cleanupUser(db, user.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(user.userId);

  const response = await fetch(
    `${url}/api/v1/user/profile`,
    authed(token, { displayName: "Integration Test User", email: "not-an-email" })
  );
  assert.equal(response.status, 400);

  const [[row]] = await db.query("SELECT email FROM users WHERE id = ?", [user.userId]);
  assert.equal(row.email, null, "a rejected update must not touch the stored row");
});
