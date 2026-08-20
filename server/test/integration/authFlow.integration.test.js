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
import { randomUUID, webcrypto } from "node:crypto";
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
  await db.execute("DELETE FROM user_devices WHERE user_id = ?", [seeded.userId]);
  await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [seeded.roleId]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [seeded.userId]);
  await db.execute("DELETE FROM permissions WHERE id = ?", [seeded.permissionId]);
  await db.execute("DELETE FROM roles WHERE id = ?", [seeded.roleId]);
  await db.execute("DELETE FROM users WHERE id = ?", [seeded.userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [
    String(seeded.userId)
  ]);
}

/**
 * 一台模擬嘅設備：真嘅 P-256 金鑰，簽名格式同前端 deviceKey.js 一樣。
 *
 * 用真金鑰而唔係假簽章，係因為呢個檔案要驗嘅正正係接縫：原始 body 有冇被留低、
 * IEEE P1363 有冇被當成 DER、nonce 有冇真係寫到入表。呢啲喺假 pool 上全部測唔到。
 */
async function createTestDevice() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
  const digest = await webcrypto.subtle.digest("SHA-256", spki);
  const deviceId = Buffer.from(digest).toString("hex");

  return {
    deviceId,
    async headers({ method, path, body, includePublicKey = false }) {
      const nonce = randomUUID();
      const timestamp = Date.now();
      const bodyHash =
        body === undefined
          ? ""
          : Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(body))).toString(
              "base64url"
            );
      // 鍵照字典序——同 DeviceBindingService.signingInput() 逐字元一樣。
      const signingInput = JSON.stringify({
        bodyHash,
        deviceId,
        method: method.toUpperCase(),
        nonce,
        path,
        timestamp
      });
      const signature = await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.privateKey,
        Buffer.from(signingInput)
      );

      const headers = {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        "X-Device-Timestamp": String(timestamp),
        "X-Device-Nonce": nonce,
        "X-Device-Signature": Buffer.from(signature).toString("base64url")
      };

      if (includePublicKey) {
        headers["X-Device-Public-Key"] = Buffer.from(spki).toString("base64url");
      }

      return headers;
    }
  };
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
  const device = await createTestDevice();
  const path = "/api/v1/user/login";
  const body = JSON.stringify({ username, password, deviceLabel: "Integration device" });

  const login = async ({ includePublicKey = false } = {}) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: await device.headers({ method: "POST", path, body, includePublicKey }),
      body
    });

  // 第一次登入：密碼啱，但設備未綁定。呢一步同時驗到原始 body 有冇被留低——
  // 冇嘅話 bodyHash 對唔上，收到嘅會係簽章無效而唔係待審批。
  const pending = await login({ includePublicKey: true });
  const pendingBody = await pending.json();

  assert.equal(pending.status, 403);
  assert.equal(pendingBody.error.code, "DEVICE_PENDING_APPROVAL");

  const [bindings] = await db.query(
    "SELECT id, status, label FROM user_devices WHERE user_id = ?",
    [seeded.userId]
  );
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].status, "pending");
  assert.equal(bindings[0].label, "Integration device");

  // 核准之後再登入一次。reviewed_at 一定要寫，否則清理規則二永遠掃唔到佢。
  await db.execute(
    "UPDATE user_devices SET status = 'approved', reviewed_at = ? WHERE id = ?",
    [Date.now(), bindings[0].id]
  );

  const loginResponse = await login();
  const loginBody = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.data.user.username, username);
  // 前端靠呢個數字算到期時刻；漏咗嘅話 watchdog 會當成即刻過期而登出。
  assert.equal(typeof loginBody.data.expiresInSeconds, "number");
  // 呢兩句先係整合測試嘅重點：UserService 讀 roles/permissions 用嘅係三張表
  // join，假 pool 測試比對嘅係 SQL 字串有冇出現「FROM roles r」呢類片段，表名
  // 或欄名打錯字一樣通過。呢度行緊嘅係真連線、真 schema。
  assert.deepEqual(loginBody.data.user.roles, [seeded.roleName]);
  assert.deepEqual(loginBody.data.user.permissions, [seeded.permissionName]);

  const { token } = loginBody.data;

  // did 少咗嘅話，續期（階段 3）就無從判斷請求係咪嚟自簽發佢嗰台設備。
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(claims.did, device.deviceId);

  const meResponse = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const meBody = await meResponse.json();

  assert.equal(meResponse.status, 200);
  assert.equal(meBody.data.username, username);
  assert.deepEqual(meBody.data.roles, [seeded.roleName]);

  // 續期：真嘅設備簽名 + 真嘅 JWT 換一個新 token 出嚟。
  const refreshPath = "/api/v1/user/token/refresh";
  const refresh = async (bearer) =>
    fetch(`${url}${refreshPath}`, {
      method: "POST",
      headers: {
        ...(await device.headers({ method: "POST", path: refreshPath })),
        Authorization: `Bearer ${bearer}`
      }
    });

  const refreshed = await refresh(token);
  const refreshedBody = await refreshed.json();

  assert.equal(refreshed.status, 200);
  assert.equal(typeof refreshedBody.data.expiresInSeconds, "number");
  assert.deepEqual(refreshedBody.data.user.roles, [seeded.roleName]);

  const refreshedToken = refreshedBody.data.token;
  const refreshedClaims = JSON.parse(
    Buffer.from(refreshedToken.split(".")[1], "base64url").toString()
  );
  assert.equal(refreshedClaims.did, device.deviceId);

  // 新 token 要真係用得——續期簽出一個驗唔過嘅 token，症狀係下一個請求 401，
  // 而前端會當成「已被撤銷」直接登出。
  const meAfterRefresh = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${refreshedToken}` }
  });
  assert.equal(meAfterRefresh.status, 200);

  // 另一台設備攞住同一個 token 都續唔到期。冇呢一層嘅話，任何一台已審批嘅設備
  // 都可以幫任何一個 token 續期——包括用自己嘅金鑰去續一個偷返嚟嘅 token。
  const otherDevice = await createTestDevice();
  const fromOtherDevice = await fetch(`${url}${refreshPath}`, {
    method: "POST",
    headers: {
      ...(await otherDevice.headers({ method: "POST", path: refreshPath })),
      Authorization: `Bearer ${refreshedToken}`
    }
  });
  assert.equal(fromOtherDevice.status, 403);
  assert.equal((await fromOtherDevice.json()).error.code, "DEVICE_MISMATCH");

  const logoutResponse = await fetch(`${url}/api/v1/user/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${refreshedToken}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(await logoutResponse.json().then((body) => body.data), {
    revoked: true
  });

  // 撤銷要即時生效：同一個 token 登出之後應該即刻被拒，唔使等佢自己過期。
  const afterLogout = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${refreshedToken}` }
  });

  assert.equal(afterLogout.status, 401);

  // 撤銷之後亦都唔可以再續期，否則登出就等於冇登出過。
  const refreshAfterLogout = await refresh(refreshedToken);
  assert.equal(refreshAfterLogout.status, 401);
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

test("concurrent failed logins are all counted, not lost to a race", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const username = `it-race-${randomUUID().slice(0, 8)}`;
  const password = "Integration-Test-Pass-3!";
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

  // 只送 4 次（鎖定門檻是 5 次），確保鎖定不會被觸發：這樣每個並行請求在
  // authenticate() 讀到的 locked_until 都是 null，一定會走到
  // #recordFailedAttempt()，這條測試才只量到「計數本身準不準」，不會被「鎖定
  // 判斷跟遞增之間也有先後之分」這個另一個、預期中的競態混進來干擾。
  //
  // 修復前，#recordFailedAttempt 是「SELECT 讀舊值 -> JS 加一 -> UPDATE 寫回
  // 絕對值」：4 個並行請求各自讀到同一個舊值 0，各自算出 1，最後寫入的那次會
  // 蓋掉前面所有次，資料庫最後只會停在 1。這條測試在假 pool（單元測試）上測不
  // 出來——假 pool 是同步模擬，不會真的交錯；只有打真資料庫、真的並行送出才
  // 會暴露這個競態。
  const CONCURRENT_ATTEMPTS = 4;
  const statuses = await Promise.all(
    Array.from({ length: CONCURRENT_ATTEMPTS }, () => attemptLogin("wrong-password"))
  );

  assert.ok(statuses.every((status) => status === 401));

  const [rows] = await db.query(
    "SELECT failed_login_attempts, locked_until FROM users WHERE id = ?",
    [seeded.userId]
  );

  assert.equal(rows[0].failed_login_attempts, CONCURRENT_ATTEMPTS);
  assert.equal(rows[0].locked_until, null);
});

test("more than twenty login attempts from one client are throttled", { skip }, async (t) => {
  const application = await startApplication();

  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  async function attemptLogin(username) {
    const response = await fetch(`${url}/api/v1/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "wrong-password" })
    });
    return { status: response.status, retryAfter: response.headers.get("retry-after") };
  }

  // 節流門檻是每個 IP 20 次／10 分鐘（見 loginHandler.js 的 LOGIN_IP_LIMIT），
  // 跟帳號本身無關——每次換一個不存在的帳號，確保觸發的一定是 IP 節流，不是
  // 上面兩條測試在驗的帳號鎖定。這條測試要防的是：有人繞過全站的 requestLimiter
  // service（例如它被關掉，或個別部署把配額調鬆），登入端點也不能因此完全沒有
  // 節流——單一帳號被鎖只需要 5 次請求，遠低於任何合理的全站配額。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { status } = await attemptLogin(`it-throttle-${attempt}`);
    assert.equal(status, 401);
  }

  const throttled = await attemptLogin("it-throttle-final");
  assert.equal(throttled.status, 429);
  assert.ok(throttled.retryAfter, "Retry-After header was not set");
});
