import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { SupplierLookupService } from "../../src/modules/supplier/SupplierLookupService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = { cleanup: [], supplierIds: [], httpUsers: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-sku-lookup-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const { discoverServiceDefinitions } = await import("../../src/framework/services/serviceDiscovery.js");
  const source = defaultConfigurationSource();
  // 真 HTTP（認證、權限、request validation、正式 supplierCoreProvider 組裝）：背景工作全部關閉。
  const jobs = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
  h.application = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 10_000 },
    scheduler: { ...source.scheduler, jobs: Object.fromEntries(jobs.map((name) => [name,
      { ...(source.scheduler.jobs?.[name] ?? {}), enabled: name === "tokenRevocation.refresh" }])) },
    logging: { loggers: {
      request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
      system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } },
  // 同 src/index.js 一樣註冊 supplierCoreProvider（依賴 businessMaster）。
  serviceDiscoveryOptions: { additionalModuleUrls: [
    new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
    new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] } });
  h.url = (await h.application.start()).url;
  h.db = h.application.services.require("mysqldatabase");
});

after(async () => {
  if (!h.db) return;
  try {
    if (h.supplierIds.length) {
      await h.db.query("DELETE FROM supplier_sku_refs WHERE supplier_id IN (?)", [h.supplierIds]);
      await h.db.query("DELETE FROM suppliers WHERE id IN (?)", [h.supplierIds]);
    }
    for (const [sql, params] of h.cleanup.reverse()) await h.db.execute(sql, params);
    for (const { userId, roleId } of h.httpUsers) {
      await h.db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await h.db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await h.db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
      await h.db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]).catch(() => {});
      await h.db.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
  } finally {
    await h.application.shutdown("test");
    fs.rmSync(h.logRoot, { recursive: true, force: true });
  }
});

const time = { nowMs: () => Date.now() };
const logger = { info() {}, warn() {}, error() {} };
const lookup = () => new SupplierLookupService({ database: h.db, logger, time, items: new ItemLookupService({ database: h.db, logger, time }) });

async function sku({ status = "active", purchasable = 1 } = {}) {
  const code = `SKL-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const [item] = await h.db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  const [row] = await h.db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [item.insertId, code, code, status, purchasable, now, now]);
  h.cleanup.push(["DELETE FROM items WHERE id = ?", [item.insertId]]);
  h.cleanup.push(["DELETE FROM item_skus WHERE id = ?", [row.insertId]]);
  return Number(row.insertId);
}

async function supplier({ code, name, status = "active" }) {
  const [row] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code, status, version,
       created_at, updated_at) VALUES (?, ?, ?, ?, 'HKD', ?, 1, ?, ?)`,
    [code, code.toLowerCase(), name, name.toLowerCase(), status, Date.now(), Date.now()]);
  h.supplierIds.push(Number(row.insertId));
  return Number(row.insertId);
}

async function relation(supplierId, skuId, { status = "alternative", lastSuppliedAt = null, itemCode = "" } = {}) {
  await h.db.execute(
    `INSERT INTO supplier_sku_refs (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, relationship_status, last_supplied_at,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [supplierId, skuId, itemCode, itemCode ? itemCode.normalize("NFKC").toLowerCase() : null, status, lastSuppliedAt, Date.now(), Date.now()]);
}

/** 一組只有自己會搵到嘅 Supplier：名都含 prefix，`exact` 嘅 code 就係 prefix 本身。 */
async function fixture() {
  const prefix = `SKL${randomUUID().slice(0, 8)}`;
  const [skuId, otherSku] = [await sku(), await sku()];
  const s = {
    exact: await supplier({ code: prefix, name: `${prefix} Zulu` }),
    preferred: await supplier({ code: `${prefix}-1`, name: `${prefix} Delta` }),
    recent: await supplier({ code: `${prefix}-2`, name: `${prefix} Yankee` }),
    older: await supplier({ code: `${prefix}-3`, name: `${prefix} Bravo` }),
    stopped: await supplier({ code: `${prefix}-4`, name: `${prefix} Charlie` }),
    plainA: await supplier({ code: `${prefix}-5`, name: `${prefix} Echo` }),
    plainB: await supplier({ code: `${prefix}-6`, name: `${prefix} Echo` }),
    suspended: await supplier({ code: `${prefix}-7`, name: `${prefix} Alpha`, status: "suspended" }),
    archived: await supplier({ code: `${prefix}-8`, name: `${prefix} Alpha`, status: "archived" })
  };
  await relation(s.preferred, skuId, { status: "preferred" });
  await relation(s.recent, skuId, { lastSuppliedAt: 2_000 });
  await relation(s.older, skuId, { lastSuppliedAt: 1_000, itemCode: `${prefix}-Item` });
  await relation(s.stopped, skuId, { status: "stopped", lastSuppliedAt: 3_000 });
  await relation(s.suspended, skuId, { status: "preferred", lastSuppliedAt: 4_000 });
  // 同一個 Supplier Item Code，不過係另一隻 SKU：唔可以令 plainA 喺呢隻 SKU 度變成 exact。
  await relation(s.plainA, otherSku, { itemCode: `${prefix}-Item` });
  return { prefix, skuId, s };
}

integrationTest("TASK-040 (SKU-001, SKU-002, AC-028–030): every Active Supplier stays, relations only rank, stopped and inactive never rank up", async () => {
  const { prefix, skuId, s } = await fixture();
  const result = await lookup().listForSku(skuId, { q: prefix, pageSize: 100 });

  assert.deepEqual(result.items.map((item) => item.supplierId),
    [s.exact, s.preferred, s.recent, s.older, s.stopped, s.plainA, s.plainB],
    "exact → preferred → recently supplied → name, ID; no-relation Suppliers present; Suspended and Archived absent");
  assert.deepEqual(result.items.map((item) => item.rankReason),
    ["exact_match", "preferred", "recently_supplied", "recently_supplied", null, null, null]);
  assert.equal(result.total, 7, "count is per Supplier, not inflated or shrunk by the join");
  assert.deepEqual(result.items[4].relation, { relationId: result.items[4].relation.relationId, relationshipStatus: "stopped",
    supplierItemCode: "", lastSuppliedAt: 3_000 });
  assert.equal(result.items[5].relation, null, "plainA's relation is for another SKU");
  assert.ok(result.items.every((item) => item.usable && item.status === "active"));

  const page = await lookup().listForSku(skuId, { q: prefix, page: 2, pageSize: 2 });
  assert.deepEqual([page.items.map((item) => item.supplierId), page.total], [[s.recent, s.older], 7], "stable across pages");

  const byItemCode = await lookup().listForSku(skuId, { q: `${prefix}-item`.toLowerCase() });
  assert.deepEqual(byItemCode.items.map((item) => [item.supplierId, item.rankReason]), [[s.older, "exact_match"]],
    "this SKU's Supplier Item Code matches exactly; the same code on another SKU does not");

  const unfiltered = await lookup().listForSku(skuId, { pageSize: 100 });
  const [[{ active }]] = await h.db.query("SELECT COUNT(*) AS active FROM suppliers WHERE status = 'active'");
  assert.equal(unfiltered.total, Number(active), "without a search every Active Supplier counts");
});

integrationTest("TASK-040 (SKU-003, BR-024, BR-032): a preferred mark never makes a suspended Supplier or an unpurchasable SKU usable", async () => {
  const { prefix, skuId, s } = await fixture();
  const lookups = lookup();
  await assert.rejects(() => h.db.withTransaction((connection) =>
    lookups.assertUsableInTransaction(connection, s.suspended, { purpose: "purchase" })), (error) => error.publicCode === "SUPPLIER_NOT_USABLE");
  assert.equal((await lookups.findById(s.suspended, { purpose: "history" })).status, "suspended", "the Supplier stays readable as history");

  // 揀完之後先被暫停：提交時重驗會擋（唔可以信 selector 嘅結果）。
  const listed = await lookups.listForSku(skuId, { q: prefix });
  assert.ok(listed.items.some((item) => item.supplierId === s.preferred));
  await h.db.execute("UPDATE suppliers SET status = 'suspended' WHERE id = ?", [s.preferred]);
  await assert.rejects(() => h.db.withTransaction((connection) =>
    lookups.assertUsableInTransaction(connection, s.preferred, { purpose: "purchase" })), (error) => error.publicCode === "SUPPLIER_NOT_USABLE");

  for (const [variant, expected] of [[{ status: "inactive" }, "SKU_NOT_USABLE"], [{ purchasable: 0 }, "SKU_NOT_USABLE"]]) {
    const refused = await sku(variant);
    await relation(s.exact, refused, { status: "preferred" });
    await assert.rejects(() => lookups.listForSku(refused), (error) => error.code === expected, JSON.stringify(variant));
  }
  await assert.rejects(() => lookups.listForSku(Number.MAX_SAFE_INTEGER), (error) => error.code === "SKU_NOT_FOUND");
});

async function httpUser(permissions, { claims = permissions } = {}) {
  const name = `sklh-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const [role] = await h.db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [name, now]);
  if (permissions.length) {
    await h.db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [role.insertId, permissions]);
  }
  const [user] = await h.db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', ?, ?, ?)",
    [name, name, now, now]);
  await h.db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.insertId]);
  h.httpUsers.push({ userId: Number(user.insertId), roleId: Number(role.insertId) });
  const version = await h.application.services.require("tokenRevocation").currentVersion(String(user.insertId));
  const token = await h.application.services.require("jwt").issue({ roles: [name], permissions: claims },
    { subject: String(user.insertId), version, authTime: Math.floor(now / 1000) });
  return { token };
}

async function get(user, url) {
  const response = await fetch(`${h.url}${url}`, { headers: { authorization: `Bearer ${user.token}` } });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json, code: json?.error?.code ?? json?.code };
}

integrationTest("TASK-040 (HD-094 1A): over HTTP the for-SKU lookup needs a fresh supplier.view and returns no Bank data", async () => {
  const { prefix, skuId, s } = await fixture();
  const [viewer, outsider] = [await httpUser(["supplier.view"]), await httpUser([])];
  const stale = await httpUser([], { claims: ["supplier.view"] });
  const url = `/api/v1/supplier-lookups/for-sku/${skuId}?q=${encodeURIComponent(prefix)}&pageSize=3`;

  const ok = await get(viewer, url);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.deepEqual([ok.data.items.map((item) => item.supplierId), ok.data.total], [[s.exact, s.preferred, s.recent], 7]);
  assert.equal(JSON.stringify(ok.data).toLowerCase().includes("bank"), false);

  assert.equal((await get(outsider, url)).status, 403);
  assert.equal((await get(stale, url)).code, "PERMISSION_STALE");
  assert.equal((await get(viewer, `/api/v1/supplier-lookups/for-sku/${skuId}?q=${"a".repeat(191)}`)).status, 400);
  assert.equal((await get(viewer, "/api/v1/supplier-lookups/for-sku/0")).status, 400);
  const inactive = await sku({ status: "inactive" });
  const refused = await get(viewer, `/api/v1/supplier-lookups/for-sku/${inactive}`);
  assert.deepEqual([refused.status, refused.code], [409, "SKU_NOT_USABLE"]);
});
