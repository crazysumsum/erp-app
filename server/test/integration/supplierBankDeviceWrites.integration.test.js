import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";

/**
 * TC-065（§6.7 `BANK-004`）—— Bank 寫入嘅 device／password／replay 保護。SEC-013。
 *
 * 案例原文：缺／錯 password、缺／撤銷 device、body／path 簽章錯、nonce 重放 ——
 * 對每個 Bank write 送出。預期：全部拒絕；合法 nonce 只用一次；唔重複修改或
 * audit；錯誤唔洩密。
 *
 * TASK-037 個 readiness report 評估呢個係十六個 case 入面**唯一一個連評估都話冇
 * 覆蓋**嘅：handler 測試只驗證咗每條 write route 個 schema 宣告咗 `password`、
 * authType 係 `jwt-device-password`，但全 repo 冇一條測試真係簽過一個請求，更加
 * 冇一條測試重放過一個 nonce。
 *
 * ## 呢度嘅嘢全部係真嘅
 *
 * 真 app（`createApplication`）、真 HTTP、真 JWT（帶 `did`）、真 `user_devices`
 * 綁定、真 ECDSA P-256 金鑰（WebCrypto，non-extractable，同前端一樣）、真簽章輸入
 * （用 app 自己個 `deviceBinding.signingInput`，唔係喺度抄一份）、真 scrypt 密碼。
 *
 * ## 對照組
 *
 * 每條 route 都先送一個**完全合法**嘅請求，要求佢成功。冇呢一步，「七種攻擊全部
 * 被拒」同「呢個 harness 根本簽唔出一個會過嘅請求」係分唔開嘅 —— 後者會令每一句
 * 拒絕斷言都綠。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Bank-Device-Test-1!";
const ACCOUNT = `55${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;

function config() {
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  };
}

async function deviceKey() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { keyPair, spki: Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)) };
}

async function signWith(keyPair, input) {
  return Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Buffer.from(input)))
    .toString("base64url");
}

integrationTest("TC-065 (BANK-004): every Bank write refuses a missing or wrong password, a missing or revoked device, a moved signature and a replayed nonce", async (t) => {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tc065-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: {
      ...source,
      application: { ...source.application, port: 0 },
      logging: {
        loggers: {
          request: { ...source.logging.loggers.request, directory: path.join(logRoot, "requests") },
          system: { ...source.logging.loggers.system, directory: path.join(logRoot, "system") }
        }
      }
    },
    serviceDiscoveryOptions: {
      additionalModuleUrls: [
        new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
        new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href
      ]
    }
  });
  const db = application.services.require("mysqldatabase");
  const deviceBinding = application.services.require("deviceBinding");
  const jwt = application.services.require("jwt");
  const now = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const ids = { supplierId: null, roleId: null, userId: null };
  let running = true;
  t.after(async () => {
    // 自己一條連線：app 喺測試尾為咗 flush log 已經關咗，佢個 pool 用唔到。
    if (running) await application.shutdown("tc065_complete");
    const cleanup = await mysql.createConnection(config());
    if (ids.supplierId) {
      await cleanup.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [ids.supplierId]);
      await cleanup.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [ids.supplierId]);
      await cleanup.execute("DELETE FROM suppliers WHERE id = ?", [ids.supplierId]);
    }
    if (ids.userId) {
      await cleanup.execute("DELETE FROM user_devices WHERE user_id = ?", [ids.userId]);
      await cleanup.execute("DELETE FROM user_roles WHERE user_id = ?", [ids.userId]);
      await cleanup.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(ids.userId)]);
      await cleanup.execute("DELETE FROM users WHERE id = ?", [ids.userId]);
    }
    if (ids.roleId) {
      await cleanup.execute("DELETE FROM role_permissions WHERE role_id = ?", [ids.roleId]);
      await cleanup.execute("DELETE FROM roles WHERE id = ?", [ids.roleId]);
    }
    await cleanup.end();
    fs.rmSync(logRoot, { recursive: true, force: true });
  });

  // ---- 角色、使用者、密碼 ----
  const permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];
  const [role] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`bank-device-${suffix}`, now]);
  ids.roleId = Number(role.insertId);
  for (const name of permissions) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [ids.roleId, permission.id]);
  }
  const { hashPassword } = await import("../../src/modules/user/passwordHash.js");
  const [user] = await db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [`bank-device-${suffix}`, await hashPassword(PASSWORD), "Bank Device", now, now]
  );
  ids.userId = Number(user.insertId);
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [ids.userId, ids.roleId]);

  // ---- 兩部設備：一部核准，一部撤銷 ----
  const approved = await deviceKey();
  const approvedId = deviceBinding.deviceIdFor(approved.spki);
  await deviceBinding.requestBinding({ userId: ids.userId, deviceId: approvedId, publicKeyDer: approved.spki, label: "tc065-approved" });
  await db.execute("UPDATE user_devices SET status = 'approved' WHERE user_id = ? AND device_id = ?", [ids.userId, approvedId]);
  const revoked = await deviceKey();
  const revokedId = deviceBinding.deviceIdFor(revoked.spki);
  await deviceBinding.requestBinding({ userId: ids.userId, deviceId: revokedId, publicKeyDer: revoked.spki, label: "tc065-revoked" });
  await db.execute("UPDATE user_devices SET status = 'revoked' WHERE user_id = ? AND device_id = ?", [ids.userId, revokedId]);

  const version = await application.services.require("tokenRevocation").currentVersion(String(ids.userId));
  const tokenFor = (deviceId) => jwt.issue(
    { roles: [`bank-device-${suffix}`], permissions, did: deviceId },
    { subject: String(ids.userId), version, authTime: Math.floor(Date.now() / 1000) }
  );
  const approvedToken = await tokenFor(approvedId);
  const revokedToken = await tokenFor(revokedId);

  // ---- Supplier 同兩行 Bank（一行做 update／default，一行做 deactivate）----
  const [[currency]] = await db.query("SELECT code FROM currencies LIMIT 1");
  const [supplier] = await db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`BDV-${suffix}`, `bdv-${suffix}`, `Bank Device ${suffix}`, `bank device ${suffix}`, currency.code ?? currency.CODE, now, now]
  );
  ids.supplierId = Number(supplier.insertId);
  const { SupplierBankService } = await import("../../src/modules/supplier/SupplierBankService.js");
  const seedConnection = await mysql.createConnection(config());
  const seedService = new SupplierBankService({
    database: {
      query: (sql, params) => seedConnection.query(sql, params),
      async withTransaction(work) {
        await seedConnection.beginTransaction();
        try { const r = await work(seedConnection); await seedConnection.commit(); return r; }
        catch (error) { await seedConnection.rollback(); throw error; }
      }
    },
    logger: { warn() {}, info() {}, error() {} },
    time: { nowMs: () => Date.now() },
    crypto: new SupplierBankCrypto({
      encryption: application.services.config.supplier.bankEncryption,
      lookup: application.services.config.supplier.bankLookup
    }),
    authorize: async () => ({ id: null, username: "tc065-seed", permissions }),
    audit: { async record(txn, input) {
      await txn.execute(
        `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type,
           target_id, supplier_id, target_label, reason, detail, request_id, ip)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Date.now(), input.actorUsername, input.action, input.targetType, input.targetId, input.supplierId,
          input.targetLabel, input.reason, JSON.stringify(input.detail), input.requestId ?? "", input.ip ?? ""]
      );
    } }
  });
  const seedActor = { actorId: null, claimedRoles: [], claimedPermissions: permissions, requestId: "tc065-seed", ip: "127.0.0.1" };
  const rowA = await seedService.create({ ...seedActor, supplierId: ids.supplierId, accountHolderName: "A", bankName: "Bank A",
    accountNumber: `${ACCOUNT}1`, isDefault: true, reason: "TC-065 種資料 A" });
  const rowB = await seedService.create({ ...seedActor, supplierId: ids.supplierId, accountHolderName: "B", bankName: "Bank B",
    accountNumber: `${ACCOUNT}2`, reason: "TC-065 種資料 B" });
  await seedConnection.end();

  const { url } = await application.start();
  const base = `/api/v1/suppliers/${ids.supplierId}/bank-accounts`;

  /**
   * 砌一個簽好嘅請求。每個參數都係一種攻擊嘅開關：
   * `sendBody` 同 `signBody` 唔同 = body 被改；`sendPath` 同 `signPath` 唔同 = 簽章被搬去第二條路。
   */
  const request = async ({
    path: sendPath, body, token = approvedToken, key = approved, deviceId = approvedId,
    signPath = sendPath, signBody = body, omitDevice = false, reuse = null
  }) => {
    if (reuse) {
      const r = await fetch(`${url}${reuse.path}`, { method: "POST", headers: reuse.headers, body: reuse.raw });
      return { status: r.status, text: await r.text(), sent: reuse };
    }
    const raw = JSON.stringify(body);
    const signedRaw = JSON.stringify(signBody);
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
    if (!omitDevice) {
      const nonce = randomUUID();
      const timestamp = Date.now();
      const input = deviceBinding.signingInput({
        accessTokenHash: deviceBinding.accessTokenHash(token),
        bodyHash: deviceBinding.bodyHash(Buffer.from(signedRaw)),
        deviceId, method: "POST", nonce, path: signPath, timestamp
      });
      Object.assign(headers, {
        "X-Device-Id": deviceId, "X-Device-Timestamp": String(timestamp),
        "X-Device-Nonce": nonce, "X-Device-Signature": await signWith(key.keyPair, input)
      });
    }
    const r = await fetch(`${url}${sendPath}`, { method: "POST", headers, body: raw });
    return { status: r.status, text: await r.text(), sent: { path: sendPath, headers, raw } };
  };

  const snapshot = async () => {
    const [rows] = await db.query(
      `SELECT id, version, status, is_default, account_holder_name, bank_name, HEX(account_ciphertext) AS c
         FROM supplier_bank_accounts WHERE supplier_id = ? ORDER BY id`, [ids.supplierId]);
    const [[audit]] = await db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ?", [ids.supplierId]);
    return { rows: JSON.stringify(rows), audits: Number(audit.n) };
  };
  const versionOf = async (id) => {
    const [[row]] = await db.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [id]);
    return Number(row.version);
  };

  // 四條 write route；每條由一個 function 產生「呢一刻」合法嘅 body，因為 version 會郁。
  const routes = [
    { name: "create", path: `${base}/create`, otherPath: `${base}/${rowB.id}/update`,
      body: async (tag) => ({ accountHolderName: `C ${tag}`, bankName: "Bank C",
        accountNumber: `${ACCOUNT.slice(0, 10)}${String(tag).padStart(6, "0")}`, reason: `TC-065 create ${tag}`, password: PASSWORD }) },
    { name: "update", path: `${base}/${rowA.id}/update`, otherPath: `${base}/${rowB.id}/update`,
      body: async (tag) => ({ accountHolderName: `A ${tag}`, bankName: "Bank A", version: await versionOf(rowA.id),
        reason: `TC-065 update ${tag}`, password: PASSWORD }) },
    { name: "default", path: `${base}/${rowB.id}/default`, otherPath: `${base}/${rowA.id}/default`,
      body: async (tag) => ({ version: await versionOf(rowB.id), reason: `TC-065 default ${tag}`, password: PASSWORD }) },
    { name: "deactivate", path: `${base}/${rowB.id}/deactivate`, otherPath: `${base}/${rowA.id}/deactivate`,
      body: async (tag) => ({ version: await versionOf(rowB.id), reason: `TC-065 deactivate ${tag}`, password: PASSWORD }) }
  ];

  const secrets = [PASSWORD, approvedToken, revokedToken, ACCOUNT];
  /**
   * 淨係「4xx」唔夠：一個攻擊可以因為**第二個原因**被拒。第一版就係咁 —— 把
   * nonce 重放保護成個關咗，呢個測試照樣綠，因為 update／default／deactivate
   * 嘅重放會撞 `version` 過期（409），create 嘅重放會撞帳號重覆（409）。兩個都係
   * 真嘅拒絕，但冇一個係 nonce 做嘅。所以每種攻擊都要講明佢**應該**死喺邊度。
   */
  const refusedWithoutEffect = async (label, expectedCode, attempt) => {
    const before = await snapshot();
    const response = await attempt();
    assert.ok(response.status >= 400 && response.status < 500,
      `${label} must be refused with a 4xx, got ${response.status}: ${response.text.slice(0, 200)}`);
    assert.ok(response.text.includes(`"${expectedCode}"`),
      `${label} must be refused as ${expectedCode}, not for some other reason: ${response.text.slice(0, 200)}`);
    const after = await snapshot();
    assert.equal(after.rows, before.rows, `${label}: no Bank row may change`);
    assert.equal(after.audits, before.audits, `${label}: no audit row may be written`);
    for (const secret of secrets) {
      assert.ok(!response.text.includes(secret), `${label}: the refusal must not echo a secret`);
    }
    // 內部原因（簽章錯／nonce 用過）只可以入 log，唔可以去客戶端：分得出嘅話，
    // 攻擊者就知道自己仲差幾遠。
    for (const reason of ["nonce_replayed", "signature_invalid", "timestamp_stale"]) {
      assert.ok(!response.text.includes(reason), `${label}: the client must not learn the internal reason ${reason}`);
    }
    return response;
  };

  let tag = 0;
  for (const route of routes) {
    // 攻擊全部喺合法請求之前送：deactivate 一旦成功，嗰行就唔再可以被 deactivate，
    // 之後嘅攻擊就會因為另一個原因被拒，而斷言分唔出。
    await refusedWithoutEffect(`${route.name}: missing password`, "PASSWORD_REQUIRED", async () => {
      const body = await route.body(++tag); delete body.password;
      return request({ path: route.path, body });
    });
    const wrongPassword = await refusedWithoutEffect(`${route.name}: wrong password`, "PASSWORD_INVALID", async () =>
      request({ path: route.path, body: { ...(await route.body(++tag)), password: `${PASSWORD}x` } }));
    // 設備驗證（會記低 nonce）喺密碼檢查之前行 —— ECDSA 比 scrypt 平好多。所以一個
    // 簽章啱但密碼錯嘅請求，佢個 nonce 已經用咗。呢度證實佢，而唔係讀 code 推。
    const [[spent]] = await db.query("SELECT COUNT(*) AS n FROM user_device_nonces WHERE nonce = ?",
      [wrongPassword.sent.headers["X-Device-Nonce"]]);
    assert.equal(Number(spent.n), 1, `${route.name}: a wrong-password request has already spent its nonce`);
    await refusedWithoutEffect(`${route.name}: missing device headers`, "DEVICE_SIGNATURE_REQUIRED", async () =>
      request({ path: route.path, body: await route.body(++tag), omitDevice: true }));
    await refusedWithoutEffect(`${route.name}: revoked device`, "DEVICE_REVOKED", async () =>
      request({ path: route.path, body: await route.body(++tag), token: revokedToken, key: revoked, deviceId: revokedId }));
    await refusedWithoutEffect(`${route.name}: body changed after signing`, "DEVICE_SIGNATURE_INVALID", async () => {
      const signed = await route.body(++tag);
      return request({ path: route.path, body: { ...signed, reason: `${signed.reason} (tampered)` }, signBody: signed });
    });
    await refusedWithoutEffect(`${route.name}: signature moved to another path`, "DEVICE_SIGNATURE_INVALID", async () =>
      request({ path: route.path, signPath: route.otherPath, body: await route.body(++tag) }));

    // ---- 對照組：同一條 route 一個完全合法嘅請求一定要過 ----
    const before = await snapshot();
    const accepted = await request({ path: route.path, body: await route.body(++tag) });
    assert.ok(accepted.status >= 200 && accepted.status < 300,
      `${route.name}: a correctly signed request with the right password must succeed, or every refusal above is vacuous — got ${accepted.status}: ${accepted.text.slice(0, 200)}`);
    const afterAccepted = await snapshot();
    assert.equal(afterAccepted.audits, before.audits + 1, `${route.name}: the accepted write is audited exactly once`);

    // ---- 重放：原封不動再送一次 ----
    await refusedWithoutEffect(`${route.name}: replayed nonce`, "DEVICE_SIGNATURE_INVALID", async () => request({ reuse: accepted.sent }));
  }

  // create 嘅重放最直接：成功咗一次，就只可以有一行。
  const [[created]] = await db.query(
    "SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE supplier_id = ? AND bank_name = 'Bank C'", [ids.supplierId]);
  assert.equal(Number(created.n), 1, "a replayed create must not create a second row");

  // ---- device／nonce log：案例要求嘅證據 ----
  // 關機先會 flush 個 log queue，所以喺呢度手動關，唔等 t.after。
  await application.shutdown("tc065_flows_complete");
  running = false;
  const files = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
      ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    : []);
  const logFiles = files(logRoot).map((file) => ({ file: path.relative(logRoot, file), text: fs.readFileSync(file, "utf8") }));
  const logs = logFiles.map((entry) => entry.text).join("\n");
  // 只數**設備拒絕事件**本身。`nonce_replayed` 呢個字亦都會出現喺 request log
  // 嘅錯誤記錄入面（內部錯誤訊息 `Device signature rejected: nonce_replayed`），
  // 所以淨係 grep 呢個字會數到兩倍。
  const replayEvents = logFiles.flatMap((entry) => entry.text.split("\n")
    .filter((line) => line.includes("auth.device.signature_rejected") && line.includes("nonce_replayed"))
    .map(() => entry.file));
  const breakdown = logFiles.map((entry) => `${entry.file}: ${entry.text.split("nonce_replayed").length - 1}`).join(", ");
  assert.equal(replayEvents.length, routes.length,
    `each of the ${routes.length} replays must produce one auth.device.signature_rejected event with reason nonce_replayed; got ${replayEvents.length} (${breakdown})`);
  for (const secret of secrets) {
    assert.ok(!logs.includes(secret), "the device and nonce logs must not carry a password, token or account");
  }

});
