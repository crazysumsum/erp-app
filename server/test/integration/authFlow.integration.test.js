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
import { createTestDevice } from "../../test-support/testDevice.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication({ jwt: jwtOverrides } = {}) {
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: {
      ...source,
      // port: 0 拿一個隨機空 port，避免同其他跑緊嘅實例撞。
      application: { ...source.application, port: 0 },
      // 絕對 session 上限預設係 8 小時，測試等唔起。呢個 hook 俾嗰個 case
      // 用一個以秒計嘅上限，行完整條真嘅 HTTP 流程。
      jwt: { ...source.jwt, ...jwtOverrides }
    }
  });

  return application;
}

/**
 * 建一個帳號，附一個角色同一個權限。回傳嘅 id 供測試結束後清理，同埋
 * subject（token 撤銷用嘅 key，UserService 內部一律轉成字串）。
 */
async function seedUser(db, { username, password, permission }) {
  const passwordHash = await hashPassword(password);
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const roleName = `it-role-${suffix}`;
  // 預設給一個不會撞名的權限；要測真正的授權規則時傳一個具體的進來。
  const permissionName = permission ?? `it-permission-${suffix}`;

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
  // device.mgmt 已經由 migration 種入（0004 種、0005 改名），而 permissions.name
  // 是唯一鍵，所以要求那個權限時只能查、不能插。ownsPermission 記著這一筆是不是
  // 這個測試建的——清理時不能把 migration 種的那一列刪掉。
  const [existing] = await db.query("SELECT id FROM permissions WHERE name = ?", [
    permissionName
  ]);
  const ownsPermission = existing.length === 0;
  const permissionId = ownsPermission
    ? (
        await db.execute("INSERT INTO permissions (name, created_at) VALUES (?, ?)", [
          permissionName,
          nowMs
        ])
      )[0].insertId
    : existing[0].id;

  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
    userId,
    roleResult.insertId
  ]);
  await db.execute(
    "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
    [roleResult.insertId, permissionId]
  );

  return {
    userId,
    username,
    roleId: roleResult.insertId,
    permissionId,
    ownsPermission,
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

  // 只刪這個測試自己建的權限。device.mgmt 是 migration 種的，刪掉它會讓
  // system-admin 悄悄失去審批能力——而且下一次跑 migration 不會補回來，因為
  // 它已經被記成套用過了。
  if (seeded.ownsPermission) {
    await db.execute("DELETE FROM permissions WHERE id = ?", [seeded.permissionId]);
  }

  await db.execute("DELETE FROM roles WHERE id = ?", [seeded.roleId]);
  await db.execute("DELETE FROM users WHERE id = ?", [seeded.userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [
    String(seeded.userId)
  ]);
}

// createTestDevice() 搬到 test-support/testDevice.js 了——Phase 4 把用戶／
// 角色管理的四支提權端點升級成 jwt-device-password 之後，需要它的整合測試
// 檔案不只這一個。

/**
 * 改名這件事只有真資料庫證明得了：0004 種的是 device.approve，0005 改成
 * device.mgmt，而中間那一步是不是真的保住了既有的授權，靠讀原始碼看不出來。
 *
 * 這也順便釘住「重跑會收斂」——CI 每次都是全新資料庫從 0001 跑到最後，本機則是
 * 對一個已經套用過的資料庫再跑一次，兩邊都該看到同一個結果。
 */
test("the device permission was renamed without losing its role link", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  t.after(() => application.shutdown("integration_test_complete"));

  const [names] = await db.query(
    "SELECT name FROM permissions WHERE name IN ('device.approve', 'device.mgmt')"
  );
  assert.deepEqual(
    names.map((row) => row.name),
    ["device.mgmt"],
    "舊名應該已經不存在，而且不該兩個名字同時在"
  );

  // 承重的一句：改名走 UPDATE，permission id 沒變，所以 role_permissions 那一列
  // 原封不動。改成「刪掉舊的、插入新的」的話，ON DELETE CASCADE 會把這一列清掉，
  // 而這裡會是 0——也就是沒有人再有辦法審批設備。
  const [links] = await db.query(
    `SELECT 1 FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'system-admin' AND p.name = 'device.mgmt'`
  );
  assert.equal(links.length, 1, "system-admin 應該仍然握有設備審批權");
});

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
        ...(await device.headers({ method: "POST", path: refreshPath, token: bearer })),
        Authorization: `Bearer ${bearer}`
      }
    });

  const refreshed = await refresh(token);
  const refreshedBody = await refreshed.json();

  assert.equal(refreshed.status, 200);
  assert.equal(typeof refreshedBody.data.expiresInSeconds, "number");

  // 續期唔可以令剩餘變多。呢度登入同續期只差幾毫秒，所以兩個值實際上一樣，
  // 呢條淨係擋得住「變大」——「有冇真係遞減」由下面 2 秒上限嗰個 case 驗，
  // 嗰度時間差夠大先分得出。
  assert.ok(
    refreshedBody.data.sessionExpiresInSeconds <= loginBody.data.sessionExpiresInSeconds,
    "session remainder must not grow across a refresh"
  );
  // token 嘅 expiresInSeconds 相反：每次續期都回滿值。兩者唔同就係重點。
  assert.equal(refreshedBody.data.expiresInSeconds, loginBody.data.expiresInSeconds);
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
      ...(await otherDevice.headers({
        method: "POST",
        path: refreshPath,
        token: refreshedToken
      })),
      Authorization: `Bearer ${refreshedToken}`
    }
  });
  assert.equal(fromOtherDevice.status, 403);
  assert.equal((await fromOtherDevice.json()).error.code, "DEVICE_MISMATCH");

  // 同一台設備、同一個使用者，但簽章係為**另一枚 token** 簽嘅。冇 accessTokenHash
  // （RFC 9449 嘅 ath）嘅話呢個會過：簽章淨係綁 method／path／body／nonce／時間，
  // 完全冇提過係配邊枚 token。攻擊者攞到一份已簽名嘅續期請求（MITM、或者含
  // header 嘅存取紀錄），就可以換上同一台設備嘅另一枚 token 送出去。
  // 要兩枚**真係唔同**嘅 token 先測得到。JWT 嘅 claims 完全一樣嘅話（同一秒
  // 登入再續期，sub／ver／did／auth_time／iat／exp 全部一樣），簽出嚟係同一條
  // 字串——用嗰對去做「換 token」測試，實際上乜都冇換過，條測試會永遠綠。
  await new Promise((resolve) => {
    setTimeout(resolve, 1100);
  });

  const laterResponse = await refresh(refreshedToken);
  assert.equal(laterResponse.status, 200);
  const laterToken = (await laterResponse.json()).data.token;
  assert.notEqual(laterToken, refreshedToken, "the two tokens must actually differ");

  const headersForEarlierToken = await device.headers({
    method: "POST",
    path: refreshPath,
    token: refreshedToken
  });
  const swappedToken = await fetch(`${url}${refreshPath}`, {
    method: "POST",
    headers: { ...headersForEarlierToken, Authorization: `Bearer ${laterToken}` }
  });

  assert.equal(swappedToken.status, 400);
  assert.equal((await swappedToken.json()).error.code, "DEVICE_SIGNATURE_INVALID");

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

test("a session cannot outlive the absolute cap, no matter how often it refreshes", { skip }, async (t) => {
  // 上限設成 2 秒，其餘照真實設定行。呢個 case 要驗嘅唔係「token 過期」而係
  // 「session 過期」——所以 token 自己嘅壽命刻意留喺預設值（15 分鐘），過期
  // 嗰個一定係 session。
  const application = await startApplication({ jwt: { sessionMaxAge: "2s" } });
  const db = application.services.require("mysqldatabase");
  const username = `it-cap-${randomUUID().slice(0, 8)}`;
  const password = "Integration-Test-Pass-5!";
  const seeded = await seedUser(db, { username, password });

  t.after(async () => {
    await cleanupUser(db, seeded);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const device = await createTestDevice();
  const loginPath = "/api/v1/user/login";
  const body = JSON.stringify({ username, password, deviceLabel: "Cap device" });

  const login = async () =>
    fetch(`${url}${loginPath}`, {
      method: "POST",
      headers: await device.headers({
        method: "POST",
        path: loginPath,
        body,
        includePublicKey: true
      }),
      body
    });

  // 第一次登入留低一筆待審批，核准之後再登入。
  assert.equal((await login()).status, 403);
  await db.execute(
    "UPDATE user_devices SET status = 'approved', reviewed_at = ? WHERE user_id = ?",
    [Date.now(), seeded.userId]
  );

  const loggedIn = await login();
  assert.equal(loggedIn.status, 200);
  const token = (await loggedIn.json()).data.token;

  const refreshPath = "/api/v1/user/token/refresh";
  const refresh = async (bearer) =>
    fetch(`${url}${refreshPath}`, {
      method: "POST",
      headers: {
        ...(await device.headers({ method: "POST", path: refreshPath, token: bearer })),
        Authorization: `Bearer ${bearer}`
      }
    });

  // 上限之內：續期照樣成功。
  const refreshed = await refresh(token);
  assert.equal(refreshed.status, 200);
  const refreshedBody = await refreshed.json();
  const refreshedToken = refreshedBody.data.token;

  // 上限係 2 秒，所以剩餘一定係 0 到 2 之間——而唔係 8 小時嗰個預設值。
  const firstRemainder = refreshedBody.data.sessionExpiresInSeconds;
  assert.ok(
    firstRemainder >= 0 && firstRemainder <= 2,
    `expected a remainder within the 2s cap, got ${firstRemainder}`
  );

  // 等一秒再續一次（仲喺 2 秒上限之內），剩餘必須真係變細咗。回滿值嘅話呢兩個
  // 數會一樣——而前端就係靠呢個遞減去決定幾時提醒使用者存檔。
  await new Promise((resolve) => {
    setTimeout(resolve, 1100);
  });

  const refreshedAgain = await refresh(refreshedToken);
  assert.equal(refreshedAgain.status, 200);
  const secondRemainder = (await refreshedAgain.json()).data.sessionExpiresInSeconds;
  assert.ok(
    secondRemainder < firstRemainder,
    `the session remainder must shrink as the session ages: ${firstRemainder} -> ${secondRemainder}`
  );

  // 兩個 token 嘅 auth_time 必須一模一樣——續期唔可以重設起算點。
  const authTimeOf = (jwtToken) =>
    JSON.parse(Buffer.from(jwtToken.split(".")[1], "base64url").toString()).auth_time;
  assert.equal(authTimeOf(refreshedToken), authTimeOf(token));

  // 等到「一定超過」而唔係「啱啱好」：auth_time 同「而家」兩邊都取整到秒，
  // 所以等 2.1 秒喺秒數上可能只差 2，即係啱啱等於上限而唔係超過。等 3.5 秒
  // 令秒差一定 ≥ 3，避免呢個 case 間歇性紅。
  await new Promise((resolve) => {
    setTimeout(resolve, 3500);
  });

  // 過咗上限：續期換唔到新 token。呢個係「不能再續 token」嗰句嘅實際意思。
  assert.equal((await refresh(refreshedToken)).status, 401);

  // 而且啱啱先簽出嚟嗰個 token 自己都用唔到——上限係準確嘅 2 秒，唔係
  // 「2 秒再加上最後一個 token 剩返嘅壽命」。
  const meAfterCap = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${refreshedToken}` }
  });
  assert.equal(meAfterCap.status, 401);

  // 重新登入照樣得——上限結束嘅係 session，唔係封鎖個帳號。
  assert.equal((await login()).status, 200);
});

test("an approver can clear the queue over HTTP, and the approved user then gets in", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const password = "Integration-Test-Pass-4!";

  // 審批者需要 device.mgmt；申請人拿的是一個無關的權限。
  const approver = await seedUser(db, {
    username: `it-approver-${randomUUID().slice(0, 8)}`,
    password,
    permission: "device.mgmt"
  });
  const applicant = await seedUser(db, {
    username: `it-applicant-${randomUUID().slice(0, 8)}`,
    password
  });

  t.after(async () => {
    await cleanupUser(db, applicant);
    await cleanupUser(db, approver);
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  // 兩個人各自從自己的設備登入一次，各留下一筆待審批。
  const login = async (user, device) => {
    const path = "/api/v1/user/login";
    const body = JSON.stringify({ username: user.username, password, deviceLabel: "IT device" });

    return fetch(`${url}${path}`, {
      method: "POST",
      headers: await device.headers({ method: "POST", path, body, includePublicKey: true }),
      body
    });
  };

  const approverDevice = await createTestDevice();
  const applicantDevice = await createTestDevice();

  assert.equal((await login(approver, approverDevice)).status, 403);
  assert.equal((await login(applicant, applicantDevice)).status, 403);

  // 審批者自己那台用 break-glass 的方式核准（就是 §5.1 上線程序那一步）。
  await db.execute(
    "UPDATE user_devices SET status = 'approved', reviewed_at = ? WHERE user_id = ?",
    [Date.now(), approver.userId]
  );

  const approverLogin = await login(approver, approverDevice);
  assert.equal(approverLogin.status, 200);
  const approverToken = (await approverLogin.json()).data.token;

  // 佇列裡應該看得到申請人那一筆，連同審批者要靠的判斷依據。
  const queue = await fetch(`${url}/api/v1/device/bindings/pending`, {
    headers: { Authorization: `Bearer ${approverToken}` }
  });
  const queueBody = await queue.json();

  assert.equal(queue.status, 200);

  const entry = queueBody.data.items.find((item) => item.userId === applicant.userId);
  assert.ok(entry, "the applicant's request was not in the queue");
  assert.equal(entry.label, "IT device");
  assert.ok(!("publicKey" in entry), "key material must not reach the approver's screen");

  // 核准。這是整個專案第一支帶路徑參數的 route，所以這一步同時在驗
  // `:id` 真的會被解析並通過 params schema——單元測試是自己造 req.input.params
  // 的，永遠測不到那一段。
  // 核准要求 authType "jwt-password"：光有效的 session 不夠，還要再送一次
  // 目前的密碼——approver 跟 applicant 種進資料庫時共用同一個 `password`。
  const approveResponse = await fetch(
    `${url}/api/v1/device/bindings/${entry.id}/approve`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${approverToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password, note: "整合測試" })
    }
  );

  assert.equal(approveResponse.status, 200);
  assert.deepEqual((await approveResponse.json()).data, {
    id: entry.id,
    status: "approved"
  });

  // 現在申請人登得入了。
  assert.equal((await login(applicant, applicantDevice)).status, 200);

  // 重覆核准同一筆是 409，不是靜默成功——兩個審批者同時開著佇列時，第二個
  // 必須知道自己撲空了。密碼還是要帶對，否則會在 401 就被擋下，測不到 409。
  const again = await fetch(`${url}/api/v1/device/bindings/${entry.id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${approverToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(again.status, 409);

  // 申請人自己看得到自己的設備，但看不到佇列——他沒有 device.mgmt。
  const applicantToken = (await login(applicant, applicantDevice).then((r) => r.json())).data
    .token;

  const mine = await fetch(`${url}/api/v1/device/bindings`, {
    headers: { Authorization: `Bearer ${applicantToken}` }
  });
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).data.items.length, 1);

  const forbidden = await fetch(`${url}/api/v1/device/bindings/pending`, {
    headers: { Authorization: `Bearer ${applicantToken}` }
  });
  assert.equal(forbidden.status, 403);

  // --- 撤銷 ---------------------------------------------------------------
  //
  // 撤銷會先查一次綁定現況、確認仍是 approved，才推 token 版本號同轉狀態。
  // 單元測試用替身餵嗰個 status，餵咩就係咩；呢度行真嘅資料庫，驗嗰個
  // status 真係比對得到 'approved'。比唔到嘅話撤銷會永遠 409，而且靜靜哋
  // ——冇任何單元測試睇得出。
  const revokePath = `/api/v1/device/bindings/${entry.id}/revoke`;
  const revoked = await fetch(`${url}${revokePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${approverToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password, note: "整合測試撤銷" })
  });

  assert.equal(revoked.status, 200);
  assert.deepEqual((await revoked.json()).data, { id: entry.id, status: "revoked" });

  // 兩件事都要真係發生咗。只轉狀態嘅話，申請人手上嗰個 token 仲用得到自己
  // 過期為止——正正係呢次改動要防嘅嗰個「少撤銷」。
  const afterRevoke = await fetch(`${url}/api/v1/user/me`, {
    headers: { Authorization: `Bearer ${applicantToken}` }
  });
  assert.equal(afterRevoke.status, 401, "the revoked device's token must stop working");

  // 而且佢再登入唔返：設備已經唔係 approved。
  assert.equal((await login(applicant, applicantDevice)).status, 403);

  // 重覆撤銷係 409，唔會再推一次版本號。
  const revokedAgain = await fetch(`${url}${revokePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${approverToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });
  assert.equal(revokedAgain.status, 409);
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
