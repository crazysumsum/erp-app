import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SupplierBankCrypto } from "../../src/modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../src/modules/supplier/SupplierBankService.js";
import { SupplierContactService } from "../../src/modules/supplier/SupplierContactService.js";

/**
 * TASK-051 step 2b（HD-107）：列表、搜尋、篩選、排序同子資料分頁，打真 HTTP 同真 MySQL。
 * 每個 case 只睇自己 tag 嘅供應商（q=tag），所以同一個 DB 入面其他測試留低嘅資料唔影響結果。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const PASSWORD = "List-T51-Password!";
const h = { application: null, url: "", db: null, jwt: null, logRoot: "", supplierIds: [], roleIds: [], userIds: [], termIds: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-list-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 },
      // 呢度一個 case 要發幾百個 request；同 supplierSkuLookup 一樣放寬每 IP 上限，唔係測緊限流。
      requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 10_000 },
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
    for (const table of ["supplier_contact_purposes", "supplier_contacts", "supplier_address_purposes", "supplier_addresses",
      "supplier_identifiers", "supplier_bank_accounts", "supplier_audit_logs"]) {
      await h.db.execute(`DELETE FROM ${table} WHERE supplier_id = ?`, [id]);
    }
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
  const name = `list51-${label}-${randomUUID().slice(0, 8)}`;
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
    [name, passwordHash, `List ${label}`, now, now]);
  const userId = Number(user.insertId);
  h.userIds.push(userId);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await h.jwt.issue({ roles: [name], permissions }, { subject: String(userId), version, authTime: Math.floor(now / 1000) });
  return { userId, token, permissions, roles: [name] };
}

async function seedSupplier({ code, name, status = "active", at = Date.now(), createdAt = at, displayName = "", phone = "", email = "",
  paymentTermId = null }) {
  const [inserted] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       default_payment_term_id, website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'HKD', ?, '', ?, ?, '', ?, ?, ?)`,
    [code, code.toLowerCase(), name, name.toLowerCase(), displayName, paymentTermId, phone, email, status, createdAt, at]);
  const id = Number(inserted.insertId);
  h.supplierIds.push(id);
  return id;
}

async function seedContact(supplierId, { name = "Contact", status = "active", purpose = null, primary = false } = {}) {
  const now = Date.now();
  const [inserted] = await h.db.execute(
    "INSERT INTO supplier_contacts (supplier_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [supplierId, name, status, now, now]);
  const id = Number(inserted.insertId);
  if (purpose) {
    await h.db.execute(
      "INSERT INTO supplier_contact_purposes (contact_id, supplier_id, purpose_code, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, supplierId, purpose, primary ? 1 : 0, now, now]);
  }
  return id;
}

async function seedAddress(supplierId, { label = "Address", status = "active", purpose = null } = {}) {
  const now = Date.now();
  const [inserted] = await h.db.execute(
    "INSERT INTO supplier_addresses (supplier_id, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [supplierId, label, status, now, now]);
  const id = Number(inserted.insertId);
  if (purpose) {
    await h.db.execute(
      "INSERT INTO supplier_address_purposes (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      [id, supplierId, purpose, now, now]);
  }
  return id;
}

async function seedIdentifier(supplierId, value, key) {
  const now = Date.now();
  await h.db.execute(
    `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
     VALUES (?, 'business_registration', 'HK', ?, ?, ?, ?)`, [supplierId, value, key, now, now]);
}

async function seedPaymentTerm(code) {
  const now = Date.now();
  const [inserted] = await h.db.execute(
    `INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
     VALUES (?, ?, ?, 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?)`, [code, code.toUpperCase(), `Term ${code}`, now, now]);
  h.termIds.push(Number(inserted.insertId));
  return Number(inserted.insertId);
}

async function exportWith(user, filters) {
  const response = await fetch(`${h.url}/api/v1/supplier-exports`, { method: "POST",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD, filters }) });
  const text = await response.text();
  let code = null;
  try { code = JSON.parse(text)?.error?.code ?? null; } catch { /* CSV */ }
  return { status: response.status, code, text };
}

function bankService() {
  const crypto = new SupplierBankCrypto({ encryption: h.application.services.config.supplier.bankEncryption,
    lookup: h.application.services.config.supplier.bankLookup });
  return new SupplierBankService({
    database: h.db, logger: { warn() {}, info() {}, error() {} }, time: { nowMs: () => Date.now() }, crypto,
    authorize: async () => ({ id: null, username: "list51-bank", permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"] }),
    audit: { async record() {} }
  });
}

async function seedBank(supplierId, tag) {
  return bankService().create({ actorId: null, claimedRoles: [], claimedPermissions: [], supplierId, accountHolderName: `Holder ${tag}`,
    bankName: `Bank ${tag}`, bankCountryCode: "HK", bankCode: "999", branchCode: "001", swiftBic: "EXAMPLEHH",
    accountCurrencyCode: "HKD", accountNumber: `55${randomUUID().replace(/\D/gu, "").slice(0, 10).padEnd(10, "7")}`, isDefault: true,
    reason: "T51 list seed" });
}

async function get(user, url) {
  const response = await fetch(`${h.url}${url}`, { headers: user ? { authorization: `Bearer ${user.token}` } : {} });
  const body = await response.json().catch(() => null);
  return { status: response.status, data: body?.data, code: body?.error?.code };
}

const list = (user, query) => get(user, `/api/v1/suppliers?${new URLSearchParams(query)}`);
const ids = (result) => result.data.items.map((item) => item.id);
const supplierCount = async () => Number((await h.db.query("SELECT COUNT(*) AS n FROM suppliers"))[0][0].n);

integrationTest("TC-008 (LIST-001): the list pages 20 by default and at most 100, refuses other bounds, and hides Archived unless asked", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = `L1${randomUUID().slice(0, 6).toUpperCase()}`;
  const base = Date.now() - 100_000;
  for (let n = 0; n < 124; n += 1) await seedSupplier({ code: `${tag}-${String(n).padStart(3, "0")}`, name: `Paging ${tag} ${n}`, at: base + n });
  const archived = await seedSupplier({ code: `${tag}-AR`, name: `Paging ${tag} archived`, status: "archived", at: base + 99 });

  const first = await list(viewer, { q: tag });
  assert.equal(first.status, 200);
  assert.deepEqual([first.data.items.length, first.data.total, first.data.page, first.data.pageSize], [20, 124, 1, 20],
    "20 by default; total counts the filtered set, not the page");
  assert.ok(!ids(first).includes(archived), "Archived is hidden by default");
  assert.deepEqual([(await list(viewer, { q: tag, pageSize: "1" })).data.items.length], [1]);
  const hundred = await list(viewer, { q: tag, pageSize: "100" });
  const rest = await list(viewer, { q: tag, pageSize: "100", page: "2" });
  assert.deepEqual([hundred.data.items.length, rest.data.items.length, hundred.data.total], [100, 24, 124], "a page holds at most 100");
  assert.equal(new Set([...ids(hundred), ...ids(rest)]).size, 124, "the two pages partition the set");
  for (const bad of [{ pageSize: "0" }, { pageSize: "101" }, { page: "0" }, { page: "x" }, { page: "100000000000000000000" }]) {
    assert.equal((await list(viewer, { q: tag, ...bad })).status, 400, JSON.stringify(bad));
  }
  const withArchived = await list(viewer, { q: tag, includeArchived: "true", pageSize: "100" });
  assert.equal(withArchived.data.total, 125);
  assert.ok(ids(withArchived).includes(archived));
  const onlyArchived = await list(viewer, { q: tag, status: "archived" });
  assert.deepEqual([ids(onlyArchived), onlyArchived.data.total], [[archived], 1], "an explicit status filter finds it");
});

integrationTest("TC-009 (LIST-002): every searchable field matches in full and in part, Code and Name ignore case and edge spaces, with no duplicate rows", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();
  const target = await seedSupplier({ code: `LS${tag}-CODE`, name: `Northwind ${tag} Trading`, displayName: `NW-${tag}-DISPLAY`,
    phone: `+852 ${tag.slice(0, 4)} 9876`, email: `buyer.${tag.toLowerCase()}@northwind.example` });
  await seedIdentifier(target, `BR-${tag}-77`, `BR${tag}77`);
  await seedIdentifier(target, `BR ${tag} 88`, `BR${tag}88`);
  const other = await seedSupplier({ code: `LX${tag}-OTHER`, name: `Other ${tag} Co` });

  const find = async (q) => {
    const result = await list(viewer, { q, pageSize: "100" });
    assert.equal(result.status, 200, q);
    return result.data;
  };
  const cases = {
    "Code in full, other case, padded": `  ls${tag.toLowerCase()}-code  `,
    "Code prefix": `LS${tag}`,
    "Name in full": `Northwind ${tag} Trading`,
    "Name in part, other case": `northwind ${tag.toLowerCase()}`,
    "Display Name in part": `${tag}-DISPLAY`,
    "phone in part": `${tag.slice(0, 4)} 9876`,
    "email in part": `buyer.${tag.toLowerCase()}`,
    "identifier as entered": `BR-${tag}-77`,
    "identifier without separators, lower case": `br${tag.toLowerCase()}77`,
    "identifier in part, with a space": `${tag} 8`
  };
  for (const [label, q] of Object.entries(cases)) {
    const result = await find(q);
    assert.deepEqual([result.items.map((item) => item.id), result.total], [[target], 1], label);
  }
  // 淨係分隔符嘅搜尋唔可以變成 `%%`，配中所有識別號（REV-094 M-1）。
  const plain = await seedSupplier({ code: `LZ${tag}PLAIN`, name: `Plain ${tag} Co` });
  await seedIdentifier(plain, `BR ${tag} 99`, `BR${tag}99`);
  for (const q of ["-", " - ", "--"]) {
    const result = await list(viewer, { q, pageSize: "100", includeArchived: "true" });
    assert.equal(result.status, 200, q);
    assert.ok(!ids(result).includes(plain), `${JSON.stringify(q)} must not match a Supplier with no dash anywhere`);
  }
  const both = await find(tag);
  assert.deepEqual([both.items.map((item) => item.id).sort(), both.total], [[target, other, plain].sort(), 3],
    "two identifiers that both match do not repeat the row, and total agrees");
});

integrationTest("TC-010 (LIST-003): filters return only their intersection, with missing contact, address and Bank and both date ranges exact at the edges", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = `L3${randomUUID().slice(0, 6).toUpperCase()}`;
  const t0 = Date.now() - 1_000_000;
  const term = await seedPaymentTerm(`T51-${tag}`);
  const complete = await seedSupplier({ code: `${tag}-FULL`, name: `Filter ${tag} full`, at: t0 + 100, createdAt: t0 + 10, paymentTermId: term });
  await seedContact(complete, { name: "Orders lead", purpose: "orders", primary: true });
  await seedAddress(complete, { purpose: "ordering" });
  await seedBank(complete, tag);
  const bare = await seedSupplier({ code: `${tag}-BARE`, name: `Filter ${tag} bare`, at: t0 + 200, createdAt: t0 + 20 });
  // 其他用途嘅 primary 唔算「主要聯絡人」：冇咗 purpose_code 條件就會被當成有。
  await seedContact(bare, { name: "Sales lead", purpose: "sales", primary: true });
  const weak = await seedSupplier({ code: `${tag}-WEAK`, name: `Filter ${tag} weak`, status: "suspended", at: t0 + 300, createdAt: t0 + 30 });
  // 只算啟用中、啱用途嘅：非主要、停用、其他用途都唔算數。
  await seedContact(weak, { name: "Not primary", purpose: "orders", primary: false });
  // 停用會清走 primary（SupplierContactService.deactivate），所以停用嘅聯絡人只會留低非 primary 嘅用途。
  await seedContact(weak, { name: "Inactive", status: "inactive", purpose: "orders", primary: false });
  await seedAddress(weak, { purpose: "billing" });
  await seedAddress(weak, { status: "inactive", purpose: "ordering" });
  const inactiveBank = await seedBank(weak, `${tag}w`);
  await bankService().deactivate({ actorId: null, claimedRoles: [], claimedPermissions: [], supplierId: weak, bankAccountId: inactiveBank.id,
    version: inactiveBank.version, reason: "T51 inactive bank" });

  const found = async (query) => {
    const result = await list(viewer, { q: tag, pageSize: "100", ...query });
    assert.equal(result.status, 200, JSON.stringify(query));
    return ids(result).sort((a, b) => a - b);
  };
  const sorted = (...values) => values.sort((a, b) => a - b);
  assert.deepEqual(await found({}), sorted(complete, bare, weak));
  assert.deepEqual(await found({ missingPrimaryContact: "true" }), sorted(bare, weak));
  assert.deepEqual(await found({ missingAddress: "true" }), sorted(bare, weak));
  assert.deepEqual(await found({ missingBank: "true" }), sorted(bare, weak));
  assert.deepEqual(await found({ missingPrimaryContact: "false" }), sorted(complete, bare, weak), "false does not filter");
  assert.deepEqual(await found({ status: "suspended", missingBank: "true" }), [weak], "filters intersect");
  assert.deepEqual(await found({ status: "active", missingAddress: "true" }), [bare]);
  assert.deepEqual(await found({ currencyCode: "HKD" }), sorted(complete, bare, weak));
  assert.deepEqual(await found({ paymentTermId: String(term) }), [complete]);
  assert.deepEqual(await found({ paymentTermId: String(term), missingBank: "true" }), []);
  assert.deepEqual(await found({ currencyCode: "USD" }), []);
  assert.deepEqual(await found({ updatedFrom: String(t0 + 200), updatedTo: String(t0 + 300) }), sorted(bare, weak), "updated range is inclusive");
  assert.deepEqual(await found({ updatedFrom: String(t0 + 201) }), [weak]);
  assert.deepEqual(await found({ createdFrom: String(t0 + 10), createdTo: String(t0 + 20) }), sorted(complete, bare), "created range is inclusive");
  assert.deepEqual(await found({ createdTo: String(t0 + 9) }), []);
  assert.deepEqual(await found({ createdFrom: String(t0 + 20), missingPrimaryContact: "true", status: "active" }), [bare]);
  assert.equal((await list(viewer, { q: tag, missingBank: "maybe" })).status, 400);
  assert.equal((await list(viewer, { q: tag, createdFrom: "-1" })).status, 400);
});

integrationTest("TC-011 (LIST-004): each allowed sort orders the set, ties fall back to ID in the same direction, and pages neither skip nor repeat", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = `L4${randomUUID().slice(0, 6).toUpperCase()}`;
  const at = Date.now() - 50_000;
  const rows = [];
  // 同一個名、同一個時間、同一個狀態：排序撞值時要靠 ID 先穩定。
  for (let n = 0; n < 7; n += 1) {
    rows.push({ id: await seedSupplier({ code: `${tag}-${"GFEDCBA"[n]}`, name: n < 4 ? `Same ${tag}` : `Zed ${tag} ${n}`,
      status: n % 2 ? "suspended" : "active", at: n < 5 ? at : at + n }), n });
  }
  const read = async (sortBy, descending) => {
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await list(viewer, { q: tag, sortBy, descending: String(descending), pageSize: "3", page: String(page) });
      assert.equal(result.data.total, 7);
      seen.push(...result.data.items);
    }
    return seen;
  };
  const keyOf = { supplierCode: (item) => item.supplierCode, supplierName: (item) => item.supplierName,
    status: (item) => item.status, updatedAt: (item) => item.updatedAt };
  for (const sortBy of Object.keys(keyOf)) {
    for (const descending of [false, true]) {
      const seen = await read(sortBy, descending);
      assert.equal(new Set(seen.map((item) => item.id)).size, 7, `${sortBy} ${descending}: no row skipped or repeated across pages`);
      for (let i = 1; i < seen.length; i += 1) {
        const [a, b] = [keyOf[sortBy](seen[i - 1]), keyOf[sortBy](seen[i])];
        const order = a < b ? -1 : a > b ? 1 : 0;
        assert.ok(descending ? order >= 0 : order <= 0, `${sortBy} ${descending} at ${i}`);
        if (order === 0) {
          assert.ok(descending ? seen[i - 1].id > seen[i].id : seen[i - 1].id < seen[i].id, `${sortBy} ${descending}: a tie falls back to ID, same direction`);
        }
      }
      assert.deepEqual(seen.map((item) => item.id), (await read(sortBy, descending)).map((item) => item.id), "the order is repeatable");
    }
  }
});

integrationTest("TC-012 (LIST-005): LIKE wildcards are searched literally, an unknown sort is 400, and nothing in the database moves", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = `L5${randomUUID().slice(0, 6).toUpperCase()}`;
  const literal = await seedSupplier({ code: `${tag}-PCT`, name: `Rate ${tag} 100%_off` });
  const slash = await seedSupplier({ code: `${tag}-BSL`, name: `Path ${tag} a\\b` });
  const unicode = await seedSupplier({ code: `${tag}-UNI`, name: `華興${tag}貿易有限公司` });
  await seedSupplier({ code: `${tag}-NOPE`, name: `Rate ${tag} 1000 offer` });
  const before = await supplierCount();
  const percent = await list(viewer, { q: `${tag} 100%_` });
  assert.deepEqual([ids(percent), percent.data.total], [[literal], 1], "% and _ match themselves, not any text");
  assert.deepEqual(ids(await list(viewer, { q: `${tag} 10_` })), [], "_ is not a single-character wildcard");
  assert.deepEqual(ids(await list(viewer, { q: `${tag} a\\b` })), [slash], "a backslash is literal too");
  assert.deepEqual(ids(await list(viewer, { q: `${tag} a\\\\b` })), [], "and is not an escape character for the caller");
  assert.deepEqual(ids(await list(viewer, { q: `${tag}貿易` })), [unicode], "Chinese text matches in part");
  const injection = await list(viewer, { q: `${tag}' OR '1'='1` });
  assert.deepEqual([injection.status, injection.data.total], [200, 0], "a quote is data, not SQL");
  for (const sortBy of ["supplierId", "supplier_name", "1; DROP TABLE suppliers"]) {
    assert.equal((await list(viewer, { q: tag, sortBy })).status, 400, sortBy);
  }
  assert.equal((await list(viewer, { q: tag, descending: "sideways" })).status, 400);
  assert.equal(await supplierCount(), before, "no request changed the table");
});

integrationTest("TC-048 (PARTY-009): detail carries at most 100 contacts and addresses; the dedicated lists page the rest exactly", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const outsider = await makeUser("outsider", ["customer.view"]);
  const tag = `P9${randomUUID().slice(0, 6).toUpperCase()}`;
  const id = await seedSupplier({ code: `${tag}-BIG`, name: `Many children ${tag}` });
  for (let n = 0; n < 105; n += 1) {
    // 主要聯絡人同採購地址放喺第 105 筆：detail 只帶頭 100 筆，但判斷「缺唔缺」要睇晒（REV-094 L-2）。
    await seedContact(id, { name: `Contact ${String(n).padStart(3, "0")}`, purpose: n === 104 ? "orders" : null, primary: n === 104 });
    await seedAddress(id, { label: `Address ${n}`, purpose: n === 104 ? "ordering" : null });
  }

  const detail = await get(viewer, `/api/v1/suppliers/${id}`);
  assert.deepEqual([detail.status, detail.data.contacts.length, detail.data.addresses.length], [200, 100, 100], "detail stops at the design cap");
  assert.deepEqual(detail.data.warnings.map((warning) => warning.code).filter((code) => /ORDERS_CONTACT|ORDERING_ADDRESS/u.test(code)), [],
    "the 105th rows still count, so detail does not warn");
  for (const filter of ["missingPrimaryContact", "missingAddress"]) {
    assert.deepEqual(ids(await list(viewer, { q: tag, [filter]: "true" })), [], `${filter} agrees with detail`);
  }
  for (const kind of ["contacts", "addresses"]) {
    const seen = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await get(viewer, `/api/v1/suppliers/${id}/${kind}?page=${page}&pageSize=50`);
      assert.equal(result.status, 200, kind);
      assert.deepEqual([result.data.total, result.data.page, result.data.pageSize], [105, page, 50], kind);
      seen.push(...result.data.items);
    }
    assert.equal(seen.length, 105, `${kind}: every row comes back once`);
    assert.equal(new Set(seen.map((item) => item.id)).size, 105, `${kind}: no row repeats across pages`);
    assert.ok(seen.every((item) => item.supplierId === id), `${kind}: only this Supplier's rows`);
    assert.deepEqual(seen.filter((item) => item.purposes.length > 0).map((item) => item.purposes),
      [[{ purposeCode: kind === "contacts" ? "orders" : "ordering", isPrimary: kind === "contacts" }]], `${kind}: purposes come with the page`);
    assert.equal((await get(viewer, `/api/v1/suppliers/${id}/${kind}`)).data.pageSize, 20, `${kind}: 20 by default`);
    for (const bad of ["pageSize=0", "pageSize=101", "page=0", "page=100000000000000000000"]) {
      assert.equal((await get(viewer, `/api/v1/suppliers/${id}/${kind}?${bad}`)).status, 400, `${kind} ${bad}`);
    }
    const unknown = await get(viewer, `/api/v1/suppliers/999999999999/${kind}`);
    assert.deepEqual([unknown.status, unknown.code], [404, "SUPPLIER_NOT_FOUND"], `${kind}: unknown Supplier`);
    assert.equal((await get(outsider, `/api/v1/suppliers/${id}/${kind}`)).status, 403, `${kind}: needs supplier.view`);
    assert.equal((await get(null, `/api/v1/suppliers/${id}/${kind}`)).status, 401, `${kind}: needs a token`);
  }
});

integrationTest("REV-094 L-3: a primary contact deactivated through the service leaves the Supplier missing one", async () => {
  const manager = await makeUser("manager", ["supplier.view", "supplier.mgmt"]);
  const tag = `L3S${randomUUID().slice(0, 6).toUpperCase()}`;
  const id = await seedSupplier({ code: `${tag}-SVC`, name: `Service ${tag}` });
  const contacts = new SupplierContactService({ database: h.db, logger: { info() {}, warn() {}, error() {} }, time: { nowMs: () => Date.now() } });
  const actor = { actorId: manager.userId, claimedRoles: manager.roles, claimedPermissions: manager.permissions, requestId: `t51-${tag}`, ip: "127.0.0.1" };
  const created = await contacts.create({ ...actor, supplierId: id, name: "Orders lead", purposes: [{ purposeCode: "orders", isPrimary: true }] });
  assert.deepEqual(ids(await list(manager, { q: tag, missingPrimaryContact: "true" })), [], "with a primary orders contact");
  await contacts.deactivate({ ...actor, supplierId: id, contactId: created.id, version: created.version });
  assert.deepEqual(ids(await list(manager, { q: tag, missingPrimaryContact: "true" })), [id],
    "deactivating clears the primary slot, which is what the filter relies on");
});

integrationTest("REV-094 L-4: export lets only a supplier.view holder filter on Bank existence", async () => {
  const managerOnly = await makeUser("mgmt-only", ["supplier.mgmt"]);
  const both = await makeUser("mgmt-view", ["supplier.mgmt", "supplier.view"]);
  const tag = `L4X${randomUUID().slice(0, 6).toUpperCase()}`;
  await seedSupplier({ code: `${tag}-EXP`, name: `Export ${tag}` });
  const refused = await exportWith(managerOnly, { q: tag, missingBank: true });
  assert.deepEqual([refused.status, refused.code], [403, "SUPPLIER_EXPORT_FILTER_FORBIDDEN"]);
  assert.equal((await exportWith(managerOnly, { q: tag, missingAddress: true })).status, 200, "other filters stay open to supplier.mgmt");
  const allowed = await exportWith(both, { q: tag, missingBank: true });
  assert.equal(allowed.status, 200);
  assert.ok(allowed.text.includes(`${tag}-EXP`), "the Supplier without a Bank account is exported");
});

integrationTest("the list names each Supplier's payment term by code and name, an inactive one included, and null without one (DEF-040, HD-133 A)", async () => {
  const viewer = await makeUser("viewer", ["supplier.view"]);
  const tag = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();
  const active = await seedPaymentTerm(`LA${tag}`);
  const retired = await seedPaymentTerm(`LR${tag}`);
  await h.db.execute("UPDATE payment_terms SET status = 'INACTIVE', version = version + 1 WHERE id = ?", [retired]);
  const withActive = await seedSupplier({ code: `PL${tag}-A`, name: `Payment list ${tag} A`, paymentTermId: active });
  const withRetired = await seedSupplier({ code: `PL${tag}-R`, name: `Payment list ${tag} R`, paymentTermId: retired });
  const without = await seedSupplier({ code: `PL${tag}-N`, name: `Payment list ${tag} N` });
  const result = await list(viewer, { q: `PL${tag}`, pageSize: "100" });
  assert.equal(result.status, 200);
  const byId = Object.fromEntries(result.data.items.map((item) => [item.id, item.defaultPaymentTerm]));
  assert.deepEqual(byId[withActive], { id: active, code: `LA${tag}`, name: `Term LA${tag}`, status: "ACTIVE" });
  assert.deepEqual(byId[withRetired], { id: retired, code: `LR${tag}`, name: `Term LR${tag}`, status: "INACTIVE" });
  assert.equal(byId[without], null);
});
