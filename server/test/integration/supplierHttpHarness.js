import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";

export const PASSWORD = "Supplier-T51-Password!";
export const MISSING = 999_999_999;

/**
 * Supplier HTTP 驗收測試共用嘅 harness：真 app（真 HTTP、真 MySQL），每個角色有已核准設備，請求按 route 嘅 authType
 * 自動補密碼同設備簽名。Route 清單由 app 啟動時寫落 system log 嘅 `api.registration.completed` 讀，唔係抄落嚟。
 *
 * 用法：`const h = createSupplierHarness("sec51")`，`before(h.start)`、`after(h.stop)`。
 * `database` 蓋過 config/database.js 嘅欄位（例如連去一個還原咗嘅 scratch database）；`importRoot` 換走匯入檔目錄。
 * `h.supplierIds`／`h.jobIds` 入面嘅會喺 stop 清走（連 child、audit、審批申請）。
 */
export function createSupplierHarness(prefix, { database = {}, importRoot = null } = {}) {
  const h = {
    application: null, url: "", db: null, jwt: null, binding: null, worker: null, logRoot: "", routes: [],
    supplierIds: [], roleIds: [], userIds: [], jobIds: [],
    // 其他要清嘅行（例如 Item fixture）：[sql, params]，喺 Supplier 之後倒序執行。
    cleanup: []
  };

  h.start = async () => {
    h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-logs-`));
    const { createApplication } = await import("../../src/framework/application/createApplication.js");
    const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
    const { discoverServiceDefinitions } = await import("../../src/framework/services/serviceDiscovery.js");
    const source = defaultConfigurationSource();
    // 背景工作會改 supplier_* 表，令「冇副作用」嘅 checksum 唔可靠；淨係留 tokenRevocation.refresh（設定要求）。
    const jobs = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
    h.application = await createApplication({
      configurationSource: { ...source, application: { ...source.application, port: 0 }, database: { ...source.database, ...database },
        requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 },
        scheduler: { ...source.scheduler, jobs: Object.fromEntries(jobs.map((name) => [name,
          { ...(source.scheduler.jobs?.[name] ?? {}), enabled: name === "tokenRevocation.refresh" }])) },
        logging: { loggers: {
          request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
          system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } },
        // 匯入檔案放喺 log 目錄入面，stop 一齊刪；precheck／execute 工作同其他背景工作一樣停咗，由測試直接叫 h.worker。
        supplier: { ...source.supplier, import: { ...source.supplier.import, root: importRoot ?? path.join(h.logRoot, "imports") } } },
      serviceDiscoveryOptions: { additionalModuleUrls: [
        new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
        new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] }
    });
    h.db = h.application.services.require("mysqldatabase");
    h.jwt = h.application.services.require("jwt");
    h.binding = h.application.services.require("deviceBinding");
    h.worker = h.application.services.require("job.supplierImportWorker");
    ({ url: h.url } = await h.application.start());
    h.routes = await registeredSupplierRoutes();
  };

  h.stop = async () => {
    if (!h.db) return;
    try {
      await removeFixtures();
    } finally {
      // 刪唔到（例如行仲被鎖住）都要關 app，唔係 HTTP server 同連線池會令成個 process 吊住（REV-097 M-1）。
      await h.application.shutdown("test");
      fs.rmSync(h.logRoot, { recursive: true, force: true });
    }
  };

  async function removeFixtures() {
    for (const id of h.jobIds) {
      await h.db.execute("DELETE FROM supplier_import_rows WHERE job_id = ?", [id]);
      await h.db.execute("DELETE FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ?", [id]);
      await h.db.execute("DELETE FROM supplier_import_jobs WHERE id = ?", [id]);
    }
    for (const id of h.supplierIds) {
      for (const table of ["supplier_supply_events", "supplier_sku_refs", "supplier_activation_requests", "supplier_contact_purposes", "supplier_contacts", "supplier_address_purposes",
        "supplier_addresses", "supplier_identifiers", "supplier_bank_accounts", "supplier_name_grams", "supplier_audit_logs"]) {
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
    for (const [sql, params] of [...h.cleanup].reverse()) await h.db.execute(sql, params);
  }

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

  h.makeUser = async (label, permissions) => {
    const now = Date.now();
    const name = `${prefix}-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`;
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
      [name, passwordHash, `${prefix} ${label}`, now, now]);
    const userId = Number(user.insertId);
    h.userIds.push(userId);
    await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
    // 每個角色都有一部已核准設備：咁 jwt-device-password 嘅結果只取決於權限，唔係因為冇設備。
    const keyPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey));
    const deviceId = h.binding.deviceIdFor(spki);
    await h.binding.requestBinding({ userId, deviceId, publicKeyDer: spki, label: `${prefix}-${label}` });
    await h.db.execute("UPDATE user_devices SET status = 'approved' WHERE user_id = ? AND device_id = ?", [userId, deviceId]);
    const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
    const token = await h.jwt.issue({ roles: [name], permissions, did: deviceId },
      { subject: String(userId), version, authTime: Math.floor(now / 1000) });
    return { label, userId, username: name, token, permissions, keyPair, deviceId };
  };

  /** Bank 種資料用：真加密、真 blind index，但唔寫 audit。 */
  h.bankService = () => {
    const crypto = new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
      lookup: h.application.services.config.supplier.bankLookup });
    return new SupplierBankService({
      database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto,
      authorize: async () => ({ id: null, username: `${prefix}-seed`, permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"] }),
      audit: { async record() {} }
    });
  };

  h.seedSupplier = async (code, name, status = "active") => {
    const now = Date.now();
    const [inserted] = await h.db.execute(
      `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
         website, general_phone, general_email, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', ?, ?, ?)`, [code, code.toLowerCase(), name, name.toLowerCase(), status, now, now]);
    const id = Number(inserted.insertId);
    h.supplierIds.push(id);
    return id;
  };

  /** Path 參數：`ids` 冇提供嘅一律填一個唔存在嘅 ID。 */
  h.fill = (routePath, ids = {}) => routePath.replace(/:([A-Za-z]+)/gu, (_, name) => String(ids[name] ?? MISSING));

  /**
   * 發一個請求。POST 預設 body `{}`；route 要密碼就補 `password`，要設備就用該角色嘅設備簽。
   * `password: false`／`device: false` 用嚟測降級；`idempotencyKey` 指定 key（預設每次新 key）。
   */
  h.send = async (user, route, { ids, body, password = true, device = true, raw, contentType = "application/json", headers = {},
    idempotencyKey } = {}) => {
    const requestPath = h.fill(route.path, ids);
    const request = { method: route.method, headers: { ...headers } };
    if (user) request.headers.authorization = `Bearer ${user.token}`;
    if (route.idempotent) request.headers["idempotency-key"] = idempotencyKey ?? randomUUID();
    if (route.method === "POST") {
      let payload = body ?? {};
      const strong = route.authType === "jwt-password" || route.authType === "jwt-device-password";
      if (password && strong && payload && typeof payload === "object" && !Array.isArray(payload)) payload = { password: PASSWORD, ...payload };
      request.body = raw ?? JSON.stringify(payload);
      request.headers["content-type"] = contentType;
      if (user && device && route.authType === "jwt-device-password") {
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
  };

  /** 所有 supplier_* 表嘅 checksum：一個請求有冇寫過任何嘢。 */
  h.snapshot = async () => {
    const [tables] = await h.db.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'supplier\\_%' ORDER BY table_name");
    const [rows] = await h.db.query(`CHECKSUM TABLE ${tables.map(({ name }) => `\`${name}\``).join(", ")}`);
    return Object.fromEntries(rows.map((row) => [row.Table, String(row.Checksum)]));
  };

  h.route = (key) => {
    const found = h.routes.find((candidate) => candidate.key === key);
    assert.ok(found, `${key} is registered`);
    return found;
  };

  return h;
}
