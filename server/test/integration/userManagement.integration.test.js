/**
 * Phase 2 的用戶管理端點，對一個真的、已經 migrate 過的 MySQL 驗收。設計說明
 * 見 docs/user_management/design_spec.md §3、§7 Phase 2 的驗收條件。
 *
 * Token 用 jwt service 直接簽發，不走完整的登入＋設備綁定流程——那條路已經由
 * authFlow.integration.test.js 證明過，這裡要驗的是用戶管理端點本身，簽章與
 * nonce 不是這個檔案的責任。`jwt-password` 端點仍然要求真的密碼，所以帳號一律
 * 用真的雜湊種進去。
 *
 * Phase 4 把 create／roles-assign／password-reset 升級成 jwt-device-password
 * 之後，這幾支也需要一台「已核准」的設備：直接把 user_devices 種成 approved
 * 狀態，跳過完整的申請／審批流程——那條路已經由 authFlow 的測試證明過，這裡
 * 只是要一台能簽出合法簽章的設備。
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

/** 種一個使用者，掛在一個既有的角色 id 上（呼叫端負責這個角色本來就存在）。 */
async function seedUser(db, { username, password, roleId }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();

  const [userResult] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
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

/** 建一個只有指定權限的測試角色，回傳 { roleId, cleanup() }。 */
async function seedRole(db, { permissionNames }) {
  const nowMs = Date.now();
  const roleName = `it-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [
    roleName,
    nowMs
  ]);
  const roleId = roleResult.insertId;

  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roleId, permission.id]
    );
  }

  return {
    roleId,
    async cleanup() {
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

async function systemAdminRoleId(db) {
  const [[row]] = await db.query("SELECT id FROM roles WHERE name = 'system-admin'");
  return row.id;
}

/**
 * 直接把一台設備種成 approved，略過申請／審批流程。user_devices 對 user_id
 * 設了 ON DELETE CASCADE（見 0004_add_device_binding_tables.js），所以既有的
 * cleanupUser() 刪掉 users 那一列時會連帶清掉，這裡不需要另外清理。
 */
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

// system-admin 現在持有 5 個權限（0010 migration 之後多咗 item.view／
// item.mgmt）；claims 要同資料庫現況一致，否則會撞 PERMISSION_STALE 而唔係
// 測試本身想驗嘅嘢——同 itemCatalog.integration.test.js 嗰份同一個理由。
const ADMIN_PERMISSIONS = ["user.mgmt", "role.mgmt", "device.mgmt", "item.view", "item.mgmt"];

function authed(token, body) {
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

/** 給 jwt-device-password 端點用：Authorization + 設備簽章 header 都要帶。 */
async function signedAuthed(device, token, { path, body }) {
  const bodyText = JSON.stringify(body);
  const headers = await device.headers({ method: "POST", path, body: bodyText, token });
  return { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body: bodyText };
}

test("create, list, get, update, assign roles, disable and enable walk through with one audit row each", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-1!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  // 兩個目標各自的 id 要等到 create 那一步才知道，先宣告一個給單一
  // t.after 用的容器——多個 t.after 各自獨立註冊時執行順序係反向（後註冊先
  // 執行），合併成一個 hook、寫死清理順序，比依賴那個順序保險（見
  // authFlow.integration.test.js 同一個問題的說明）。
  let createdUserId = null;
  let staffRoleCleanup = null;

  t.after(async () => {
    if (createdUserId !== null) {
      await cleanupUser(db, createdUserId);
    }
    if (staffRoleCleanup !== null) {
      await staffRoleCleanup();
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

  // --- create（jwt-device-password） -----------------------------------------
  const targetUsername = `it-target-${randomUUID().slice(0, 8)}`;
  const createResponse = await fetch(
    `${url}/api/v1/users/create`,
    await signedAuthed(device, token, {
      path: "/api/v1/users/create",
      body: {
        username: targetUsername,
        displayName: "Target User",
        newUserPassword: "Initial-Password-99",
        roleIds: [],
        password
      }
    })
  );
  const createBody = await createResponse.json();
  assert.equal(createResponse.status, 201, JSON.stringify(createBody));
  const created = createBody.data;
  assert.equal(created.username, targetUsername);
  assert.equal(created.mustChangePassword, true);
  createdUserId = created.id;

  const [[storedTarget]] = await db.query(
    "SELECT temporary_password_expires_at, created_at FROM users WHERE id = ?",
    [created.id]
  );
  assert.ok(
    Number(storedTarget.temporary_password_expires_at) > Number(storedTarget.created_at),
    "temporary_password_expires_at must be in the future relative to creation"
  );

  // --- list -------------------------------------------------------------
  const listResponse = await fetch(
    `${url}/api/v1/users?q=${encodeURIComponent(targetUsername)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(listResponse.status, 200);
  const listBody = (await listResponse.json()).data;
  assert.equal(listBody.total, 1);
  assert.equal(listBody.items[0].username, targetUsername);

  // --- get ----------------------------------------------------------------
  const getResponse = await fetch(`${url}/api/v1/users/${created.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(getResponse.status, 200);
  assert.deepEqual((await getResponse.json()).data.roles, []);

  // --- update ---------------------------------------------------------------
  const updateResponse = await fetch(
    `${url}/api/v1/users/${created.id}/update`,
    authed(token, { displayName: "Renamed User" })
  );
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).data.displayName, "Renamed User");

  // --- assign roles (compare-and-set) ----------------------------------------
  const staffRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const staffRoleId = staffRole.roleId;
  staffRoleCleanup = staffRole.cleanup;

  const assignPath = `/api/v1/users/${created.id}/roles/assign`;
  const staleAssign = await fetch(
    `${url}${assignPath}`,
    await signedAuthed(device, token, {
      path: assignPath,
      body: {
        roleIds: [staffRoleId],
        expectedRoleIds: [999999], // 假裝畫面上看到的不是實際現況
        reason: "指派到客服團隊",
        password
      }
    })
  );
  assert.equal(staleAssign.status, 409);
  assert.equal((await staleAssign.json()).error.code, "ASSIGNMENT_STALE");

  const assignResponse = await fetch(
    `${url}${assignPath}`,
    await signedAuthed(device, token, {
      path: assignPath,
      body: {
        roleIds: [staffRoleId],
        expectedRoleIds: [], // 剛建立時是空的，這才是真正的現況
        reason: "指派到客服團隊",
        password
      }
    })
  );
  const assignBody = await assignResponse.json();
  assert.equal(assignResponse.status, 200, JSON.stringify(assignBody));

  // --- disable：撤銷先發生，舊 token 立刻打不動任何管理端點 --------------------
  const oldTargetToken = await issueToken(created.id, {
    roles: [],
    permissions: ["user.mgmt"] // 這串本身跟現況（[]）就對不上，但這裡要驗的是撤銷
  });
  const beforeDisable = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${oldTargetToken}` }
  });
  assert.equal(beforeDisable.status, 200, "sanity check: the token must work before disable");

  const disableResponse = await fetch(
    `${url}/api/v1/users/${created.id}/disable`,
    authed(token, { reason: "整合測試：停用流程", password })
  );
  const disableBody = await disableResponse.json();
  assert.equal(disableResponse.status, 200, JSON.stringify(disableBody));
  assert.equal(disableBody.data.status, "disabled");

  const afterDisable = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${oldTargetToken}` }
  });
  assert.equal(afterDisable.status, 401, "the disabled user's old token must stop working");

  // --- enable -----------------------------------------------------------
  const enableResponse = await fetch(
    `${url}/api/v1/users/${created.id}/enable`,
    authed(token, { reason: "整合測試：恢復存取", password })
  );
  const enableBody = await enableResponse.json();
  assert.equal(enableResponse.status, 200, JSON.stringify(enableBody));
  assert.equal(enableBody.data.status, "active");

  // --- 稽核：每一次真正的改動各一列，reason 有值；staleAssign 那次沒有留下任何列 ---
  const [auditRows] = await db.query(
    "SELECT action, reason FROM user_audit_logs WHERE target_id = ? ORDER BY id",
    [created.id]
  );
  const actions = auditRows.map((row) => row.action);
  assert.deepEqual(actions, ["user.create", "user.update", "user.roles", "user.disable", "user.enable"]);
  for (const row of auditRows.filter((r) => ["user.disable", "user.enable", "user.roles"].includes(r.action))) {
    assert.ok(row.reason.length > 0, `${row.action} must have a non-empty reason`);
  }
});

test("an actor holding only user.mgmt cannot grant themselves system-admin", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-2!";

  const limitedRole = await seedRole(db, { permissionNames: ["user.mgmt"] });
  const actor = await seedUser(db, {
    username: `it-limited-${randomUUID().slice(0, 8)}`,
    password,
    roleId: limitedRole.roleId
  });
  const adminRoleId = await systemAdminRoleId(db);
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await limitedRole.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  // claims.roles 必須跟資料庫現況吻合（否則會先撞 PERMISSION_STALE，測不到
  // 真正要測的 PERMISSION_ESCALATION_DENIED），所以直接查角色名稱來組 claims。
  const [[roleRow]] = await db.query("SELECT name FROM roles WHERE id = ?", [limitedRole.roleId]);
  const token = await issueToken(actor.userId, {
    roles: [roleRow.name],
    permissions: ["user.mgmt"],
    did: device.deviceId
  });

  const escalatePath = `/api/v1/users/${actor.userId}/roles/assign`;
  const escalate = await fetch(
    `${url}${escalatePath}`,
    await signedAuthed(device, token, {
      path: escalatePath,
      body: {
        roleIds: [adminRoleId],
        expectedRoleIds: [limitedRole.roleId],
        reason: "試圖自我提權",
        password
      }
    })
  );

  assert.equal(escalate.status, 403);
  assert.equal((await escalate.json()).error.code, "PERMISSION_ESCALATION_DENIED");

  const [[actorAfter]] = await db.query(
    "SELECT 1 AS held FROM user_roles WHERE user_id = ? AND role_id = ?",
    [actor.userId, adminRoleId]
  );
  assert.equal(actorAfter, undefined, "the escalation must not have taken effect");
});

test("a stale actor permission set is rejected before anything else runs", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-3!";

  const actor = await seedUser(db, {
    username: `it-stale-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  // Claims 宣稱只有 user.mgmt，但資料庫裡這個帳號其實是 system-admin（三個
  // 權限）——模擬「token 簽發之後，操作者的權限被改過」。
  const staleToken = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ["user.mgmt"]
  });

  const response = await fetch(`${url}/api/v1/users`, {
    headers: { Authorization: `Bearer ${staleToken}` }
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "PERMISSION_STALE");
});

test("creating a user whose name is already taken returns 409 without a stray audit row", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-4!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const existing = await seedUser(db, {
    username: `it-taken-${randomUUID().slice(0, 8)}`,
    password
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await cleanupUser(db, existing.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  const [beforeCount] = await db.query(
    "SELECT COUNT(*) AS c FROM user_audit_logs WHERE actor_user_id = ?",
    [actor.userId]
  );

  const response = await fetch(
    `${url}/api/v1/users/create`,
    await signedAuthed(device, token, {
      path: "/api/v1/users/create",
      body: {
        username: existing.username,
        displayName: "",
        newUserPassword: "Some-Valid-Password-1",
        roleIds: [],
        password
      }
    })
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "USERNAME_TAKEN");

  const [afterCount] = await db.query(
    "SELECT COUNT(*) AS c FROM user_audit_logs WHERE actor_user_id = ?",
    [actor.userId]
  );
  assert.equal(afterCount[0].c, beforeCount[0].c, "a failed create must not leave an audit row");
});

test("creating a user trims outer whitespace from username before it is stored", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-8!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const device = await createTestDevice();
  await seedApprovedDevice(db, { userId: actor.userId, device });

  const trimmedUsername = `it-trim-${randomUUID().slice(0, 8)}`;
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

  const response = await fetch(
    `${url}/api/v1/users/create`,
    await signedAuthed(device, token, {
      path: "/api/v1/users/create",
      body: {
        // 頭尾各一個空白，中間是合法字元——DEF-001：pattern 之前一定要先 trim。
        username: `  ${trimmedUsername}  `,
        displayName: "",
        newUserPassword: "Some-Valid-Password-1",
        roleIds: [],
        password
      }
    })
  );
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.username, trimmedUsername);
  createdUserId = body.data.id;

  const [[row]] = await db.query("SELECT username FROM users WHERE id = ?", [createdUserId]);
  assert.equal(row.username, trimmedUsername, "the stored username must be the trimmed value");
});

test("user.update audit row records the request's X-Request-Id and client IP", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-9!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
    password,
    roleId: await systemAdminRoleId(db)
  });
  const target = await seedUser(db, {
    username: `it-target-${randomUUID().slice(0, 8)}`,
    password
  });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await cleanupUser(db, target.userId);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS
  });

  const requestId = `it-req-${randomUUID()}`;
  const request = authed(token, { displayName: "Updated by DEF-002 regression test" });
  request.headers["X-Request-Id"] = requestId;

  const response = await fetch(`${url}/api/v1/users/${target.userId}/update`, request);
  assert.equal(response.status, 200);

  const [[auditRow]] = await db.query(
    `SELECT request_id, ip FROM user_audit_logs
      WHERE target_id = ? AND target_type = 'user' AND action = 'user.update'
      ORDER BY id DESC LIMIT 1`,
    [target.userId]
  );
  assert.equal(auditRow.request_id, requestId);
  assert.ok(auditRow.ip, "audit row must record a non-empty client IP");
});

test("only one of two concurrent requests can disable the last two active admins", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-5!";
  const roleId = await systemAdminRoleId(db);

  // 中和環境裡既有的 system-admin 持有者，讓這個測試能真正掌控「現在系統裡有
  // 幾個 active admin」——不這樣做的話，這條斷言在一台已經跑過
  // scripts/createUser.js 的資料庫上永遠不會觸發保護（一定還有別人）。
  // 這是這個測試唯一會動到別人資料的一步，t.after 會原封不動地復原。
  const [ambientAdmins] = await db.query(
    `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.role_id = ? AND u.status = 'active'`,
    [roleId]
  );
  if (ambientAdmins.length > 0) {
    const placeholders = ambientAdmins.map(() => "?").join(",");
    await db.execute(
      `UPDATE users SET status = 'disabled' WHERE id IN (${placeholders})`,
      ambientAdmins.map((row) => row.id)
    );
  }

  const adminA = await seedUser(db, { username: `it-lastA-${randomUUID().slice(0, 8)}`, password, roleId });
  const adminB = await seedUser(db, { username: `it-lastB-${randomUUID().slice(0, 8)}`, password, roleId });

  t.after(async () => {
    await cleanupUser(db, adminA.userId);
    await cleanupUser(db, adminB.userId);
    if (ambientAdmins.length > 0) {
      const placeholders = ambientAdmins.map(() => "?").join(",");
      await db.execute(
        `UPDATE users SET status = 'active' WHERE id IN (${placeholders})`,
        ambientAdmins.map((row) => row.id)
      );
    }
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const tokenA = await issueToken(adminA.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS
  });
  const tokenB = await issueToken(adminB.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS
  });

  const disable = (targetId, token) =>
    fetch(
      `${url}/api/v1/users/${targetId}/disable`,
      authed(token, { reason: "並行停用測試", password })
    );

  // A 停用 B，B 同時停用 A——不管誰先誰後，最終一定要剩剛好一個 active admin。
  const [responseA, responseB] = await Promise.all([
    disable(adminB.userId, tokenA),
    disable(adminA.userId, tokenB)
  ]);

  const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);
  const outcomes = [
    { status: responseA.status, code: bodyA?.error?.code },
    { status: responseB.status, code: bodyB?.error?.code }
  ];
  const successes = outcomes.filter((outcome) => outcome.status === 200);
  const losers = outcomes.filter((outcome) => outcome.status !== 200);

  assert.equal(successes.length, 1, `expected exactly one success, got ${JSON.stringify(outcomes)}`);
  assert.equal(losers.length, 1, `expected exactly one loser, got ${JSON.stringify(outcomes)}`);

  // 輸的那一邊有兩種同樣安全的結局，看它輸掉的是哪一道檢查：
  //   - 409 LAST_ADMIN_PROTECTED：兩邊都還在跑的時候先讀到「保護中」，
  //     assertLastActiveAdminPreserved 擋下。
  //   - 403 PERMISSION_STALE：贏的那邊先把輸的那邊的帳號設成 disabled，
  //     輸的那邊自己的 assertActorFresh 重讀角色時查不到這個 active 帳號
  //     （directoryLookups.js #assertActorFresh 把「查不到」當空集合處理），
  //     跟 claims 對不上，被第四道守衛擋下——這不是漏洞，是它正確地把一個
  //     剛被停用的操作者當場擋下來，跟平常帳號被停用後 token 立刻失效是
  //     同一件事，只是這裡是資料庫查詢先注意到，不是簽章。
  // 兩者都保證了下面 activeCount === 1 這件事，這才是這個測試真正要證明的。
  const loser = losers[0];
  assert.ok(
    (loser.status === 409 && loser.code === "LAST_ADMIN_PROTECTED") ||
      (loser.status === 403 && loser.code === "PERMISSION_STALE"),
    `expected the losing request to be LAST_ADMIN_PROTECTED (409) or PERMISSION_STALE (403), got ${JSON.stringify(loser)}`
  );

  const [[refreshedA]] = await db.query("SELECT status FROM users WHERE id = ?", [adminA.userId]);
  const [[refreshedB]] = await db.query("SELECT status FROM users WHERE id = ?", [adminB.userId]);
  const activeCount = [refreshedA.status, refreshedB.status].filter((s) => s === "active").length;
  assert.equal(activeCount, 1, "exactly one of the two admins must remain active");
});

test("creating a user without an initial password is rejected by schema validation, not the password policy", { skip }, async (t) => {
  // 這條釘住一個實作時真的犯過的錯：newUserPassword 沒有放進 requestSchema 的
  // required 清單，於是漏了它的請求會通過驗證，一路跑到 passwordPolicy.js 才
  // 用一句誤導的「需要包含大寫字母」擋下來——而不是一句乾脆的「缺少必要欄位」。
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const password = "Integration-Test-Pass-6!";

  const actor = await seedUser(db, {
    username: `it-actor-${randomUUID().slice(0, 8)}`,
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
  const token = await issueToken(actor.userId, {
    roles: ["system-admin"],
    permissions: ADMIN_PERMISSIONS,
    did: device.deviceId
  });

  // 這裡一定要帶合法的設備簽章：認證排在 schema 驗證之前，沒有它這個請求會先
  // 被擋在認證層，測不到這裡真正要測的東西。
  const response = await fetch(
    `${url}/api/v1/users/create`,
    await signedAuthed(device, token, {
      path: "/api/v1/users/create",
      body: {
        username: `it-nopass-${randomUUID().slice(0, 8)}`,
        displayName: "",
        roleIds: [],
        password
      }
    })
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "REQUEST_VALIDATION_FAILED");
});
