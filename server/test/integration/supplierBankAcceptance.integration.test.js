import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeSupplierConfig } from "../../src/modules/supplier/normalizeSupplierConfig.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";

/**
 * TASK-037 —— SUP-CAP-03 嘅 HTTP 層驗收案例。
 *
 * 呢幾個案例之前全部評估為「行為有測試，但冇一個係喺真 HTTP 上面、按自己個案例
 * 編號執行過」：
 *
 * - TC-062（BANK-001）遮罩列表 —— 逐個角色，包埋 ≤4 位嘅短帳號
 * - TC-063（BANK-002）受控 reveal —— 真 response header、錯密碼、audit
 * - TC-064（BANK-003）寫入權限矩陣 —— 逐個角色逐條路由
 * - TC-068（BANK-007）key 唔喺 ring —— 見下面嗰條嘅說明；有兩部分係已知 FAIL
 *
 * 全部用同一個真 app、真 JWT、真設備簽章、真 scrypt 密碼。角色同 §3 測試資料基線
 * 一樣：U-VIEW、U-MGMT、U-BANK-R、U-BANK-W、U-NONE，加一個只有 bank.mgmt 嘅用戶。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Bank-Acceptance-1!";
const SECRET = `44${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;
const SHORT = String(Math.floor(1000 + Math.random() * 8999));   // 4 位
const CRYPTO_FIELDS = ["ciphertext", "authTag", "blindIndex", "cryptoContext", "encryptionKeyId", "lastFour", "iv"];

const h = { application: null, url: "", db: null, deviceBinding: null, jwt: null, crypto: null,
  logRoot: "", suffix: randomUUID().slice(0, 8), roleIds: [], userIds: [], supplierIds: [] };

async function deviceKey() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { keyPair, spki: Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)) };
}

/** 一個有指定權限、有已核准設備、有真密碼嘅用戶。 */
async function makeUser(label, permissions) {
  const now = Date.now();
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`acc-${label}-${h.suffix}`, now]);
  const roleId = Number(role.insertId); h.roleIds.push(roleId);
  for (const name of permissions) {
    const [[permission]] = await h.db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await h.db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  const { hashPassword } = await import("../../src/modules/user/passwordHash.js");
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [`acc-${label}-${h.suffix}`, await hashPassword(PASSWORD), `Acc ${label}`, now, now]);
  const userId = Number(user.insertId); h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const key = await deviceKey();
  const deviceId = h.deviceBinding.deviceIdFor(key.spki);
  await h.deviceBinding.requestBinding({ userId, deviceId, publicKeyDer: key.spki, label: `acc-${label}` });
  await h.db.execute("UPDATE user_devices SET status = 'approved' WHERE user_id = ? AND device_id = ?", [userId, deviceId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [`acc-${label}-${h.suffix}`], permissions, did: deviceId },
    { subject: String(userId), version, authTime: Math.floor(Date.now() / 1000) });
  return { label, userId, token, key, deviceId };
}

async function get(user, route) {
  const headers = user ? { authorization: `Bearer ${user.token}` } : {};
  const r = await fetch(`${h.url}${route}`, { headers });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

/** 一個用 jwt-password（reveal）或者 jwt-device-password（寫入）嘅 POST；兩者都簽，多出嚟嘅 header 無害。 */
async function post(user, route, body) {
  const raw = JSON.stringify(body);
  const nonce = randomUUID();
  const timestamp = Date.now();
  const input = h.deviceBinding.signingInput({
    accessTokenHash: h.deviceBinding.accessTokenHash(user.token),
    bodyHash: h.deviceBinding.bodyHash(Buffer.from(raw)),
    deviceId: user.deviceId, method: "POST", nonce, path: route, timestamp
  });
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, user.key.keyPair.privateKey,
    Buffer.from(input))).toString("base64url");
  const r = await fetch(`${h.url}${route}`, { method: "POST", body: raw, headers: {
    "content-type": "application/json", authorization: `Bearer ${user.token}`,
    "X-Device-Id": user.deviceId, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce, "X-Device-Signature": signature
  } });
  return { status: r.status, headers: r.headers, text: await r.text() };
}

async function seedSupplier() {
  const [[currency]] = await h.db.query("SELECT code FROM currencies LIMIT 1");
  const s = randomUUID().slice(0, 8); const now = Date.now();
  const [row] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key,
       default_currency_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`ACC-${s}`, `acc-${s}`, `Acceptance ${s}`, `acceptance ${s}`, currency.code ?? currency.CODE, now, now]);
  const id = Number(row.insertId); h.supplierIds.push(id);
  return id;
}

/** 用一個指定嘅 crypto 直接種一行 —— 用嚟砌「呢行用緊一條 app ring 冇嘅 key」。 */
async function seedRow(supplierId, account, crypto) {
  const { SupplierBankService } = await import("../../src/modules/supplier/SupplierBankService.js");
  const permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];
  // app 自己嗰個 database service —— 正式環境 SupplierBankService 用緊嘅就係佢。
  const service = new SupplierBankService({
    database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto,
    authorize: async () => ({ id: null, username: "acc-seed", permissions }),
    audit: { async record(txn, i) {
      await txn.execute(
        `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type,
           target_id, supplier_id, target_label, reason, detail, request_id, ip) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Date.now(), i.actorUsername, i.action, i.targetType, i.targetId, i.supplierId, i.targetLabel, i.reason,
          JSON.stringify(i.detail), "", ""]);
    } }
  });
  return service.create({ actorId: null, claimedRoles: [], claimedPermissions: permissions, requestId: "acc-seed",
    ip: "127.0.0.1", supplierId, accountHolderName: "Seed", bankName: "Seed Bank", accountNumber: account, reason: "TASK-037 種資料" });
}

async function state(supplierId) {
  const [rows] = await h.db.query(
    `SELECT id, version, status, is_default, bank_name, HEX(account_ciphertext) AS c FROM supplier_bank_accounts
      WHERE supplier_id = ? ORDER BY id`, [supplierId]);
  const [[audit]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ?", [supplierId]);
  return { rows: JSON.stringify(rows), audits: Number(audit.n) };
}

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tc-acc-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } },
    serviceDiscoveryOptions: { additionalModuleUrls: [
      new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
      new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] }
  });
  h.db = h.application.services.require("mysqldatabase");
  h.deviceBinding = h.application.services.require("deviceBinding");
  h.jwt = h.application.services.require("jwt");
  h.crypto = new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
    lookup: h.application.services.config.supplier.bankLookup });
  ({ url: h.url } = await h.application.start());
});

after(async () => {
  if (!h.application) return;
  for (const id of h.supplierIds) {
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE supplier_id = ?", [id]);
    await h.db.execute("DELETE FROM supplier_bank_accounts WHERE supplier_id = ?", [id]);
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  for (const id of h.userIds) {
    await h.db.execute("DELETE FROM user_devices WHERE user_id = ?", [id]);
    await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await h.db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(id)]);
    await h.db.execute("DELETE FROM users WHERE id = ?", [id]);
  }
  for (const id of h.roleIds) {
    await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
    await h.db.execute("DELETE FROM roles WHERE id = ?", [id]);
  }
  await h.application.shutdown("tc_acceptance_complete");
  fs.rmSync(h.logRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
integrationTest("TC-062 (BANK-001): every role that may list Bank rows sees only masks, short accounts fully masked, no crypto metadata", async () => {
  const supplierId = await seedSupplier();
  await seedRow(supplierId, SECRET, h.crypto);
  await seedRow(supplierId, SHORT, h.crypto);
  const route = `/api/v1/suppliers/${supplierId}/bank-accounts`;

  const roles = {
    "U-VIEW": ["supplier.view"],
    "U-MGMT": ["supplier.view", "supplier.mgmt"],
    "U-BANK-R": ["supplier.view", "supplier.bank.view"],
    "U-BANK-W": ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]
  };
  for (const [label, permissions] of Object.entries(roles)) {
    const user = await makeUser(`list-${label}`, permissions);
    const listed = await get(user, route);
    assert.equal(listed.status, 200, `${label} must be able to list: ${listed.text.slice(0, 200)}`);
    const items = JSON.parse(listed.text).data.items;
    assert.equal(items.length, 2, `${label} sees both rows`);
    assert.ok(!listed.text.includes(SECRET), `${label}: the full account never crosses the wire`);
    for (const field of CRYPTO_FIELDS) {
      assert.ok(!listed.text.includes(`"${field}"`), `${label}: ${field} must not be in the list projection`);
    }
    // 一般帳號顯示尾四位；≤4 位嘅短帳號**一個字元都唔可以露**，否則個「尾四位」就係成個帳號。
    const masks = items.map((item) => item.maskedAccountNumber);
    assert.equal(masks.filter((mask) => mask.endsWith(SECRET.slice(-4))).length, 1,
      `${label}: the ordinary account shows exactly its last four: ${JSON.stringify(masks)}`);
    assert.equal(masks.filter((mask) => !/[0-9A-Z]/u.test(mask)).length, 1,
      `${label}: the short account's mask must carry no character of the account: ${JSON.stringify(masks)}`);
    assert.ok(masks.every((mask) => !mask.includes(SHORT)), `${label}: the short account never appears`);
  }

  // 冇 supplier.view：連遮罩版都唔俾睇。
  const none = await makeUser("list-U-NONE", []);
  const refused = await get(none, route);
  assert.equal(refused.status, 403, `U-NONE must be refused: ${refused.text.slice(0, 200)}`);
  assert.ok(!refused.text.includes(SECRET) && !refused.text.includes(SHORT));
  // 冇 token：401。
  assert.equal((await get(null, route)).status, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
integrationTest("TC-063 (BANK-002): reveal needs bank.view and the current password, is audited, and is not cacheable", async () => {
  const supplierId = await seedSupplier();
  const row = await seedRow(supplierId, SECRET, h.crypto);
  const route = `/api/v1/suppliers/${supplierId}/bank-accounts/${row.id}/reveal`;
  const reader = await makeUser("reveal-U-BANK-R", ["supplier.view", "supplier.bank.view"]);
  const viewer = await makeUser("reveal-U-VIEW", ["supplier.view"]);
  const reveals = async () => {
    const [[n]] = await h.db.query(
      // action 喺資料庫係 `supplier.bank.reveal`。第一版寫咗 `bank.reveal`，永遠數到 0 ——
      // 即係下面兩句「拒絕唔寫 audit」係點都會過嘅空檢查，靠「合法 reveal 要 +1」
      // 嗰個對照組先捉到。
      "SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.bank.reveal'", [supplierId]);
    return Number(n.n);
  };

  // 錯密碼：唔回值、唔寫 reveal audit。
  const before = await reveals();
  const wrong = await post(reader, route, { reason: "TC-063 錯密碼", password: `${PASSWORD}x` });
  assert.equal(wrong.status, 403, wrong.text.slice(0, 200));
  assert.ok(wrong.text.includes('"PASSWORD_INVALID"'));
  assert.ok(!wrong.text.includes(SECRET), "a wrong password returns no account");
  assert.equal(await reveals(), before, "a refused reveal writes no reveal audit");

  // 冇 bank.view：一樣拒絕、唔寫 audit。
  const denied = await post(viewer, route, { reason: "TC-063 冇 bank.view", password: PASSWORD });
  assert.equal(denied.status, 403, denied.text.slice(0, 200));
  assert.ok(!denied.text.includes(SECRET));
  assert.equal(await reveals(), before, "a reveal without bank.view writes no reveal audit");

  // 合法：回明文、audit 已經 commit、唔可以快取。
  const ok = await post(reader, route, { reason: "TC-063 合法查看", password: PASSWORD });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  assert.equal(JSON.parse(ok.text).data.accountNumber, SECRET);
  assert.equal(await reveals(), before + 1, "the reveal audit is committed by the time the plaintext arrives");
  assert.match(String(ok.headers.get("cache-control")), /no-store/u, "the response must not be stored");
  assert.equal(ok.headers.get("pragma"), "no-cache");
  // 已記錄嘅偏離（HD-033）：design §6.6 要求 `no-store, private` 同 `expiresInSeconds`。
  // 框架會把 Cache-Control 覆寫成淨係 `no-store`；expiresInSeconds 冇做。兩樣都已經係
  // Product Owner 決定咗「記低偏離」嘅 FAIL（DEV-T34-CACHE-PRIVATE、DEV-T34-EXPIRES-IN），
  // 呢度照實斷言今日嘅樣，等佢哪日改咗會即刻見到。
  assert.doesNotMatch(String(ok.headers.get("cache-control")), /private/u, "recorded deviation DEV-T34-CACHE-PRIVATE still stands");
  assert.equal(JSON.parse(ok.text).data.expiresInSeconds, undefined, "recorded deviation DEV-T34-EXPIRES-IN still stands");
});

// ─────────────────────────────────────────────────────────────────────────────
integrationTest("TC-064 (BANK-003): only view + bank.view + bank.mgmt, with device and password, may write; everyone else changes nothing", async () => {
  const supplierId = await seedSupplier();
  const row = await seedRow(supplierId, SECRET, h.crypto);
  const base = `/api/v1/suppliers/${supplierId}/bank-accounts`;
  const versionOf = async () => {
    const [[r]] = await h.db.query("SELECT version FROM supplier_bank_accounts WHERE id = ?", [row.id]);
    return Number(r.version);
  };
  const routes = [
    ["create", `${base}/create`, async () => ({ accountHolderName: "M", bankName: "Matrix",
      accountNumber: `${SECRET.slice(0, 8)}${String(Date.now()).slice(-8)}`, reason: "TC-064 create", password: PASSWORD })],
    ["update", `${base}/${row.id}/update`, async () => ({ accountHolderName: "M", bankName: "Matrix Up",
      version: await versionOf(), reason: "TC-064 update", password: PASSWORD })],
    ["default", `${base}/${row.id}/default`, async () => ({ version: await versionOf(), reason: "TC-064 default", password: PASSWORD })],
    ["deactivate", `${base}/${row.id}/deactivate`, async () => ({ version: await versionOf(), reason: "TC-064 deactivate", password: PASSWORD })]
  ];
  const refusedRoles = {
    "U-MGMT": ["supplier.view", "supplier.mgmt"],
    "bank.mgmt only": ["supplier.bank.mgmt"],
    "U-BANK-R": ["supplier.view", "supplier.bank.view"]
  };
  for (const [label, permissions] of Object.entries(refusedRoles)) {
    const user = await makeUser(`write-${label.replace(/[^a-z]/giu, "")}`, permissions);
    for (const [name, route, body] of routes) {
      const before = await state(supplierId);
      const response = await post(user, route, await body());
      assert.equal(response.status, 403, `${label} ${name} must be refused as 403: ${response.text.slice(0, 200)}`);
      const afterState = await state(supplierId);
      assert.equal(afterState.rows, before.rows, `${label} ${name}: no row may change`);
      assert.equal(afterState.audits, before.audits, `${label} ${name}: no audit may be written`);
    }
  }
  // 對照組：U-BANK-W 四條都得。
  const writer = await makeUser("write-UBANKW", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
  for (const [name, route, body] of routes) {
    const before = await state(supplierId);
    const response = await post(writer, route, await body());
    assert.ok(response.status >= 200 && response.status < 300,
      `U-BANK-W ${name} must succeed, or every refusal above is vacuous: ${response.status} ${response.text.slice(0, 200)}`);
    assert.equal((await state(supplierId)).audits, before.audits + 1, `U-BANK-W ${name} is audited once`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * TC-068（BANK-007）—— 一行用緊一條 ring 入面冇嘅 key。
 *
 * 分三條，因為佢三部分嘅結果唔同：
 *
 * 1. **唔可以回明文** —— PASS，呢條強制執行。
 * 2. **公開 code 要係 503 `BANK_KEY_UNAVAILABLE`**（設計 §6 錯誤表、§8.3）—— 之前 FAIL
 *    （回 422 `BANK_ACCOUNT_UNREADABLE`，同竄改收埋做同一個 code），DEF-026 修正後 PASS，
 *    `todo` 已拎走，而家強制執行。
 * 3. **Lookup key 唔喺 ring 時查重要 fail closed** —— 之前 FAIL（HIGH）：同一個
 *    Supplier 可以再新增同一個帳號。DEF-027 按 Product Owner 揀嘅 (b) 修正：嗰個
 *    Supplier 嘅新增／改帳號回 503，其他 Supplier 唔受影響；開機只記 error log，唔阻開機。
 *    `todo` 已拎走，而家強制執行。
 */
async function seedUnder(supplierId, account, { encryptionKeyId, lookupKeyId }) {
  const appConfig = h.application.services.config.supplier;
  const foreign = (id) => JSON.stringify({ [id]: randomBytes(32).toString("base64") });
  const normalized = normalizeSupplierConfig({
    bankEncryption: encryptionKeyId
      ? { activeKeyId: encryptionKeyId, keyRing: foreign(encryptionKeyId) }
      : { activeKeyId: appConfig.bankEncryption.activeKeyId, keyRing: JSON.stringify(Object.fromEntries(
        Object.entries(appConfig.bankEncryption.keyRing).map(([k, v]) => [k, v.reveal ? v.reveal() : String(v)]))) },
    bankLookup: lookupKeyId
      ? { activeKeyId: lookupKeyId, keyRing: foreign(lookupKeyId) }
      : { activeKeyId: appConfig.bankLookup.activeKeyId, keyRing: JSON.stringify(Object.fromEntries(
        Object.entries(appConfig.bankLookup.keyRing).map(([k, v]) => [k, v.reveal ? v.reveal() : String(v)]))) }
  });
  return seedRow(supplierId, account, new SupplierBankCrypto({ encryption: normalized.bankEncryption, lookup: normalized.bankLookup }));
}

integrationTest("TC-068 (BANK-007): a row whose encryption key is not in the ring is never revealed", async () => {
  const supplierId = await seedSupplier();
  const row = await seedUnder(supplierId, SECRET, { encryptionKeyId: "gone-enc" });
  const reader = await makeUser("b7-reader", ["supplier.view", "supplier.bank.view"]);
  const response = await post(reader, `/api/v1/suppliers/${supplierId}/bank-accounts/${row.id}/reveal`,
    { reason: "TC-068 key 唔喺 ring", password: PASSWORD });
  assert.ok(response.status >= 400, `must be refused, got ${response.status}`);
  assert.ok(!response.text.includes(SECRET), "fail closed: no plaintext");
  assert.ok(!response.text.includes("gone-enc"), "the public message must not leak the key id");
});

integrationTest("TC-068 (BANK-007): the refusal is 503 BANK_KEY_UNAVAILABLE, as design 6 and 8.3 specify",
  async () => {
    const supplierId = await seedSupplier();
    const row = await seedUnder(supplierId, SECRET, { encryptionKeyId: "gone-enc-2" });
    const reader = await makeUser("b7-code", ["supplier.view", "supplier.bank.view"]);
    const response = await post(reader, `/api/v1/suppliers/${supplierId}/bank-accounts/${row.id}/reveal`,
      { reason: "TC-068 公開 code", password: PASSWORD });
    assert.equal(response.status, 503, response.text.slice(0, 200));
    assert.ok(response.text.includes('"BANK_KEY_UNAVAILABLE"'));
  });

integrationTest("TC-068 (BANK-007): a duplicate check that cannot read an existing row's lookup key fails closed",
  async () => {
    const supplierId = await seedSupplier();
    await seedUnder(supplierId, SECRET, { lookupKeyId: "gone-look" });
    const writer = await makeUser("b7-dup", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
    const before = await state(supplierId);
    const response = await post(writer, `/api/v1/suppliers/${supplierId}/bank-accounts/create`, {
      accountHolderName: "Dup", bankName: "Dup Bank", accountNumber: SECRET, reason: "TC-068 查重", password: PASSWORD });
    assert.equal(response.status, 503, response.text.slice(0, 200));
    assert.ok(response.text.includes('"BANK_KEY_UNAVAILABLE"'));
    assert.ok(!response.text.includes("gone-look"), "the public message must not name the key");
    assert.equal((await state(supplierId)).rows, before.rows, "no second row may be created");

    // 開機檢查：用 app 自己嗰個 service、真設定、真 MySQL 再行一次。佢只 log，唔掟。
    const systemLog = () => fs.readdirSync(path.join(h.logRoot, "system"), { recursive: true })
      .map((name) => path.join(h.logRoot, "system", name)).filter((file) => fs.statSync(file).isFile())
      .map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const seen = () => systemLog().split("supplier.bank.keys_outside_ring").length - 1;
    const logged = seen();
    await h.application.services.require("supplierBankKeyCheck").initialize();
    assert.ok(seen() > logged, "startup check reports rows on a lookup key outside the ring");
    assert.ok(!systemLog().includes("gone-look"), "the log does not name the key");

    // 對照：另一個 Supplier 唔受影響 —— fail closed 係逐個 Supplier，唔係成個模組。
    const other = await seedSupplier();
    const allowed = await post(writer, `/api/v1/suppliers/${other}/bank-accounts/create`, {
      accountHolderName: "Other", bankName: "Other Bank", accountNumber: SECRET, reason: "TC-068 對照", password: PASSWORD });
    assert.equal(allowed.status, 200, allowed.text.slice(0, 200));
  });

integrationTest("TC-068 (BANK-007): re-entering the account on the only unreadable row repairs it; a second one still blocks",
  async () => {
    // 修復路徑：重新輸入嗰行嘅帳號會用 active key 重算佢個 index。嗰行自己唔可以擋住自己，
    // 但同一個 Supplier 仲有第二行唔喺 ring 就要照擋 —— 呢半係對照。
    const service = await serviceWith();
    const NEXT = `${SECRET.slice(0, 6)}8${SECRET.slice(7)}`;
    const alone = await seedSupplier();
    const only = await seedUnder(alone, SECRET, { lookupKeyId: "gone-look-3" });
    await service.update({ ...svcActor, supplierId: alone, bankAccountId: only.id, version: only.version,
      accountHolderName: "Seed", bankName: "Seed Bank", accountNumber: NEXT, reason: "TC-068 修復" });
    assert.equal((await rawRow(only.id)).lk, h.application.services.config.supplier.bankLookup.activeKeyId);

    const two = await seedSupplier();
    const first = await seedUnder(two, SECRET, { lookupKeyId: "gone-look-4" });
    await seedUnder(two, NEXT, { lookupKeyId: "gone-look-4" });
    await assert.rejects(() => service.update({ ...svcActor, supplierId: two, bankAccountId: first.id, version: first.version,
      accountHolderName: "Seed", bankName: "Seed Bank", accountNumber: `${NEXT}1`, reason: "TC-068 對照" }),
    (error) => error.statusCode === 503 && error.publicCode === "BANK_KEY_UNAVAILABLE");
  });

// ─────────────────────────────────────────────────────────────────────────────
// Service 層嘅案例（真 MySQL，app 自己個 database service）
async function serviceWith({ audit } = {}) {
  const { SupplierBankService } = await import("../../src/modules/supplier/SupplierBankService.js");
  const permissions = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];
  return new SupplierBankService({
    database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto: h.crypto,
    authorize: async () => ({ id: null, username: "acc-svc", permissions }),
    audit: audit ?? { async record(txn, i) {
      await txn.execute(
        `INSERT INTO supplier_audit_logs (occurred_at, actor_user_id, actor_username, action, target_type,
           target_id, supplier_id, target_label, reason, detail, request_id, ip) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [Date.now(), i.actorUsername, i.action, i.targetType, i.targetId, i.supplierId, i.targetLabel, i.reason,
          JSON.stringify(i.detail), "", ""]);
    } }
  });
}
const svcActor = { actorId: null, claimedRoles: [], claimedPermissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"],
  requestId: "acc-svc", ip: "127.0.0.1" };
async function rawRow(id) {
  const [[row]] = await h.db.query(
    `SELECT version, status, is_default, HEX(account_ciphertext) AS c, HEX(account_iv) AS iv, HEX(account_auth_tag) AS tag,
            HEX(account_blind_index) AS idx, encryption_key_id AS ek, blind_index_key_id AS lk
       FROM supplier_bank_accounts WHERE id = ?`, [id]);
  return row;
}

integrationTest("TC-071 (BANK-010): an update that keeps the account keeps every encrypted byte; one that changes it replaces them all", async () => {
  const supplierId = await seedSupplier();
  const service = await serviceWith();
  const created = await service.create({ ...svcActor, supplierId, accountHolderName: "U", bankName: "Before",
    accountNumber: SECRET, reason: "TC-071 建立" });
  const original = await rawRow(created.id);

  // 只改銀行名：密文、IV、tag、blind index、兩個 key id 一個 byte 都唔可以郁。
  const renamed = await service.update({ ...svcActor, supplierId, bankAccountId: created.id, version: created.version,
    accountHolderName: "U", bankName: "After", reason: "TC-071 改銀行名" });
  const afterRename = await rawRow(created.id);
  for (const field of ["c", "iv", "tag", "idx", "ek", "lk"]) {
    assert.equal(afterRename[field], original[field], `changing only the bank name must not touch ${field}`);
  }
  assert.equal(Number(afterRename.version), Number(original.version) + 1, "the version still advances");

  // 改帳號：新 IV、新密文、新 blind index，而舊帳號喺呢行任何欄位都搵唔返。
  const NEXT = `${SECRET.slice(0, 6)}9${SECRET.slice(7)}`;
  await service.update({ ...svcActor, supplierId, bankAccountId: created.id, version: renamed.version,
    accountHolderName: "U", bankName: "After", accountNumber: NEXT, reason: "TC-071 改帳號" });
  const afterChange = await rawRow(created.id);
  for (const field of ["c", "iv", "idx"]) {
    assert.notEqual(afterChange[field], original[field], `changing the account must replace ${field}`);
  }
  assert.equal(afterChange.ek, h.application.services.config.supplier.bankEncryption.activeKeyId, "re-encrypted under the active key");
  const [[everything]] = await h.db.query("SELECT * FROM supplier_bank_accounts WHERE id = ?", [created.id]);
  const serialised = Object.values(everything).map((v) => (Buffer.isBuffer(v) ? v.toString("latin1") : String(v))).join("|");
  assert.ok(!serialised.includes(SECRET) && !serialised.includes(NEXT), "neither the old nor the new account is stored in clear");
  const [updates] = await h.db.query(
    "SELECT detail FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier.bank.update' ORDER BY id", [supplierId]);
  assert.equal(updates.length, 2, "both updates are audited");
  assert.ok(!JSON.stringify(updates).includes(SECRET) && !JSON.stringify(updates).includes(NEXT), "the audit carries no account");
});

integrationTest("TC-072 (BANK-011): deactivation clears the default and keeps the row; there is no route that deletes one", async () => {
  const supplierId = await seedSupplier();
  const service = await serviceWith();
  const row = await service.create({ ...svcActor, supplierId, accountHolderName: "D", bankName: "Deact",
    accountNumber: SECRET, isDefault: true, reason: "TC-072 建立" });
  assert.equal(Number((await rawRow(row.id)).is_default), 1);
  await service.deactivate({ ...svcActor, supplierId, bankAccountId: row.id, version: row.version, reason: "TC-072 停用" });
  const after = await rawRow(row.id);
  assert.ok(after, "a deactivated row is kept, not deleted");
  assert.notEqual(after.status, "active");
  assert.equal(Number(after.is_default), 0, "deactivating the default clears it");

  /**
   * 永久刪除唔存在：DELETE 冇 route。
   *
   * 呢個框架對**所有未登記**嘅 `/api` 請求一律回 401 `Unauthorized Access`（`apiDispatcher`
   * 嘅 `api.not_registered`），特登唔回 404，唔俾人探測有邊啲 route。所以「冇 route」同
   * 「token 有問題」單睇 401 分唔開。第一版斷言 404／405，錯咗。
   *
   * 分得開嘅做法：同一個 token 叫一條**有登記**嘅 route 要 200（token 冇問題），叫一條
   * 明顯唔存在嘅 route 攞佢個回應做對照，DELETE 嘅回應一定要同呢個對照一模一樣。
   */
  const writer = await makeUser("tc072", ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]);
  const auth = { authorization: `Bearer ${writer.token}` };
  const registered = await fetch(`${h.url}/api/v1/suppliers/${supplierId}/bank-accounts`, { headers: auth });
  assert.equal(registered.status, 200, "the token is valid on a registered route");
  const unregistered = await fetch(`${h.url}/api/v1/suppliers/${supplierId}/no-such-route-${h.suffix}`,
    { method: "DELETE", headers: auth });
  const unregisteredBody = JSON.parse(await unregistered.text());
  const deleted = await fetch(`${h.url}/api/v1/suppliers/${supplierId}/bank-accounts/${row.id}`, { method: "DELETE", headers: auth });
  const deletedBody = JSON.parse(await deleted.text());
  assert.equal(deleted.status, unregistered.status,
    `DELETE on a Bank row must be answered exactly as an unregistered route is (${unregistered.status}), got ${deleted.status}`);
  assert.equal(deletedBody.error?.code, unregisteredBody.error?.code, "same refusal as a route that does not exist");
  assert.ok(await rawRow(row.id), "and the row is still there");
  // 「已被付款引用嘅資料保留」：呢個 baseline 冇付款模組引用 Bank 行，所以嗰一半 NOT_APPLICABLE。
});

integrationTest("TC-073 (BANK-012): when the audit cannot be written, no Bank write lands and no reveal returns an account", async () => {
  const supplierId = await seedSupplier();
  const good = await serviceWith();
  const seeded = await good.create({ ...svcActor, supplierId, accountHolderName: "A", bankName: "Audit",
    accountNumber: SECRET, reason: "TC-073 建立" });
  const failing = await serviceWith({ audit: { async record() { throw new Error("simulated audit failure"); } } });
  const operations = {
    create: () => failing.create({ ...svcActor, supplierId, accountHolderName: "B", bankName: "Audit",
      accountNumber: `${SECRET.slice(0, 5)}8${SECRET.slice(6)}`, reason: "TC-073 create" }),
    update: () => failing.update({ ...svcActor, supplierId, bankAccountId: seeded.id, version: seeded.version,
      accountHolderName: "A2", bankName: "Audit2", reason: "TC-073 update" }),
    setDefault: () => failing.setDefault({ ...svcActor, supplierId, bankAccountId: seeded.id, version: seeded.version,
      reason: "TC-073 setDefault" }),
    deactivate: () => failing.deactivate({ ...svcActor, supplierId, bankAccountId: seeded.id, version: seeded.version,
      reason: "TC-073 deactivate" }),
    reveal: () => failing.reveal({ ...svcActor, supplierId, bankAccountId: seeded.id, reason: "TC-073 reveal" })
  };
  for (const [name, run] of Object.entries(operations)) {
    const before = await state(supplierId);
    let result = null;
    await assert.rejects(async () => { result = await run(); }, `${name} must fail when its audit cannot be written`);
    assert.equal(result, null, `${name}: nothing may be returned`);
    const afterState = await state(supplierId);
    assert.equal(afterState.rows, before.rows, `${name}: the business write must roll back`);
  }
  // 對照組：同一個操作配一個正常嘅 audit 係成功嘅 —— 否則上面嘅「失敗」可能唔係因為 audit。
  const control = await good.update({ ...svcActor, supplierId, bankAccountId: seeded.id, version: seeded.version,
    accountHolderName: "A3", bankName: "Audit3", reason: "TC-073 control" });
  assert.ok(control.version > seeded.version, "with a working audit the same update succeeds");
});
