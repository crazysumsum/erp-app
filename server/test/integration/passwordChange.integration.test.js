/**
 * Phase 4 對一個真的、已經 migrate 過的 MySQL 驗收。設計說明見
 * docs/user_management/design_spec.md §3.4、§3.5、§7 Phase 4 的驗收條件。
 *
 * 這是唯一一個真的走完整登入流程（含設備簽章）的用戶管理整合測試檔案——其他
 * 檔案直接用 jwt service 簽發 token，因為它們要驗的是各自的端點本身。這裡要
 * 驗的正是登入簽出來的 token 有沒有正確帶上 mcp claim、而那個 claim 有沒有
 * 真的擋住東西，繞過真登入測不到這件事。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { createTestDevice } from "../../test-support/testDevice.js";

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

async function systemAdminRoleId(db) {
  const [[row]] = await db.query("SELECT id FROM roles WHERE name = 'system-admin'");
  return row.id;
}

async function seedUser(db, { username, password, roleId, mustChangePassword = false, temporaryPasswordExpiresAt = null }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();

  const [userResult] = await db.execute(
    `INSERT INTO users
       (username, password_hash, display_name, must_change_password, temporary_password_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", mustChangePassword ? 1 : 0, temporaryPasswordExpiresAt, nowMs, nowMs]
  );
  const userId = userResult.insertId;

  if (roleId) {
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  }

  return { userId, username };
}

async function cleanupUser(db, userId) {
  await db.execute("DELETE FROM user_audit_logs WHERE actor_user_id = ? OR target_id = ?", [
    userId,
    userId
  ]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
}

/** 直接把一台設備種成 approved，略過申請／審批流程——那條路已經由
 * authFlow.integration.test.js 證明過。 */
async function seedApprovedDevice(db, { userId, device }) {
  const nowMs = Date.now();
  await db.execute(
    `INSERT INTO user_devices
       (user_id, device_id, public_key, label, status, requested_at, requested_ip, requested_ua, reviewed_at)
     VALUES (?, ?, ?, '', 'approved', ?, '', '', ?)`,
    [userId, device.deviceId, device.publicKeyDer, nowMs, nowMs]
  );
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");

  return async (userId, { roles, permissions, did }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    const claims = { roles, permissions };
    if (did) {
      claims.did = did;
    }
    return jwt.issue(claims, { subject: String(userId), version, authTime });
  };
}

async function login(url, device, { username, password }) {
  const path = "/api/v1/user/login";
  const body = JSON.stringify({ username, password });
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: await device.headers({ method: "POST", path, body }),
    body
  });
}

async function signedAuthed(device, token, { path, body }) {
  const bodyText = JSON.stringify(body);
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  return { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body: bodyText };
}

const ADMIN_PERMISSIONS = ["user.mgmt", "role.mgmt", "device.mgmt"];

test("create -> forced login -> blocked management action -> change password -> old token dead -> fresh login -> unblocked", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const adminPassword = "Integration-Test-Admin-1!";
  const initialPassword = "Initial-Temp-Password-1";
  const newPassword = "Brand-New-Password-99";

  const limitedRole = await (async () => {
    const nowMs = Date.now();
    const roleName = `it-role-${randomUUID().slice(0, 8)}`;
    const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [
      roleName,
      nowMs
    ]);
    const roleId = roleResult.insertId;
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = 'user.mgmt'");
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [
      roleId,
      permission.id
    ]);
    return {
      roleId,
      async cleanup() {
        await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
        await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
      }
    };
  })();

  const admin = await seedUser(db, {
    username: `it-admin-${randomUUID().slice(0, 8)}`,
    password: adminPassword,
    roleId: await systemAdminRoleId(db)
  });
  const adminDevice = await createTestDevice();
  await seedApprovedDevice(db, { userId: admin.userId, device: adminDevice });

  let newUserId = null;
  let newUserDevice = null;

  t.after(async () => {
    if (newUserId !== null) {
      await cleanupUser(db, newUserId);
    }
    await cleanupUser(db, admin.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const adminToken = await issueToken(admin.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: adminDevice.deviceId
  });

  // --- 管理員建帳號：真的打 POST /users/create，不是直接種資料庫 ----------------
  // 新帳號一開始就配上 user.mgmt，這樣「改完密碼之後打得通 /api/v1/users」
  // 這一步驗的才是 mcp 解除了，不是被權限不足擋住而巧合地回同一個 403。
  const createPath = "/api/v1/users/create";
  const newUsername = `it-newhire-${randomUUID().slice(0, 8)}`;
  const createResponse = await fetch(
    `${url}${createPath}`,
    await signedAuthed(adminDevice, adminToken, {
      path: createPath,
      body: {
        username: newUsername,
        displayName: "New Hire",
        newUserPassword: initialPassword,
        roleIds: [limitedRole.roleId],
        password: adminPassword
      }
    })
  );
  const createBody = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  assert.equal(createBody.data.mustChangePassword, true);
  newUserId = createBody.data.id;

  // 設備要等帳號真的存在之後才能種——user_devices 對 user_id 有外鍵。
  newUserDevice = await createTestDevice();
  await seedApprovedDevice(db, { userId: newUserId, device: newUserDevice });

  // --- 新帳號用臨時密碼登入，拿到的 token 必須帶著 mcp ------------------------
  const loginResponse = await login(url, newUserDevice, {
    username: newUsername,
    password: initialPassword
  });
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200, JSON.stringify(loginBody));
  assert.equal(loginBody.data.user.mustChangePassword, true);
  const oldToken = loginBody.data.token;

  // --- 帶著 mcp 的 token 打管理端點：403 PASSWORD_CHANGE_REQUIRED，不是權限不足 ---
  const blocked = await fetch(`${url}/api/v1/users`, {
    headers: { Authorization: `Bearer ${oldToken}` }
  });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, "PASSWORD_CHANGE_REQUIRED");

  // --- /me 在豁免清單上，即使還沒改密碼也打得通 --------------------------------
  const me = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${oldToken}` }
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.mustChangePassword, true);

  // --- 改密碼：password/change 也在豁免清單上 --------------------------------
  const changePath = "/api/v1/user/password/change";
  const changeResponse = await fetch(
    `${url}${changePath}`,
    await signedAuthed(newUserDevice, oldToken, {
      path: changePath,
      body: { password: initialPassword, newPassword }
    })
  );
  const changeBody = await changeResponse.json();
  assert.equal(changeResponse.status, 200, JSON.stringify(changeBody));
  assert.equal(changeBody.data.changed, true);

  // --- 舊 token 立刻失效：改密碼撤銷了自己所有的 token ------------------------
  const afterChange = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${oldToken}` }
  });
  assert.equal(afterChange.status, 401, "the old token must be revoked after changing password");

  // --- 用新密碼重新登入：這次拿到的 token 不該帶 mcp ---------------------------
  const reloginResponse = await login(url, newUserDevice, {
    username: newUsername,
    password: newPassword
  });
  const reloginBody = await reloginResponse.json();
  assert.equal(reloginResponse.status, 200, JSON.stringify(reloginBody));
  assert.equal(reloginBody.data.user.mustChangePassword, false);
  const newToken = reloginBody.data.token;

  // --- 這次打得通：mcp 解除了，而且權限本來就夠 --------------------------------
  const unblocked = await fetch(`${url}/api/v1/users`, {
    headers: { Authorization: `Bearer ${newToken}` }
  });
  assert.equal(unblocked.status, 200, await unblocked.text());

  // --- 資料庫現況：臨時密碼死線清掉了 -----------------------------------------
  const [[stored]] = await db.query(
    "SELECT must_change_password, temporary_password_expires_at FROM users WHERE id = ?",
    [newUserId]
  );
  assert.equal(Number(stored.must_change_password), 0);
  assert.equal(stored.temporary_password_expires_at, null);

  const [[audit]] = await db.query(
    "SELECT action FROM user_audit_logs WHERE target_id = ? AND action = 'user.password.change'",
    [newUserId]
  );
  assert.ok(audit, "self password change must be audited");
});

test("self-changing to a password with outer whitespace: only the trimmed value logs in (DEF-004)", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const initialPassword = "Integration-Test-Pass-10!";
  // 頭尾各一個空白，中間合法字元——PWD-002/DEF-004 的原始 repro。
  const paddedNewPassword = "  Padded-New-Password-1  ";
  const trimmedNewPassword = "Padded-New-Password-1";

  const user = await seedUser(db, {
    username: `it-trim-pwd-${randomUUID().slice(0, 8)}`,
    password: initialPassword
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: user.userId, device });

  t.after(async () => {
    await cleanupUser(db, user.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const loginResponse = await login(url, device, { username: user.username, password: initialPassword });
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200, JSON.stringify(loginBody));
  const token = loginBody.data.token;

  const changePath = "/api/v1/user/password/change";
  const changeResponse = await fetch(
    `${url}${changePath}`,
    await signedAuthed(device, token, {
      path: changePath,
      body: { password: initialPassword, newPassword: paddedNewPassword }
    })
  );
  const changeBody = await changeResponse.json();
  assert.equal(changeResponse.status, 200, JSON.stringify(changeBody));

  // 規格要求的行為：驗證強度時用嘅 trim 後嘅值，同實際存落去 hash 嘅一定要
  // 係同一個值。trim 後嘅密碼登入必須成功。
  const trimmedLogin = await login(url, device, { username: user.username, password: trimmedNewPassword });
  assert.equal(trimmedLogin.status, 200, await trimmedLogin.text());

  // 帶住原本頭尾空白嗰個字串登入必須失敗——存落去嘅 hash 是 trim 後嘅值，
  // 不是呼叫端傳入嗰個未 trim 原始字串（DEF-004 修好前，這裡反過來先會過）。
  const paddedLogin = await login(url, device, { username: user.username, password: paddedNewPassword });
  assert.equal(paddedLogin.status, 401, "the untrimmed password must no longer match the stored hash");
});

test("an unsigned request to an escalation endpoint is refused before it does anything", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Admin-2!";

  const actor = await seedUser(db, {
    username: `it-admin-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  // did 對得上，但這次請求完全不帶 X-Device-* header——連「簽章錯」都算不上，
  // 是根本沒有簽章可驗。
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  const response = await fetch(`${url}/api/v1/users/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `it-shouldnotexist-${randomUUID().slice(0, 8)}`,
      displayName: "",
      newUserPassword: "Some-Valid-Password-1",
      roleIds: [],
      password
    })
  });

  assert.notEqual(response.status, 200);
  assert.notEqual(response.status, 201);

  const [[count]] = await db.query(
    "SELECT COUNT(*) AS c FROM users WHERE username LIKE 'it-shouldnotexist-%'"
  );
  assert.equal(count.c, 0, "no user must have been created without a device signature");
});

test("a replayed device signature nonce is refused on its second use", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Admin-3!";

  const actor = await seedUser(db, {
    username: `it-admin-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });
  let createdUserId = null;

  t.after(async () => {
    if (createdUserId !== null) {
      await cleanupUser(db, createdUserId);
    }
    await cleanupUser(db, actor.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  const path = "/api/v1/users/create";
  const body = {
    username: `it-replay-${randomUUID().slice(0, 8)}`,
    displayName: "",
    newUserPassword: "Some-Valid-Password-1",
    roleIds: [],
    password
  };
  const bodyText = JSON.stringify(body);
  // 手動組一次 headers，兩個請求刻意重用同一組（同一個 nonce）。
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  const requestInit = {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: bodyText
  };

  const first = await fetch(`${url}${path}`, requestInit);
  const firstBody = await first.json();
  assert.equal(first.status, 201, JSON.stringify(firstBody));
  createdUserId = firstBody.data.id;

  // 同一組簽章（同一個 nonce）再送一次——伺服器必須認得這是重放，不是把它當
  // 成第二次合法的建立用戶請求。
  const replay = await fetch(`${url}${path}`, requestInit);
  assert.notEqual(replay.status, 201, "a replayed nonce must not be accepted as a fresh request");

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE username = ?", [
    body.username
  ]);
  assert.equal(count.c, 1, "the replay must not have created a second user");
});

test("logging in with an expired temporary password returns TEMPORARY_PASSWORD_EXPIRED", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const password = "Expired-Temp-Password-1";

  const user = await seedUser(db, {
    username: `it-expired-${randomUUID().slice(0, 8)}`,
    password,
    mustChangePassword: true,
    // 過了 72 小時死線——直接種一個過去的時間戳，不必真的等 72 小時。
    temporaryPasswordExpiresAt: Date.now() - 1000
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: user.userId, device });

  t.after(async () => {
    await cleanupUser(db, user.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const response = await login(url, device, { username: user.username, password });
  const body = await response.json();

  assert.equal(response.status, 401, JSON.stringify(body));
  assert.equal(body.error.code, "TEMPORARY_PASSWORD_EXPIRED");
});
