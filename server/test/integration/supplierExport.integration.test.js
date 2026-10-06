import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { SUPPLIER_IMPORT_COLUMN_NAMES, isBankColumn } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";
import { SupplierExportService } from "../../src/modules/supplier/SupplierExportService.js";

/**
 * TASK-047：一般供應商匯出打真 MySQL 同真 HTTP（FR-IMPORT-008/009、BR-028、SEC-012、AC-040；HD-067）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "Export-T47-Password!";
const ACCOUNT_NUMBER = "778899001122";
const h = { application: null, url: "", db: null, jwt: null, logRoot: "", supplierIds: [], roleIds: [], userIds: [], termIds: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-export-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } }
  });
  h.db = h.application.services.require("mysqldatabase");
  h.jwt = h.application.services.require("jwt");
  ({ url: h.url } = await h.application.start());
});

after(async () => {
  if (!h.db) return;
  for (const id of h.supplierIds) {
    for (const table of ["supplier_bank_accounts", "supplier_audit_logs"]) await h.db.execute(`DELETE FROM ${table} WHERE supplier_id = ?`, [id]);
    await h.db.execute("DELETE FROM suppliers WHERE id = ?", [id]);
  }
  for (const id of h.termIds) await h.db.execute("DELETE FROM payment_terms WHERE id = ?", [id]);
  for (const id of h.userIds) {
    await h.db.execute("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [id]);
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

async function makeUser(label, permissions) {
  const now = Date.now();
  const name = `exp47-${label}-${randomUUID().slice(0, 8)}`;
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
    [name, passwordHash, `Export ${label}`, now, now]);
  const userId = Number(user.insertId);
  h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [name], permissions }, { subject: String(userId), version, authTime: Math.floor(now / 1000) });
  return { userId, token, permissions, roleName: name };
}

async function seedSupplier({ code, name, status = "active", updatedAt = Date.now(), ...fields }) {
  const [inserted] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       default_payment_term_id, website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'HKD', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, code.toLowerCase(), name, name.toLowerCase(), fields.displayName ?? "", fields.paymentTermId ?? null, fields.website ?? "",
      fields.generalPhone ?? "", fields.generalEmail ?? "", fields.notes ?? "", status, updatedAt, updatedAt]);
  const id = Number(inserted.insertId);
  h.supplierIds.push(id);
  return id;
}

async function seedPaymentTerm(code, status = "ACTIVE") {
  const now = Date.now();
  const [inserted] = await h.db.execute(
    `INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
     VALUES (?, ?, ?, 'NET_DAYS', 30, ?, 1, ?, ?)`, [code, code.toUpperCase(), `Term ${code}`, status, now, now]);
  h.termIds.push(Number(inserted.insertId));
  return Number(inserted.insertId);
}

async function exportCsv(user, body, extraHeaders = {}) {
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`${h.url}/api/v1/supplier-exports`, {
      method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body)
    });
    if (response.status !== 429) break;
    await response.arrayBuffer();
    await new Promise((resolve) => { setTimeout(resolve, 1000 * Number(response.headers.get("retry-after") ?? 1)); });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  let json = null;
  try { json = JSON.parse(bytes.toString("utf8")); } catch { /* CSV */ }
  const records = json ? null : parse(bytes, { bom: true });
  return { status: response.status, headers: response.headers, bytes, json, records, code: json?.error?.code };
}

async function list(user, query) {
  const response = await fetch(`${h.url}/api/v1/suppliers?${new URLSearchParams({ pageSize: "100", ...query })}`,
    { headers: { authorization: `Bearer ${user.token}` } });
  return (await response.json()).data;
}

const exportAudits = async (userId) => (await h.db.query(
  "SELECT action, target_type, supplier_id, detail FROM supplier_audit_logs WHERE actor_user_id = ? AND action = 'supplier.export' ORDER BY id",
  [userId]))[0];

integrationTest("TASK-047 (HD-067 2A): the export is the list's rows in the list's order, under the import template v1 header", async () => {
  const user = await makeUser("list", ["supplier.mgmt", "supplier.view"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const term = await seedPaymentTerm(`T47-${tag}`, "INACTIVE");
  const base = Date.now() - 60_000;
  const ids = {
    b: await seedSupplier({ code: `EXB-${tag}`, name: `Export B ${tag}`, updatedAt: base + 3, paymentTermId: term,
      displayName: "Bee", website: "https://b.example.com", generalEmail: "b@example.com", notes: "plain note" }),
    a: await seedSupplier({ code: `EXA-${tag}`, name: `Export A ${tag}`, updatedAt: base + 2, status: "draft" }),
    c: await seedSupplier({ code: `EXC-${tag}`, name: `Export C ${tag}`, updatedAt: base + 1, status: "archived" })
  };

  const all = await exportCsv(user, { password: PASSWORD, filters: { q: tag } });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(all.headers.get("content-disposition"), /^attachment; filename="suppliers-\d{8}T\d{6}Z\.csv"/u);
  assert.equal(all.headers.get("cache-control"), "private, no-store");
  assert.equal(all.bytes.subarray(0, 3).toString("hex"), "efbbbf", "BOM");
  assert.ok(all.bytes.includes("\r\n") && !/[^\r]\n/u.test(all.bytes.toString("utf8")), "CRLF only");
  assert.deepEqual(all.records[0], [...SUPPLIER_IMPORT_COLUMN_NAMES], "exactly the import template v1 header");
  const column = (name) => SUPPLIER_IMPORT_COLUMN_NAMES.indexOf(name);
  // 預設：updatedAt 由新到舊，archived 唔包。
  assert.deepEqual(all.records.slice(1).map((record) => record[column("supplierId")]), [String(ids.b), String(ids.a)]);
  const listed = await list(user, { q: tag });
  assert.deepEqual(all.records.slice(1).map((record) => Number(record[0])), listed.items.map((item) => item.id), "same rows as the list");

  const b = Object.fromEntries(SUPPLIER_IMPORT_COLUMN_NAMES.map((name, index) => [name, all.records[1][index]]));
  assert.deepEqual(
    [b.supplierCode, b.supplierName, b.displayName, b.defaultCurrencyCode, b.paymentTermCode, b.website, b.generalEmail, b.notes],
    [`EXB-${tag}`, `Export B ${tag}`, "Bee", "HKD", `T47-${tag}`, "https://b.example.com", "b@example.com", "plain note"],
    "an inactive payment term still exports its code");
  for (const name of SUPPLIER_IMPORT_COLUMN_NAMES.slice(column("addressLabel"))) assert.equal(b[name], "", `${name} stays empty`);

  for (const [filters, expected] of [
    [{ q: tag, includeArchived: true, sortBy: "supplierCode", descending: false }, [ids.a, ids.b, ids.c]],
    [{ q: tag, status: "archived" }, [ids.c]],
    [{ q: tag, status: "draft" }, [ids.a]],
    [{ q: `exa-${tag}` }, [ids.a]],
    [{ q: tag, paymentTermId: term }, [ids.b]],
    [{ q: tag, updatedFrom: base + 2, includeArchived: true }, [ids.b, ids.a]],
    [{ q: `nothing-${tag}` }, []]
  ]) {
    const result = await exportCsv(user, { password: PASSWORD, filters });
    assert.equal(result.status, 200);
    assert.deepEqual(result.records.slice(1).map((record) => Number(record[0])), expected, JSON.stringify(filters));
    const query = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)]));
    assert.deepEqual((await list(user, query)).items.map((item) => item.id), expected, `the list agrees: ${JSON.stringify(filters)}`);
  }
  assert.equal((await exportCsv(user, { password: PASSWORD, filters: { q: `nothing-${tag}` } })).records.length, 1, "header only");

  const audits = await exportAudits(user.userId);
  assert.equal(audits.length, 9, "one audit per export");
  const detail = typeof audits[0].detail === "string" ? JSON.parse(audits[0].detail) : audits[0].detail;
  assert.deepEqual([audits[0].target_type, audits[0].supplier_id, detail], ["export", null, { metadata: { filters: { q: tag, includeArchived: false, sortBy: "updatedAt", descending: true } }, count: 2 }]);
});

integrationTest("TASK-047 (BR-028, SEC-012): no Bank data and no live formula in the file; awkward text survives the round trip", async () => {
  const user = await makeUser("sec", ["supplier.mgmt"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const tricky = {
    name: `=HYPERLINK("http://evil.example","x") ${tag}`, displayName: "＝SUM(1,2)", website: "@cmd",
    generalPhone: "-2+3", generalEmail: "\tq@example.com", notes: `line one\nline "two", with comma\r\n中文 ✓ ${tag}`
  };
  const id = await seedSupplier({ code: `EXS-${tag}`, name: tricky.name, displayName: tricky.displayName, website: tricky.website,
    generalPhone: tricky.generalPhone, generalEmail: tricky.generalEmail, notes: tricky.notes });
  const crypto = new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
    lookup: h.application.services.config.supplier.bankLookup });
  const banks = new SupplierBankService({
    database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto,
    authorize: async () => ({ id: null, username: "exp47-bank", permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"] }),
    audit: { async record() {} }
  });
  await banks.create({ actorId: null, claimedRoles: [], claimedPermissions: [], supplierId: id, accountHolderName: `Holder ${tag}`,
    bankName: `Bank ${tag}`, bankCountryCode: "HK", bankCode: "999", branchCode: "001", swiftBic: "EXAMPLEHH",
    accountCurrencyCode: "HKD", accountNumber: ACCOUNT_NUMBER, isDefault: true, reason: "T47 export bank seed" });
  const [[bank]] = await h.db.query("SELECT HEX(account_blind_index) AS blind, encryption_key_id AS keyId FROM supplier_bank_accounts WHERE supplier_id = ?", [id]);

  const result = await exportCsv(user, { password: PASSWORD, filters: { q: tag } });
  assert.equal(result.status, 200);
  const text = result.bytes.toString("utf8");
  for (const secret of [ACCOUNT_NUMBER, ACCOUNT_NUMBER.slice(-4), `Holder ${tag}`, `Bank ${tag}`, "EXAMPLEHH", bank.blind, bank.blind.toLowerCase()]) {
    assert.ok(!text.includes(secret), `the file never carries ${secret}`);
  }
  assert.ok(result.records[0].every((header) => !isBankColumn(header)), "no Bank column");
  const row = Object.fromEntries(SUPPLIER_IMPORT_COLUMN_NAMES.map((name, index) => [name, result.records[1][index]]));
  assert.deepEqual(
    [row.supplierName, row.displayName, row.website, row.generalPhone, row.generalEmail, row.notes],
    [`'${tricky.name}`, `'${tricky.displayName}`, `'${tricky.website}`, `'${tricky.generalPhone}`, `'${tricky.generalEmail}`, tricky.notes],
    "formula-leading cells carry an apostrophe; commas, quotes, newlines and Unicode come back unchanged");
  const audit = JSON.stringify(await exportAudits(user.userId));
  for (const secret of [ACCOUNT_NUMBER, `Holder ${tag}`, tricky.notes]) assert.ok(!audit.includes(secret), "the audit carries filters and a count only");
});

integrationTest("TASK-047 (HD-067 1A): password, permission and the 10,000-row cap", async () => {
  const manager = await makeUser("mgr", ["supplier.mgmt"]);
  const viewer = await makeUser("view", ["supplier.view"]);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  await seedSupplier({ code: `EXP-${tag}`, name: `Export P ${tag}` });

  const wrong = await exportCsv(manager, { password: "not-the-password", filters: { q: tag } });
  assert.deepEqual([wrong.status, wrong.code], [403, "PASSWORD_INVALID"]);
  const missing = await exportCsv(manager, { filters: { q: tag } });
  assert.equal(missing.status, 400);
  const forbidden = await exportCsv(viewer, { password: PASSWORD, filters: { q: tag } });
  assert.equal(forbidden.status, 403);
  const anonymous = await fetch(`${h.url}/api/v1/supplier-exports`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(anonymous.status, 401);
  const unknownFilter = await exportCsv(manager, { password: PASSWORD, filters: { page: 2 } });
  assert.equal(unknownFilter.status, 400, "paging is not a filter");
  assert.equal((await exportAudits(manager.userId)).length, 0, "a refused export leaves no audit");

  // 上限用細數字驗：同一個 service、同一條 SQL，只係 maxRows 唔同。
  await seedSupplier({ code: `EXQ-${tag}`, name: `Export Q ${tag}` });
  const service = new SupplierExportService({ database: h.db, time: { nowMs: () => Date.now() },
    businessMaster: new BusinessMasterProvider({ database: h.db, repository: new BusinessMasterRepository() }), maxRows: 1 });
  const actor = { actorId: manager.userId, claimedRoles: [manager.roleName], claimedPermissions: manager.permissions };
  await assert.rejects(service.exportCsv({ ...actor, filters: { q: tag } }),
    (error) => error.code === "SUPPLIER_EXPORT_TOO_LARGE" && error.statusCode === 422);
  assert.equal((await exportAudits(manager.userId)).length, 0, "an export over the cap leaves no audit");
  assert.equal((await service.exportCsv({ ...actor, filters: { q: `EXQ-${tag}` } })).rowCount, 1, "exactly the cap is allowed");

  // 瀏覽器要讀到檔名（T46 I-2；HD-067 1A）。
  const origin = String(h.application.services.config.security.cors.allowedOrigins).split(",")[0].trim();
  const cors = await exportCsv({ token: manager.token }, { password: PASSWORD, filters: { q: `EXQ-${tag}` } }, { origin });
  assert.equal(cors.status, 200);
  assert.match(cors.headers.get("access-control-expose-headers") ?? "", /Content-Disposition/iu);
});
