import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";

/**
 * TASK-051 step 2b：AUTH-001～AUTH-010（TC-111～TC-120，TC-114／TC-115 已有 carrier）喺真 app、真 HTTP、真 MySQL。
 *
 * Route 清單唔係抄落嚟嘅：讀 app 啟動時寫落 system log 嘅 `api.registration.completed`（實際註冊咗嘅 route），
 * 再同下面 CONTRACT（設計 §3.2、§6 加已批准嘅偏離）逐條對。咁新加一條 Supplier route 而冇入 CONTRACT 就會紅。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Sec-T51-Password!";
const MISSING = 999_999_999;
const h = { application: null, url: "", db: null, jwt: null, binding: null, logRoot: "", routes: [], users: {},
  supplierIds: [], roleIds: [], userIds: [], jobIds: [], fixture: {} };

const V = "supplier.view";
const M = "supplier.mgmt";
const A = "supplier.approval";
const BV = "supplier.bank.view";
const BM = "supplier.bank.mgmt";
const SET = "supplier.settings";
const J = "jwt";
const JP = "jwt-password";
const JDP = "jwt-device-password";

/**
 * 已批准嘅 Supplier API 契約：[authType, permissions, match]。來源係設計 §3.2／§6；設計表以外嘅 route 註明出處。
 */
const CONTRACT = Object.freeze({
  "GET /api/v1/suppliers": [J, [V]],
  "GET /api/v1/suppliers/:id": [J, [V]],
  "GET /api/v1/suppliers/:id/completeness": [J, [V]],
  "GET /api/v1/suppliers/:id/addresses": [J, [V]], // HD-107 G5
  "GET /api/v1/suppliers/:id/contacts": [J, [V]], // HD-107 G5
  "GET /api/v1/suppliers/:id/bank-accounts": [J, [V]],
  "GET /api/v1/suppliers/:id/sku-relations": [J, [V]],
  "POST /api/v1/suppliers/duplicates/check": [J, [M]],
  "POST /api/v1/suppliers/create": [J, [M]],
  "POST /api/v1/suppliers/:id/update": [J, [M]],
  "POST /api/v1/suppliers/:id/code/change": [JDP, [M]],
  "POST /api/v1/suppliers/:id/activate": [J, [M]],
  "POST /api/v1/suppliers/:id/suspend": [JP, [M]],
  "POST /api/v1/suppliers/:id/reactivate": [JP, [M]],
  "POST /api/v1/suppliers/:id/archive": [JP, [M]],
  "POST /api/v1/suppliers/:id/restore": [JP, [M]],
  "POST /api/v1/suppliers/:id/delete": [JDP, [M]],
  "POST /api/v1/suppliers/:supplierId/addresses/create": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/addresses/:addressId/update": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/addresses/:addressId/deactivate": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/contacts/create": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/contacts/:contactId/update": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/contacts/:contactId/deactivate": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/identifiers/create": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/update": [J, [M]],
  "POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/delete": [J, [M]],
  "GET /api/v1/supplier-approvals": [J, [V, A]],
  "GET /api/v1/supplier-approvals/:id": [J, [V, A]],
  "GET /api/v1/supplier-approvers": [J, [M, A], "any"],
  // 設計 §6.4 嘅 submit 由 activate 做（HD-020）；withdraw 喺 handlers/suppliers/。
  "POST /api/v1/suppliers/:id/approval/withdraw": [J, [M]],
  "POST /api/v1/supplier-approvals/:id/approve": [JP, [V, A]],
  "POST /api/v1/supplier-approvals/:id/reject": [JP, [V, A]],
  "POST /api/v1/supplier-approvals/:id/reassign": [JP, [V, A]],
  "POST /api/v1/suppliers/:id/block": [JDP, [V, A]],
  "POST /api/v1/suppliers/:id/unblock": [JDP, [V, A]],
  "POST /api/v1/suppliers/:id/bank-accounts/create": [JDP, [V, BV, BM]],
  "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/update": [JDP, [V, BV, BM]],
  "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/default": [JDP, [V, BV, BM]],
  "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/deactivate": [JDP, [V, BV, BM]],
  "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal": [JP, [V, BV]],
  "GET /api/v1/supplier-settings": [J, [SET]],
  "POST /api/v1/supplier-settings/update": [JDP, [SET]],
  // Settings 頁嘅 Business Master readiness（REV-028／REV-029）。
  "GET /api/v1/supplier-lookups/business-master": [J, [SET]],
  // 啟用前睇審批設定：建立者、審批人、設定管理員都要知（REV-030）。
  "GET /api/v1/supplier-lookups/activation-policy": [J, [M, A, SET], "any"],
  // SKU relation 編輯揀 SKU（integration_contracts.md）。
  "GET /api/v1/supplier-lookups/skus": [J, [M]],
  // 設計寫「呼叫方採購權限」；Purchasing 未有權限，暫時閘 supplier.view（HD-094 1A）。
  "GET /api/v1/supplier-lookups/for-sku/:skuId": [J, [V]],
  "POST /api/v1/suppliers/:id/sku-relations/create": [J, [M]],
  "POST /api/v1/suppliers/:id/sku-relations/:relationId/update": [J, [M]],
  "GET /api/v1/supplier-imports/template": [J, [M]],
  "POST /api/v1/supplier-imports/upload": [J, [M]],
  "GET /api/v1/supplier-imports": [J, [M]],
  "GET /api/v1/supplier-imports/:id": [J, [M]],
  "POST /api/v1/supplier-imports/:id/confirm": [JP, [M]],
  "POST /api/v1/supplier-imports/:id/cancel": [J, [M]],
  "GET /api/v1/supplier-imports/:id/result": [J, [M]],
  // 設計寫 GET；密碼要喺 body，所以係 POST（HD-067 1A）。
  "POST /api/v1/supplier-exports": [JP, [M]],
  "GET /api/v1/supplier-audit/logs": [J, [V]]
});

// 設計 06 §2 嘅測試角色。Purchasing 未有自己嘅權限（HD-094 1A），U-PO 用一個同 Supplier 無關嘅權限代表。
const PERSONAS = Object.freeze({
  "U-VIEW": [V],
  "U-MGMT": [V, M],
  "U-APR": [V, A],
  "U-BANK-R": [V, BV],
  "U-BANK-W": [V, BV, BM],
  "U-SET": [SET],
  "U-SYS": [V, M, A, BV, BM, SET],
  "U-PO": ["inventory.view"]
});

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-security-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const { discoverServiceDefinitions } = await import("../../src/framework/services/serviceDiscovery.js");
  const source = defaultConfigurationSource();
  // 背景工作會改 supplier_* 表，令「冇副作用」嘅 checksum 唔可靠；淨係留 tokenRevocation.refresh（設定要求）。
  const jobs = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 },
      scheduler: { ...source.scheduler, jobs: Object.fromEntries(jobs.map((name) => [name,
        { ...(source.scheduler.jobs?.[name] ?? {}), enabled: name === "tokenRevocation.refresh" }])) },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } },
    serviceDiscoveryOptions: { additionalModuleUrls: [
      new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
      new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] }
  });
  h.db = h.application.services.require("mysqldatabase");
  h.jwt = h.application.services.require("jwt");
  h.binding = h.application.services.require("deviceBinding");
  ({ url: h.url } = await h.application.start());
  h.routes = await registeredSupplierRoutes();
  for (const [label, permissions] of Object.entries(PERSONAS)) h.users[label] = await makeUser(label, permissions);
  await seedFixture();
});

after(async () => {
  if (!h.db) return;
  for (const id of h.jobIds) await h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [id]);
  for (const id of h.supplierIds) {
    for (const table of ["supplier_contact_purposes", "supplier_contacts", "supplier_address_purposes", "supplier_addresses",
      "supplier_identifiers", "supplier_bank_accounts", "supplier_audit_logs"]) {
      await h.db.execute(`DELETE FROM ${table} WHERE supplier_id = ?`, [id]);
    }
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  for (const id of h.userIds) {
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [id]);
    await h.db.execute("DELETE FROM user_devices WHERE user_id = ?", [id]);
    await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [id]);
    await h.db.execute("DELETE FROM users WHERE id = ?", [id]);
  }
  for (const id of h.roleIds) {
    await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [id]);
    await h.db.execute("DELETE FROM roles WHERE id = ?", [id]);
  }
  await h.application.shutdown("test");
  fs.rmSync(h.logRoot, { recursive: true, force: true });
});

async function registeredSupplierRoutes() {
  const directory = path.join(h.logRoot, "system");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const file of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
      const line = fs.readFileSync(path.join(directory, file), "utf8").split("\n").find((entry) => entry.includes("\"api.registration.completed\""));
      if (line) {
        return JSON.parse(line).context.registeredApis
          .filter((api) => api.path.startsWith("/api/v1/supplier"))
          .map((api) => ({ key: `${api.method.toUpperCase()} ${api.path}`, method: api.method.toUpperCase(), path: api.path,
            authType: api.authType, policies: api.authorizationPolicies, idempotent: api.idempotency?.enabled === true }));
      }
    }
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error("api.registration.completed never reached the system log");
}

async function makeUser(label, permissions) {
  const now = Date.now();
  const name = `sec51-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [name, now]);
  const roleId = Number(role.insertId);
  h.roleIds.push(roleId);
  for (const permission of permissions) {
    const [[row]] = await h.db.query("SELECT id FROM permissions WHERE name = ?", [permission]);
    await h.db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, row.id]);
  }
  const passwordHash = await (await import("../../src/modules/user/passwordHash.js")).hashPassword(PASSWORD);
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [name, passwordHash, `Sec ${label}`, now, now]);
  const userId = Number(user.insertId);
  h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  // 每個角色都有一部已核准設備：咁 jwt-device-password 嘅結果只取決於權限，唔係因為冇設備。
  const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
  const deviceId = h.binding.deviceIdFor(spki);
  await h.binding.requestBinding({ userId, deviceId, publicKeyDer: spki, label: `sec51-${label}` });
  await h.db.execute("UPDATE user_devices SET status = 'approved' WHERE user_id = ? AND device_id = ?", [userId, deviceId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [name], permissions, did: deviceId },
    { subject: String(userId), version, authTime: Math.floor(now / 1000) });
  return { label, userId, username: name, token, permissions, keyPair, deviceId };
}

function bankService() {
  const crypto = new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
    lookup: h.application.services.config.supplier.bankLookup });
  return new SupplierBankService({
    database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto,
    authorize: async () => ({ id: null, username: "sec51-seed", permissions: [V, BV, BM] }),
    audit: { async record() {} }
  });
}

async function seedSupplier(code, name, status = "active") {
  const now = Date.now();
  const [inserted] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', ?, ?, ?)`, [code, code.toLowerCase(), name, name.toLowerCase(), status, now, now]);
  const id = Number(inserted.insertId);
  h.supplierIds.push(id);
  return id;
}

async function seedFixture() {
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const supplierId = await seedSupplier(`SEC-${tag}`, `Security Fixture ${tag}`);
  const otherId = await seedSupplier(`SEO-${tag}`, `Other Supplier ${tag}`);
  const now = Date.now();
  const [address] = await h.db.execute("INSERT INTO supplier_addresses (supplier_id, label, status, created_at, updated_at) VALUES (?, 'HQ', 'active', ?, ?)",
    [supplierId, now, now]);
  const [contact] = await h.db.execute("INSERT INTO supplier_contacts (supplier_id, name, status, created_at, updated_at) VALUES (?, 'Amy', 'active', ?, ?)",
    [supplierId, now, now]);
  const [identifier] = await h.db.execute(
    `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
     VALUES (?, 'business_registration', 'HK', ?, ?, ?, ?)`, [supplierId, `BR${tag}`, `BR${tag}`, now, now]);
  const account = `61${String(Date.now()).slice(-10)}`;
  const bank = await bankService().create({ actorId: null, claimedRoles: [], claimedPermissions: [], supplierId, accountHolderName: `Holder ${tag}`,
    bankName: `Bank ${tag}`, bankCountryCode: "HK", bankCode: "999", branchCode: "001", swiftBic: "EXAMPLEHH", accountCurrencyCode: "HKD",
    accountNumber: account, isDefault: true, reason: "T51 security seed" });
  const [[stored]] = await h.db.query(
    `SELECT HEX(account_ciphertext) AS cipherHex, TO_BASE64(account_ciphertext) AS cipherB64, HEX(account_blind_index) AS indexHex,
            TO_BASE64(account_blind_index) AS indexB64, encryption_key_id AS keyId, blind_index_key_id AS indexKeyId, crypto_context AS context
       FROM supplier_bank_accounts WHERE id = ?`, [bank.id]);
  h.fixture = { tag, supplierId, otherId, addressId: Number(address.insertId), contactId: Number(contact.insertId),
    identifierId: Number(identifier.insertId), bankId: bank.id, account, stored };
}

/** Path 參數：`ids` 冇提供嘅一律填一個唔存在嘅 ID。 */
function fill(routePath, ids = {}) {
  return routePath.replace(/:([A-Za-z]+)/gu, (_, name) => String(ids[name] ?? MISSING));
}

function existingIds() {
  const f = h.fixture;
  return { id: f.supplierId, supplierId: f.supplierId, addressId: f.addressId, contactId: f.contactId, identifierId: f.identifierId,
    bankAccountId: f.bankId };
}

/**
 * 發一個請求。POST 預設 body `{}`；route 要密碼就補 `password`，要設備就用該角色嘅設備簽。
 * `password: false`／`device: false` 用嚟測降級。
 */
async function send(user, route, { ids, body, password = true, device = true, raw, contentType = "application/json", headers = {} } = {}) {
  const requestPath = fill(route.path, ids);
  const request = { method: route.method, headers: { ...headers } };
  if (user) request.headers.authorization = `Bearer ${user.token}`;
  if (route.idempotent) request.headers["idempotency-key"] = randomUUID();
  if (route.method === "POST") {
    let payload = body ?? {};
    if (password && (route.authType === JP || route.authType === JDP) && payload && typeof payload === "object" && !Array.isArray(payload)) {
      payload = { password: PASSWORD, ...payload };
    }
    request.body = raw ?? JSON.stringify(payload);
    request.headers["content-type"] = contentType;
    if (user && device && route.authType === JDP) {
      const nonce = randomUUID();
      const timestamp = Date.now();
      const input = h.binding.signingInput({
        accessTokenHash: h.binding.accessTokenHash(user.token), bodyHash: h.binding.bodyHash(Buffer.from(request.body)),
        deviceId: user.deviceId, method: "POST", nonce, path: requestPath, timestamp });
      const signature = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, user.keyPair.privateKey, Buffer.from(input)))
        .toString("base64url");
      Object.assign(request.headers, { "X-Device-Id": user.deviceId, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce,
        "X-Device-Signature": signature });
    }
  }
  const response = await fetch(`${h.url}${requestPath}`, request);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV 或者空 */ }
  return { status: response.status, code: json?.error?.code ?? null, message: json?.error?.message ?? null, json, text,
    headers: response.headers };
}

function allowed(route, permissions) {
  const [, required, match] = CONTRACT[route.key];
  return match === "any" ? required.some((p) => permissions.includes(p)) : required.every((p) => permissions.includes(p));
}

/** 所有 supplier_* 表嘅 checksum：一個請求有冇寫過任何嘢。 */
async function snapshot() {
  const [tables] = await h.db.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'supplier\\_%' ORDER BY table_name");
  const [rows] = await h.db.query(`CHECKSUM TABLE ${tables.map(({ name }) => `\`${name}\``).join(", ")}`);
  return Object.fromEntries(rows.map((row) => [row.Table, String(row.Checksum)]));
}

function route(key) {
  const found = h.routes.find((candidate) => candidate.key === key);
  assert.ok(found, `${key} is registered`);
  return found;
}

integrationTest("TC-111 (AUTH-001): every registered Supplier route refuses an anonymous or forged caller, writes nothing, and answers alike for existing and missing IDs", async () => {
  assert.deepEqual(h.routes.map((r) => r.key).sort(), Object.keys(CONTRACT).sort(), "the runtime route set is exactly the contract");
  const forged = { token: `${h.users["U-SYS"].token.slice(0, -4)}AAAA` };
  const before = await snapshot();
  for (const r of h.routes) {
    const results = [];
    for (const caller of [null, forged]) {
      for (const ids of [existingIds(), {}]) {
        const response = await send(caller, r, { ids, password: false, device: false });
        results.push(`${response.status} ${response.code} ${response.message}`);
      }
    }
    assert.equal(results[0].split(" ")[0], "401", `${r.key} anonymous`);
    assert.equal(new Set(results).size, 1, `${r.key}: anonymous and forged callers get one answer whether the target exists or not: ${results}`);
  }
  assert.deepEqual(await snapshot(), before, "no Supplier table changed");
});

integrationTest("TC-112 (AUTH-002): the route-by-role matrix grants exactly the specified permission combinations", async () => {
  const before = await snapshot();
  const mismatches = [];
  const denialCodes = new Set();
  for (const r of h.routes) {
    for (const [label, user] of Object.entries(h.users)) {
      // 匯出嘅 body 冇必填欄，`{}` 會真係匯出（一個有 audit 嘅讀取）；畀一個非法 filter，令佢停喺驗證。
      const response = await send(user, r, r.key === "POST /api/v1/supplier-exports" ? { body: { filters: { notAFilter: true } } } : {});
      const expected = allowed(r, user.permissions);
      if (expected && (response.status === 401 || response.status === 403)) mismatches.push(`${label} ${r.key}: refused ${response.status} ${response.code}`);
      if (!expected && response.status !== 403) mismatches.push(`${label} ${r.key}: expected 403, got ${response.status} ${response.code}`);
      if (!expected) denialCodes.add(response.code);
    }
  }
  assert.deepEqual(mismatches, []);
  assert.equal(denialCodes.size, 1, `one stable refusal code: ${[...denialCodes]}`);
  // 設計明文嘅幾條：mgmt 唔包 approval／Bank／settings；Bank 寫要三個權限；審批要 view＋approval。
  assert.equal(allowed(route("POST /api/v1/supplier-approvals/:id/approve"), PERSONAS["U-MGMT"]), false);
  assert.equal(allowed(route("POST /api/v1/suppliers/:id/bank-accounts/create"), PERSONAS["U-BANK-R"]), false);
  assert.equal(allowed(route("POST /api/v1/suppliers/:id/bank-accounts/create"), PERSONAS["U-BANK-W"]), true);
  assert.equal(allowed(route("GET /api/v1/supplier-settings"), PERSONAS["U-MGMT"]), false);
  assert.equal(allowed(route("GET /api/v1/supplier-approvals"), [A]), false, "approval without view is not enough");
  // 全部嘅請求都用唔存在嘅 ID，獲准嘅都停喺驗證或者 404：
  assert.deepEqual(await snapshot(), before, "no Supplier table changed");
});

integrationTest("TC-113 (AUTH-003): a Purchasing caller gets only the minimal provider projection and no Supplier admin, reveal or Settings access", async () => {
  const purchasing = h.users["U-PO"];
  const fixture = existingIds();
  for (const key of ["GET /api/v1/suppliers/:id", "POST /api/v1/suppliers/:id/update", "POST /api/v1/suppliers/create",
    "POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal", "GET /api/v1/suppliers/:id/bank-accounts",
    "GET /api/v1/supplier-settings", "POST /api/v1/supplier-settings/update", "GET /api/v1/supplier-audit/logs", "POST /api/v1/supplier-exports"]) {
    const response = await send(purchasing, route(key), { ids: fixture });
    assert.equal(response.status, 403, `${key}: ${response.status} ${response.code}`);
  }
  const provider = h.application.services.require("supplierCoreProvider");
  const projection = await provider.findById(h.fixture.supplierId, { purpose: "purchase" });
  assert.deepEqual(Object.keys(projection).sort(), ["defaultCurrencyCode", "defaultPaymentTermId", "displayName", "reasons", "status",
    "supplierCode", "supplierId", "supplierName", "usable", "version"]);
  const serialized = JSON.stringify(projection);
  for (const secret of [h.fixture.account, h.fixture.account.slice(-4), `Holder ${h.fixture.tag}`, `Bank ${h.fixture.tag}`]) {
    assert.ok(!serialized.includes(secret), `the projection carries no Bank data (${secret})`);
  }
  // 用過 provider 之後，佢嘅 token 都冇多咗任何 Supplier 權限：
  assert.equal((await send(purchasing, route("GET /api/v1/suppliers"))).status, 403);
});

integrationTest("TC-116 (AUTH-006): authType is fixed in metadata as specified, and a weaker credential or a payload cannot lower it", async () => {
  const drift = [];
  for (const r of h.routes) {
    const [authType, permissions, match = "all"] = CONTRACT[r.key];
    const policy = r.policies.find((p) => p.name === "hasPermission");
    const actual = [r.authType, [...(policy?.options.permissions ?? [])].sort(), policy?.options.match ?? "all"];
    const expected = [authType, [...permissions].sort(), match];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) drift.push(`${r.key}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  assert.deepEqual(drift, []);

  // 錯密碼會觸發重新認證嘅鎖定，所以用一個專用嘅全權用戶，唔好連累其他 case 用 U-SYS。
  const admin = await makeUser("U-SYS-REAUTH", PERSONAS["U-SYS"]);
  const before = await snapshot();
  const strong = h.routes.filter((r) => r.authType === JP || r.authType === JDP);
  assert.equal(strong.length, Object.values(CONTRACT).filter(([authType]) => authType !== J).length);
  const accepted = [];
  for (const r of strong) {
    const attempts = [
      ["no password", { password: false }],
      ["wrong password", { password: false, body: { password: "Not-The-Password-1!" } }],
      ["null password", { password: false, body: { password: null } }],
      ["authType in body", { password: false, body: { authType: "jwt" } }],
      ["authType header", { password: false, headers: { "x-auth-type": "jwt" } }]
    ];
    if (r.authType === JDP) attempts.push(["password without device", { device: false }]);
    for (const [name, options] of attempts) {
      const response = await send(admin, r, options);
      // 認證失敗嘅答案：唔可以去到 schema 驗證（REQUEST_VALIDATION_FAILED）或者業務（404 等）。
      if (![400, 401, 403].includes(response.status) || response.code === "REQUEST_VALIDATION_FAILED") {
        accepted.push(`${r.key} ${name}: ${response.status} ${response.code}`);
      }
    }
  }
  assert.deepEqual(accepted, []);
  // U-SYS 有齊六個權限，但 Bank reveal 照樣要密碼（上面「no password」已經包括 reveal）：
  assert.ok(strong.some((r) => r.key.endsWith("/reveal")));
  assert.deepEqual(await snapshot(), before, "no Supplier table changed");
});

integrationTest("TC-117 (AUTH-007): every API class refuses malformed, mistyped, out-of-range or extra input with a stable 400 and writes nothing; IDs are positive integers and booleans are strict", async () => {
  // HD-109 A：每條帶 JSON body 嘅 Supplier POST route 都唔轉型（multipart upload 除外，佢嘅欄位本身係字串）。
  const handlers = [];
  for (const directory of ["supplier-approvals", "supplier-exports", "supplier-imports", "supplier-settings", "suppliers"]) {
    const folder = new URL(`../../src/handlers/${directory}/`, import.meta.url);
    for (const file of fs.readdirSync(folder).filter((name) => name.endsWith(".js"))) {
      for (const exported of Object.values(await import(new URL(file, folder).href))) {
        if (typeof exported === "function" && exported.api?.method === "POST") handlers.push(exported.api);
      }
    }
  }
  const posts = h.routes.filter((r) => r.method === "POST");
  assert.equal(handlers.length, posts.length, "every registered POST route has a handler here");
  assert.deepEqual(handlers.filter((api) => api.upload?.enabled !== true && api.inputCoercion !== false).map((api) => api.path), []);

  const mgmt = h.users["U-MGMT"];
  const f = h.fixture;
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const create = route("POST /api/v1/suppliers/create");
  const valid = { supplierCode: `T117-${tag}`, supplierName: "Valid", defaultCurrencyCode: "HKD" };
  const update = { version: 1, supplierName: "x", displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "",
    generalPhone: "", generalEmail: "", notes: "" };
  const list = route("GET /api/v1/suppliers");
  const detail = route("GET /api/v1/suppliers/:id");
  const query = (search) => ({ ...list, path: `/api/v1/suppliers?${search}` });
  const before = await snapshot();
  const cases = [
    // 列表 query：越界、錯型、未知 enum、多餘參數、唔係 "true"／"false" 嘅 boolean。
    ...["page=0", "page=-1", "page=abc", "page=1.5", "pageSize=0", "pageSize=101", "sortBy=bogus", "status=bogus", "bogus=1",
      "includeArchived=yes", "includeArchived=1", "includeArchived=TRUE", "missingBank=0", "paymentTermId=0", "currencyCode=hkd"]
      .map((search) => [`list ?${search}`, mgmt, query(search), {}]),
    // Path ID：只收正整數。
    ...["0", "-1", "1.5", "abc", "+5", "05", "1e3", "99999999999999999999"].map((id) => [`detail /${id}`, mgmt, detail, { ids: { id } }]),
    ["child id 0", mgmt, route("POST /api/v1/suppliers/:supplierId/addresses/:addressId/deactivate"), { ids: { supplierId: f.supplierId, addressId: 0 }, body: { version: 1 } }],
    ["import id abc", mgmt, route("POST /api/v1/supplier-imports/:id/cancel"), { ids: { id: "abc" }, body: { version: 1 } }],
    ["import id 16 digits", mgmt, route("POST /api/v1/supplier-imports/:id/cancel"), { ids: { id: "1234567890123456" }, body: { version: 1 } }],
    // JSON body：壞 JSON、唔係 object、錯 content-type、多餘欄、缺欄、null、錯型、超長。
    ["malformed JSON", mgmt, create, { raw: "{\"supplierCode\":" }],
    ["array body", mgmt, create, { body: [] }],
    ["text/plain", mgmt, create, { raw: JSON.stringify(valid), contentType: "text/plain" }],
    ["form-encoded", mgmt, create, { raw: "supplierCode=X&supplierName=Y&defaultCurrencyCode=HKD", contentType: "application/x-www-form-urlencoded" }],
    ["additional property", mgmt, create, { body: { ...valid, isAdmin: true } }],
    ["missing required", mgmt, create, { body: { supplierCode: valid.supplierCode } }],
    ["null name", mgmt, create, { body: { ...valid, supplierName: null } }],
    ["number as name", mgmt, create, { body: { ...valid, supplierName: 12345 } }],
    ["boolean as notes", mgmt, create, { body: { ...valid, notes: true } }],
    ["name too long", mgmt, create, { body: { ...valid, supplierName: "x".repeat(191) } }],
    ["currency enum", mgmt, create, { body: { ...valid, defaultCurrencyCode: "hkd" } }],
    ["term id as string", mgmt, create, { body: { ...valid, defaultPaymentTermId: "1" } }],
    ["term id 0", mgmt, create, { body: { ...valid, defaultPaymentTermId: 0 } }],
    ["term id 1.5", mgmt, create, { body: { ...valid, defaultPaymentTermId: 1.5 } }],
    ...[1, 0, "true", "1", "yes", null, []].map((value) => [`activate ${JSON.stringify(value)}`, mgmt, create, { body: { ...valid, activate: value } }]),
    ["update version string", mgmt, route("POST /api/v1/suppliers/:id/update"), { ids: { id: f.supplierId }, body: { ...update, version: "1" } }],
    ["update version 0", mgmt, route("POST /api/v1/suppliers/:id/update"), { ids: { id: f.supplierId }, body: { ...update, version: 0 } }],
    ["update version -1", mgmt, route("POST /api/v1/suppliers/:id/update"), { ids: { id: f.supplierId }, body: { ...update, version: -1 } }],
    ["archive version string", mgmt, route("POST /api/v1/suppliers/:id/archive"), { ids: { id: f.supplierId }, body: { version: "1", reason: "TC-117 archive" } }],
    ["identifier enum", mgmt, route("POST /api/v1/suppliers/:supplierId/identifiers/create"), { ids: { supplierId: f.supplierId },
      body: { identifierType: "passport_of_mars", issuerCountryCode: "HK", identifierValue: "X1" } }],
    ["export boolean string", h.users["U-SYS"], route("POST /api/v1/supplier-exports"), { body: { filters: { missingBank: "true" } } }],
    ["export id string", h.users["U-SYS"], route("POST /api/v1/supplier-exports"), { body: { filters: { paymentTermId: "1" } } }]
  ];
  const wrong = [];
  for (const [name, user, r, options] of cases) {
    const response = await send(user, r, options);
    if (response.status !== 400 || !["REQUEST_VALIDATION_FAILED", "INVALID_JSON"].includes(response.code)) {
      wrong.push(`${name}: ${response.status} ${response.code}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.deepEqual(await snapshot(), before, "nothing was written, partially or otherwise");

  // 同一個 body 用啱嘅型就收：上面嘅 400 唔係因為 route 本身壞咗。
  const made = await send(mgmt, create, { body: { ...valid, activate: false } });
  assert.equal(made.status, 201, made.text);
  h.supplierIds.push(made.json.data.id);
  assert.equal(made.json.data.status, "draft");
  const cancelled = await send(mgmt, route("POST /api/v1/supplier-imports/:id/cancel"), { ids: { id: MISSING }, body: { version: 1 } });
  assert.equal(cancelled.status, 404, `a well-formed import ID reaches the service: ${cancelled.text}`);
});

integrationTest("TC-118 (AUTH-008): only the reveal response carries the plaintext, under no-store; other projections carry no internal keys; export and reveal leave a low-sensitivity audit", async () => {
  const f = h.fixture;
  const ids = existingIds();
  const admin = h.users["U-SYS"];
  const reveal = await send(h.users["U-BANK-R"], route("POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal"),
    { ids, body: { reason: "TC-118 reveal check" } });
  assert.equal(reveal.status, 200, reveal.text);
  assert.ok(reveal.text.includes(f.account), "reveal returns the account number");
  assert.match(reveal.headers.get("cache-control") ?? "", /no-store/u);
  // `private` 去唔到線上（框架 sendSuccess 覆寫成 no-store）；Product Owner 2026-09-21 接受偏離，見 supplierBankHandlers.js。
  const exported = await send(admin, route("POST /api/v1/supplier-exports"), { body: { filters: { q: f.tag } } });
  assert.equal(exported.status, 200, exported.text);

  const markers = [f.account, f.stored.cipherHex, f.stored.cipherB64, f.stored.indexHex, f.stored.indexB64, f.stored.keyId, f.stored.indexKeyId,
    f.stored.context, "ciphertext", "blindIndex", "blind_index", "authTag", "auth_tag", "cryptoContext", "crypto_context", "encryptionKeyId",
    "encryption_key_id", "password_hash", "passwordHash"];
  const scanned = [
    ["list", await send(admin, route("GET /api/v1/suppliers"), { ids })],
    ["detail", await send(admin, route("GET /api/v1/suppliers/:id"), { ids })],
    ["completeness", await send(admin, route("GET /api/v1/suppliers/:id/completeness"), { ids })],
    ["bank list (U-VIEW)", await send(h.users["U-VIEW"], route("GET /api/v1/suppliers/:id/bank-accounts"), { ids })],
    ["bank list (U-BANK-W)", await send(h.users["U-BANK-W"], route("GET /api/v1/suppliers/:id/bank-accounts"), { ids })],
    ["approvals", await send(admin, route("GET /api/v1/supplier-approvals"))],
    ["audit", await send(admin, { ...route("GET /api/v1/supplier-audit/logs"), path: `/api/v1/supplier-audit/logs?supplierId=${f.supplierId}&pageSize=100` })],
    ["export audit", await send(admin, { ...route("GET /api/v1/supplier-audit/logs"), path: "/api/v1/supplier-audit/logs?action=supplier.export&pageSize=5" })],
    ["export csv", exported],
    ["404", await send(admin, route("GET /api/v1/suppliers/:id"), { ids: { id: MISSING } })],
    ["403", await send(h.users["U-VIEW"], route("POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal"), { ids, body: { reason: "TC-118 refused" } })]
  ];
  for (const [name, response] of scanned) {
    assert.ok(response.status < 500, `${name}: ${response.status}`);
    const surface = `${response.text}\n${JSON.stringify([...response.headers])}`;
    for (const marker of markers) assert.ok(!surface.includes(marker), `${name} leaks ${marker}`);
  }
  const bankList = scanned.find(([name]) => name === "bank list (U-VIEW)")[1];
  assert.equal(bankList.status, 200);
  assert.ok(bankList.text.includes(f.account.slice(-4)), "the masked list still shows the last four");

  const [audits] = await h.db.query(
    `SELECT action, CAST(detail AS CHAR) AS detail FROM supplier_audit_logs
      WHERE (action = 'supplier.bank.reveal' AND target_id = ?) OR (action = 'supplier.export' AND actor_user_id = ?)`, [f.bankId, admin.userId]);
  assert.deepEqual([...new Set(audits.map((a) => a.action))].sort(), ["supplier.bank.reveal", "supplier.export"]);
  for (const audit of audits) for (const marker of markers) assert.ok(!(audit.detail ?? "").includes(marker), `${audit.action} audit holds ${marker}`);
});

integrationTest("TC-119 (AUTH-009): script and HTML are stored and returned as plain text, control characters are refused, and prototype keys neither pollute nor pass", async () => {
  const create = route("POST /api/v1/suppliers/create");
  const mgmt = h.users["U-MGMT"];
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const script = "<script>alert(1)</script>";
  const html = "<img src=x onerror=alert(1)>";
  const made = await send(mgmt, create, { body: { supplierCode: `XSS-${tag}`, supplierName: script, displayName: html, defaultCurrencyCode: "HKD",
    notes: "a‮b" } });
  assert.equal(made.status, 201, made.text);
  h.supplierIds.push(made.json.data.id);
  const detail = await send(mgmt, route("GET /api/v1/suppliers/:id"), { ids: { id: made.json.data.id } });
  assert.equal(detail.json.data.supplierName, script);
  assert.equal(detail.json.data.displayName, html);
  assert.match(detail.headers.get("content-type"), /^application\/json/u);
  assert.equal(detail.headers.get("x-content-type-options"), "nosniff");

  for (const [field, value] of [["supplierName", "x\u0000y"], ["supplierName", "x\u0007y"], ["supplierCode", `C\u001b${tag}`]]) {
    const refused = await send(mgmt, create, { body: { supplierCode: `CTL-${tag}`, supplierName: "ok", defaultCurrencyCode: "HKD", [field]: value } });
    assert.equal(refused.status, 400, `${field} ${JSON.stringify(value)}: ${refused.text}`);
  }

  const before = await snapshot();
  const polluting = [
    `{"__proto__":{"polluted":true},"supplierCode":"PP1-${tag}","supplierName":"ok","defaultCurrencyCode":"HKD"}`,
    JSON.stringify({ supplierCode: `PP2-${tag}`, supplierName: "ok", defaultCurrencyCode: "HKD", constructor: { prototype: { polluted: true } } }),
    JSON.stringify({ supplierCode: `PP3-${tag}`, supplierName: "ok", defaultCurrencyCode: "HKD", prototype: { polluted: true } })
  ];
  for (const raw of polluting) {
    const refused = await send(mgmt, create, { raw });
    assert.equal(refused.status, 400, refused.text);
    assert.equal(refused.code, "REQUEST_VALIDATION_FAILED");
    assert.ok(!refused.text.includes("polluted"), "the refusal does not echo the payload");
  }
  assert.equal({}.polluted, undefined, "Object.prototype untouched in the server process");
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(await snapshot(), before);

  const update = await send(mgmt, route("POST /api/v1/suppliers/:id/update"), { ids: { id: made.json.data.id },
    body: { version: 1, supplierName: `${script}x\u0000` } });
  assert.equal(update.status, 400);
  assert.ok(!update.text.includes("<script>"), "a refusal does not reflect the submitted markup");
});

integrationTest("TC-120 (AUTH-010): each error class answers with its stable HTTP status and code, and never SQL, constraint names, secrets or another Supplier's data", async () => {
  const f = h.fixture;
  const mgmt = h.users["U-MGMT"];
  const admin = h.users["U-SYS"];
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const create = route("POST /api/v1/suppliers/create");
  const config = h.application.services.config;

  // 同 Code 並發 create：create 喺 transaction 入面先查後寫，所以係應用層嘅 409，唔係 DB 嘅 ER_DUP_ENTRY
  // （拎走 ER_DUP_ENTRY 映射呢度照樣綠，已經試過）。ER_DUP_ENTRY 由下面 identifier 嗰個 case 撞。
  const racers = await Promise.all(Array.from({ length: 6 }, () => send(mgmt, create,
    { body: { supplierCode: `DUP-${tag}`, supplierName: `Dup ${tag}`, defaultCurrencyCode: "HKD" } })));
  for (const made of racers.filter((r) => r.status === 201)) h.supplierIds.push(made.json.data.id);
  assert.equal(racers.filter((r) => r.status === 201).length, 1, racers.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(racers.filter((r) => r.status === 409).every((r) => r.code === "SUPPLIER_CODE_TAKEN"));

  // 名稱空白：最低欄位唔齊，啟用要 422（一個有 Code、名同幣別嘅 Draft 係啟用得嘅）。
  const draft = await seedSupplier(`DRF-${tag}`, "", "draft");
  const [job] = await h.db.execute(
    `INSERT INTO supplier_import_jobs (template_version, source_stored_name, source_sha256, mode, status, created_by, created_at, updated_at,
       confirmed_at, completed_at, files_purged_at)
     VALUES ('v1', ?, UNHEX(SHA2('x', 256)), 'create', 'completed', ?, ?, ?, ?, ?, ?)`,
    [randomUUID().replace(/-/gu, "").padEnd(64, "0"), mgmt.userId, Date.now(), Date.now(), Date.now(), Date.now(), Date.now()]);
  h.jobIds.push(Number(job.insertId));
  const [[second]] = await h.db.query("SELECT id FROM supplier_bank_accounts WHERE supplier_id = ? LIMIT 1", [f.supplierId]);
  await h.db.execute("UPDATE supplier_bank_accounts SET encryption_key_id = 'tc120-retired-key' WHERE id = ?", [second.id]);
  try {
    const cases = [
      [400, "REQUEST_VALIDATION_FAILED", await send(mgmt, create, { body: { supplierCode: `BAD-${tag}` } })],
      [400, "SUPPLIER_NAME_INVALID", await send(mgmt, create, { body: { supplierCode: `BAD-${tag}`, supplierName: "x\u0000", defaultCurrencyCode: "HKD" } })],
      [403, null, await send(h.users["U-VIEW"], create, { body: { supplierCode: `BAD-${tag}` } })],
      [404, "SUPPLIER_NOT_FOUND", await send(mgmt, route("GET /api/v1/suppliers/:id"), { ids: { id: MISSING } })],
      // 每類 child 一個 code，唔係設計 §6.11 嘅 SUPPLIER_CHILD_NOT_FOUND（HD-110 A，接受偏離）。
      // 用另一個 Supplier 嘅 route 掂呢個 Supplier 嘅 child：答案同唔存在一樣，唔講屬於邊個。
      [404, "SUPPLIER_ADDRESS_NOT_FOUND", await send(mgmt, route("POST /api/v1/suppliers/:supplierId/addresses/:addressId/deactivate"),
        { ids: { supplierId: f.otherId, addressId: f.addressId }, body: { version: 1 } })],
      [404, "SUPPLIER_CONTACT_NOT_FOUND", await send(mgmt, route("POST /api/v1/suppliers/:supplierId/contacts/:contactId/deactivate"),
        { ids: { supplierId: f.otherId, contactId: f.contactId }, body: { version: 1 } })],
      [404, "SUPPLIER_IDENTIFIER_NOT_FOUND", await send(mgmt, route("POST /api/v1/suppliers/:supplierId/identifiers/:identifierId/delete"),
        { ids: { supplierId: f.otherId, identifierId: f.identifierId }, body: { version: 1, reason: "TC-120 other owner" } })],
      [409, "SUPPLIER_CODE_TAKEN", await send(mgmt, create, { body: { supplierCode: `SEC-${f.tag}`, supplierName: "x", defaultCurrencyCode: "HKD" } })],
      // 冇預檢：靠 DB unique 撞出 ER_DUP_ENTRY，再按 constraint 映射；唔可以講出另一個 Supplier 係邊個。
      [409, "SUPPLIER_IDENTIFIER_TAKEN", await send(mgmt, route("POST /api/v1/suppliers/:supplierId/identifiers/create"), { ids: { supplierId: f.otherId },
        body: { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `BR${f.tag}` } })],
      [409, "VERSION_CONFLICT", await send(mgmt, route("POST /api/v1/suppliers/:id/update"), { ids: { id: f.supplierId },
        body: { version: 99, supplierName: "x", displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, website: "", generalPhone: "", generalEmail: "", notes: "" } })],
      [410, "IMPORT_FILE_EXPIRED", await send(mgmt, route("GET /api/v1/supplier-imports/:id/result"), { ids: { id: Number(job.insertId) } })],
      [422, "SUPPLIER_NOT_ACTIVATABLE", await send(mgmt, route("POST /api/v1/suppliers/:id/activate"), { ids: { id: draft }, body: { version: 1 } })],
      [503, "BANK_KEY_UNAVAILABLE", await send(h.users["U-BANK-R"], route("POST /api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal"),
        { ids: { id: f.supplierId, bankAccountId: second.id }, body: { reason: "TC-120 retired key" } })]
    ];
    const forbidden = [/\bER_[A-Z_]+/u, /Duplicate entry/iu, /\bSELECT\b|\bINSERT\b|\bUPDATE\b.*\bSET\b/u, /\buq_[a-z_]+/u, /\bfk_[a-z_]+/u, /sqlMessage|sqlState/u,
      /tc120-retired-key/u, /Other Supplier/u, /Security Fixture/u, /stack|at [A-Za-z]+ \(/u];
    const secrets = [config.database?.password, config.jwt?.secret, process.env.DB_PASSWORD, process.env.SUPPLIER_BANK_ENCRYPTION_KEYS,
      process.env.SUPPLIER_BANK_LOOKUP_KEYS, f.account].filter((value) => typeof value === "string" && value.length >= 6);
    for (const [status, code, response] of [...cases, ...racers.filter((r) => r.status === 409).map((r) => [409, "SUPPLIER_CODE_TAKEN", r])]) {
      assert.equal(response.status, status, `${code}: ${response.text}`);
      if (code) assert.equal(response.code, code, response.text);
      for (const pattern of forbidden) assert.doesNotMatch(response.text, pattern, `${code} body`);
      for (const secret of secrets) assert.ok(!response.text.includes(secret), `${code} body holds a secret`);
    }
  } finally {
    await h.db.execute("UPDATE supplier_bank_accounts SET encryption_key_id = ? WHERE id = ?", [f.stored.keyId, second.id]);
  }
  void admin;
});
