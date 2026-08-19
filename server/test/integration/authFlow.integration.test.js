/**
 * 打真資料庫嘅整合測試。
 *
 * 單元測試（test/userService.test.js、test/authHandlers.test.js）全部用假 pool
 * ——比對嘅係「SQL 字串有冇包含 `FROM roles r`」，唔會真係執行嗰句 SQL。表名、
 * 欄名、join 條件打錯字，假 pool 一樣通過。呢個檔案補嗰個缺口：起一個真嘅
 * application、接真 MySQL、行真 HTTP 請求，等 UserService 入面嘅 join、
 * tokenRevocation 嘅版本號比對、jwt 簽發驗證全部真係跑一次。
 *
 * 預設唔跑：冇 MySQL 嘅環境（例如未跑 `npm run migrate` 嘅新 clone）唔應該令
 * `npm test` 失敗。CI 已經起咗 MySQL service 並套用 migration，會設
 * DB_INTEGRATION_TESTS=1 令呢個檔案真係執行；本機要試就照 README 起本機 MySQL
 * 再自己設呢個環境變數。冇設嗰陣係 skip 而唔係靜默通過——node:test 嘅 skip
 * 會喺報告入面列出嚟，唔會當冇發生過。
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
  const application = await createApplication({
    configurationSource: {
      ...source,
      // port: 0 拿一個隨機空 port，避免同其他跑緊嘅實例撞。
      application: { ...source.application, port: 0 }
    }
  });

  return application;
}

/**
 * 建一個帳號，附一個角色同一個權限。回傳嘅 id 供測試結束後清理，同埋
 * subject（token 撤銷用嘅 key，UserService 內部一律轉成字串）。
 */
async function seedUser(db, { username, password }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const roleName = `it-role-${suffix}`;
  const permissionName = `it-permission-${suffix}`;

  const [userResult] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  const userId = userResult.insertId;

  const [roleResult] = await db.execute(
    "INSERT INTO roles (name, created_at) VALUES (?, ?)",
    [roleName, nowMs]
  );
  const [permissionResult] = await db.execute(
    "INSERT INTO permissions (name, created_at) VALUES (?, ?)",
    [permissionName, nowMs]
  );
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
    userId,
    roleResult.insertId
  ]);
  await db.execute(
    "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
    [roleResult.insertId, permissionResult.insertId]
  );

  return {
    userId,
    roleId: roleResult.insertId,
    permissionId: permissionResult.insertId,
    roleName,
    permissionName
  };
}

async function cleanupUser(db, seeded) {
  // 順序由子到父，配合外鍵約束（user_roles/role_permissions 先於 users/roles/
  // permissions；見 migrations/0003_add_auth_tables.js 的 ON DELETE CASCADE——
  // 這裡不依賴它，手動清乾淨，讓測試資料的生命週期不悄悄綁死在某條 FK 行為上）。
  await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [seeded.roleId]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [seeded.userId]);
  await db.execute("DELETE FROM permissions WHERE id = ?", [seeded.permissionId]);
  await db.execute("DELETE FROM roles WHERE id = ?", [seeded.roleId]);
  await db.execute("DELETE FROM users WHERE id = ?", [seeded.userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [
    String(seeded.userId)
  ]);
}

test("login, me and logout work end to end against a real database", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const username = `it-login-${randomUUID().slice(0, 8)}`;
  const password = "Integration-Test-Pass-1!";
  const seeded = await seedUser(db, { username, password });

  // 兩個 after hook 各自獨立註冊時執行順序係反向（後註冊先執行），會令
  // shutdown 喺 cleanup 之前將連線池關埋，cleanup 嗰句 DELETE 就會撞
  // "Pool is closed"。合併成一個 hook，寫死順序：先清資料，後關 application。
  t.after(async () => {
    await cleanupUser(db, seeded);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const loginResponse = await fetch(`${url}/api/v1/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.data.user.username, username);
  // 呢兩句先係整合測試嘅重點：UserService 讀 roles/permissions 用嘅係三張表
  // join，假 pool 測試比對嘅係 SQL 字串有冇出現「FROM roles r」呢類片段，表名
  // 或欄名打錯字一樣通過。呢度行緊嘅係真連線、真 schema。
  assert.deepEqual(loginBody.data.user.roles, [seeded.roleName]);
  assert.deepEqual(loginBody.data.user.permissions, [seeded.permissionName]);

  const { token } = loginBody.data;

  const meResponse = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assert.equal(meBody.data.username, username);
  assert.deepEqual(meBody.data.roles, [seeded.roleName]);

  const logoutResponse = await fetch(`${url}/api/v1/user/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}"
  });

  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(await logoutResponse.json().then((body) => body.data), {
    revoked: true
  });

  // 撤銷要即時生效：同一個 token 登出之後應該即刻被拒，唔使等 2 小時過期。
  const afterLogout = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(afterLogout.status, 401);
});

test("five consecutive failed logins lock the account for fifteen minutes", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const username = `it-lockout-${randomUUID().slice(0, 8)}`;
  const password = "Integration-Test-Pass-2!";
  const seeded = await seedUser(db, { username, password });

  t.after(async () => {
    await cleanupUser(db, seeded);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  async function attemptLogin(loginPassword) {
    const response = await fetch(`${url}/api/v1/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: loginPassword })
    });
    return response.status;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await attemptLogin("wrong-password"), 401);
  }

  // 第五次已經觸發鎖定；用返正確密碼都應該仍然被拒。
  assert.equal(await attemptLogin(password), 401);
});
