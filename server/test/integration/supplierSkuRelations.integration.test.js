import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";

import { inspectSupplierSkuRelationSchema, up as migrateSupplierSkuRefs } from "../../database/migrations/0081_create_supplier_sku_refs.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { SupplierRelationService } from "../../src/modules/supplier/SupplierRelationService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = { cleanup: [], userId: null, supplierIds: [], skuIds: [], httpUsers: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-sku-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const { discoverServiceDefinitions } = await import("../../src/framework/services/serviceDiscovery.js");
  const source = defaultConfigurationSource();
  // 真 HTTP（認證、權限、request validation）：背景工作全部關閉，唔好郁其他測試嘅資料。
  const jobs = (await discoverServiceDefinitions()).flatMap((definition) => (definition.ServiceClass?.jobs ?? []).map((job) => job.name));
  h.application = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, port: 0 },
    requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 10_000 },
    scheduler: { ...source.scheduler, jobs: Object.fromEntries(jobs.map((name) => [name,
      { ...(source.scheduler.jobs?.[name] ?? {}), enabled: name === "tokenRevocation.refresh" }])) },
    logging: { loggers: {
      request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
      system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } } });
  h.url = (await h.application.start()).url;
  h.db = h.application.services.require("mysqldatabase");
  const [user] = await h.db.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'x', 'SKU relations', ?, ?)",
    [`skurel-${randomUUID().slice(0, 8)}`, Date.now(), Date.now()]);
  h.userId = Number(user.insertId);
});

after(async () => {
  if (!h.db) return;
  try {
    // FK 次序：先事件同對照，再 Supplier，最後 Item。
    for (const table of ["supplier_supply_events", "supplier_sku_refs"]) {
      if (h.supplierIds.length) await h.db.query(`DELETE FROM ${table} WHERE supplier_id IN (?)`, [h.supplierIds]);
    }
    if (h.supplierIds.length) {
      await h.db.query("DELETE FROM supplier_audit_logs WHERE supplier_id IN (?)", [h.supplierIds]);
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
    await h.db.execute("DELETE FROM users WHERE id = ?", [h.userId]);
  } finally {
    await h.application.shutdown("test");
    fs.rmSync(h.logRoot, { recursive: true, force: true });
  }
});

const clock = { now: Date.now() };
const time = { nowMs: () => clock.now };
const logger = { info() {}, warn() {}, error() {} };
const actor = () => ({ actorId: h.userId, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], requestId: "req-sku", ip: "127.0.0.1" });
const service = (options = {}) => new SupplierRelationService({ database: h.db, logger, time, authorize: async () => ({ username: "tester" }),
  items: new ItemLookupService({ database: h.db, logger, time }), ...options });

async function sku({ status = "active", purchasable = 1, uoms = 1 } = {}) {
  const code = `SKR-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  const [item] = await h.db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  const [row] = await h.db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [item.insertId, code, code, status, purchasable, now, now]);
  const mappings = [];
  for (let index = 0; index < uoms; index += 1) {
    const [uom] = await h.db.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [`${code}-${index}`, now, now]);
    const [mapping] = await h.db.execute(
      "INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [row.insertId, uom.insertId, index === 0 ? 1 : 12, index === 0 ? 1 : 0, now, now]);
    mappings.push(Number(mapping.insertId));
    h.cleanup.push(["DELETE FROM item_uoms WHERE id = ?", [uom.insertId]]);
  }
  h.cleanup.push(["DELETE FROM items WHERE id = ?", [item.insertId]]);
  h.cleanup.push(["DELETE FROM item_skus WHERE id = ?", [row.insertId]]);
  h.cleanup.push(["DELETE FROM item_sku_uoms WHERE sku_id = ?", [row.insertId]]);
  return { id: Number(row.insertId), code, uoms: mappings };
}

async function supplier(status = "active") {
  const code = `SKS-${randomUUID().slice(0, 8)}`;
  const [row] = await h.db.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code, status, version,
       created_at, updated_at) VALUES (?, ?, ?, ?, 'HKD', ?, 1, ?, ?)`,
    [code, code.toLowerCase(), code, code.toLowerCase(), status, Date.now(), Date.now()]);
  h.supplierIds.push(Number(row.insertId));
  return Number(row.insertId);
}

const conflict = (code) => (error) => error.publicCode === code || error.code === code;

integrationTest("TASK-038 (MIG-007): without the Item SKU/UOM tables the migration refuses and creates nothing", async (t) => {
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
    password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined) });
  const scratch = `skr_${randomUUID().slice(0, 8)}`;
  t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``); await admin.end(); });
  await admin.query(`CREATE DATABASE \`${scratch}\``);
  await admin.query(`USE \`${scratch}\``);
  await assert.rejects(() => migrateSupplierSkuRefs(admin), /need the Item table item_skus/u);
  const [tables] = await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = ?", [scratch]);
  assert.deepEqual(tables, [], "no weakened table");
});

integrationTest("TASK-038 (SKU-004): create and update keep MOQ, lead time and status in bounds, with one audit each and no price", async () => {
  const supplierId = await supplier();
  const item = await sku({ uoms: 2 });
  const other = await sku();
  const created = await service().create({ ...actor(), supplierId, skuId: item.id, supplierItemCode: " AB-1 ", supplierItemName: "Widget",
    purchaseSkuUomId: item.uoms[1], minimumOrderQty: 1, standardLeadTimeDays: 3650, relationshipStatus: "preferred" });
  assert.deepEqual([created.supplierItemCode, created.purchaseSkuUomId, created.minimumOrderQty, created.standardLeadTimeDays,
    created.relationshipStatus, created.source, created.version, created.skuCode], ["AB-1", item.uoms[1], 1, 3650, "preferred", "manual", 1, item.code]);
  // 多個 preferred 都得（唔係白名單）。
  await service().create({ ...actor(), supplierId, skuId: other.id, relationshipStatus: "preferred" });

  const spare = await sku();
  for (const [field, value] of [["minimumOrderQty", 0], ["standardLeadTimeDays", 3651], ["standardLeadTimeDays", -1]]) {
    await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: spare.id, [field]: value }),
      conflict("SUPPLIER_SKU_RELATION_INVALID"), `${field}=${value}`);
  }
  const updated = await service().update({ ...actor(), supplierId, relationId: created.id, version: 1, supplierItemCode: "AB-1",
    supplierItemName: "Widget", purchaseSkuUomId: item.uoms[1], minimumOrderQty: 24, standardLeadTimeDays: 0, relationshipStatus: "stopped" });
  assert.deepEqual([updated.minimumOrderQty, updated.standardLeadTimeDays, updated.relationshipStatus, updated.version], [24, 0, "stopped", 2]);
  await assert.rejects(() => service().update({ ...actor(), supplierId, relationId: created.id, version: 1, relationshipStatus: "stopped" }),
    conflict("VERSION_CONFLICT"));

  const [audits] = await h.db.query("SELECT action, detail FROM supplier_audit_logs WHERE supplier_id = ? AND action LIKE 'supplier_sku.%' ORDER BY id",
    [supplierId]);
  assert.deepEqual(audits.map((row) => row.action), ["supplier_sku.create", "supplier_sku.create", "supplier_sku.update"]);
  const [columns] = await h.db.query(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'supplier_sku_refs'");
  assert.ok(!columns.some(({ name }) => /price|cost|amount|quote/iu.test(name)), "the table cannot hold a price (FR-SKU-006)");
});

integrationTest("TASK-038: one relation per Supplier and SKU, one SKU per Supplier Item Code, and the purchase UOM must belong to the SKU", async () => {
  const supplierId = await supplier();
  const [first, second] = [await sku(), await sku()];
  await service().create({ ...actor(), supplierId, skuId: first.id, supplierItemCode: "Code-9" });
  await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: first.id }), conflict("SUPPLIER_SKU_RELATION_EXISTS"));
  await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: second.id, supplierItemCode: "code-9" }),
    conflict("SUPPLIER_ITEM_CODE_TAKEN"), "the code key ignores case");
  await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: second.id, purchaseSkuUomId: first.uoms[0] }),
    conflict("SUPPLIER_SKU_UOM_INVALID"), "SKU A's UOM cannot be bound to SKU B");
  // 冇代碼嘅對照可以有幾條；另一個 Supplier 用同一個代碼都得。
  await service().create({ ...actor(), supplierId, skuId: second.id });
  await service().create({ ...actor(), supplierId: await supplier(), skuId: second.id, supplierItemCode: "CODE-9" });
});

integrationTest("TASK-038 (FR-SKU-005, Item §5.14): only purchasable SKUs become new targets; existing relations stay and can be stopped", async () => {
  const supplierId = await supplier();
  const item = await sku({ uoms: 2 });
  const relation = await service().create({ ...actor(), supplierId, skuId: item.id, relationshipStatus: "alternative" });
  for (const blocked of [await sku({ status: "inactive" }), await sku({ purchasable: 0 })]) {
    await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: blocked.id }), conflict("SUPPLIER_SKU_NOT_PURCHASABLE"));
  }
  await h.db.execute("UPDATE item_skus SET status = 'inactive' WHERE id = ?", [item.id]);
  const body = { ...actor(), supplierId, relationId: relation.id, supplierItemCode: "", supplierItemName: "", purchaseSkuUomId: null,
    minimumOrderQty: 6, standardLeadTimeDays: null, relationshipStatus: "stopped", version: 1 };
  const stopped = await service().update(body);
  assert.deepEqual([stopped.relationshipStatus, stopped.skuStatus], ["stopped", "inactive"], "kept as history and shows the SKU status");
  await assert.rejects(() => service().update({ ...body, version: 2, relationshipStatus: "preferred" }), conflict("SUPPLIER_SKU_NOT_PURCHASABLE"),
    "reactivating is a new purchasing target");
  await assert.rejects(() => service().update({ ...body, version: 2, purchaseSkuUomId: item.uoms[1] }), conflict("SUPPLIER_SKU_NOT_PURCHASABLE"),
    "rebinding the purchase UOM is a new purchasing target");
  const [[state]] = await h.db.query("SELECT status FROM item_skus WHERE id = ?", [item.id]);
  assert.equal(state.status, "inactive", "a relation never changes the SKU");

  const [archived, fresh] = [await supplier("archived"), await sku()];
  await assert.rejects(() => service().create({ ...actor(), supplierId: archived, skuId: fresh.id }), conflict("SUPPLIER_SKU_RELATION_NOT_ALLOWED"));
});

integrationTest("TASK-038 (SKU-006): recordSupply is idempotent, never makes a relation preferred and fails closed without a source verifier", async () => {
  const supplierId = await supplier("suspended");
  const item = await sku({ status: "inactive" });
  const command = { eventId: `gr-${randomUUID()}`, sourceType: "goods_receipt", sourceId: 501, sourceLineId: 1, supplierId, skuId: item.id,
    purchaseSkuUomId: item.uoms[0], supplierItemCode: "GR-CODE", suppliedAt: 1_000 };
  await assert.rejects(() => service().recordSupply(command), conflict("SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE"));
  assert.equal(Number((await h.db.query("SELECT COUNT(*) AS n FROM supplier_sku_refs WHERE sku_id = ?", [item.id]))[0][0].n), 0);

  const verified = [];
  const projector = service({ verifySource: async (_connection, value) => { verified.push(value.sourceId); } });
  const first = await projector.recordSupply(command);
  assert.equal(first.replayed, false);
  const again = await projector.recordSupply(command);
  assert.deepEqual(again, { ...first, replayed: true });
  assert.deepEqual(verified, [501], "a replay does not ask Purchasing again");
  const [[relation]] = await h.db.query("SELECT * FROM supplier_sku_refs WHERE id = ?", [first.relationId]);
  assert.deepEqual([relation.source, relation.relationship_status, relation.supplier_item_code, Number(relation.first_supplied_at),
    Number(relation.last_supplied_at)], ["purchasing", "alternative", "GR-CODE", 1_000, 1_000]);

  await assert.rejects(() => projector.recordSupply({ ...command, suppliedAt: 2_000 }), conflict("IDEMPOTENCY_CONFLICT"), "same event, other payload");
  await assert.rejects(() => projector.recordSupply({ ...command, eventId: `gr-${randomUUID()}` }), conflict("IDEMPOTENCY_CONFLICT"),
    "same source line, other event");

  await h.db.execute("UPDATE supplier_sku_refs SET relationship_status = 'preferred' WHERE id = ?", [first.relationId]);
  for (const [line, at] of [[2, 500], [3, 3_000]]) {
    await projector.recordSupply({ ...command, eventId: `gr-${randomUUID()}`, sourceLineId: line, suppliedAt: at });
  }
  const [[later]] = await h.db.query("SELECT * FROM supplier_sku_refs WHERE id = ?", [first.relationId]);
  assert.deepEqual([later.relationship_status, Number(later.first_supplied_at), Number(later.last_supplied_at)], ["preferred", 500, 3_000]);
  const [[counts]] = await h.db.query(`SELECT (SELECT COUNT(*) FROM supplier_supply_events WHERE relation_id = ?) AS events,
    (SELECT COUNT(*) FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier_sku.supply') AS audits`, [first.relationId, supplierId]);
  assert.deepEqual([Number(counts.events), Number(counts.audits)], [3, 3], "one event and one audit per source line, none for replays");
  const [[states]] = await h.db.query("SELECT (SELECT status FROM suppliers WHERE id = ?) AS supplier, (SELECT status FROM item_skus WHERE id = ?) AS item",
    [supplierId, item.id]);
  assert.deepEqual([states.supplier, states.item], ["suspended", "inactive"], "history projection changes neither status");

  // 同一個 Supplier 嘅代碼已經用咗：新對照照樣建，只係唔帶代碼。
  const taken = await sku();
  const projected = await projector.recordSupply({ ...command, eventId: `gr-${randomUUID()}`, sourceId: 502, skuId: taken.id, purchaseSkuUomId: null });
  const [[noCode]] = await h.db.query("SELECT supplier_item_code, supplier_item_code_key FROM supplier_sku_refs WHERE id = ?", [projected.relationId]);
  assert.deepEqual([noCode.supplier_item_code, noCode.supplier_item_code_key], ["", null]);
});

integrationTest("TASK-038: a Supplier with a SKU relation cannot be permanently deleted", async () => {
  const supplierId = await supplier("draft");
  await service().create({ ...actor(), supplierId, skuId: (await sku()).id });
  await assert.rejects(() => h.db.execute("DELETE FROM suppliers WHERE id = ?", [supplierId]),
    (error) => /fk_supplier_sku_refs_supplier/u.test(String(error?.cause?.message)));
});

integrationTest("TASK-038: a rerun accepts the real tables but refuses a hand-made one whose foreign keys differ", async (t) => {
  assert.equal(await inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs"), true);
  assert.equal(await inspectSupplierSkuRelationSchema(h.db, "supplier_supply_events"), true);
  const probe = `skr_probe_${randomUUID().slice(0, 8)}`;
  t.after(() => h.db.query(`DROP TABLE IF EXISTS \`${probe}\``));
  // LIKE 複製欄位同 index，但唔複製 FK。
  await h.db.query(`CREATE TABLE \`${probe}\` LIKE supplier_sku_refs`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: probe }), /foreign key/u, "no foreign keys at all");
  const addKeys = (supplierRule) => h.db.query(`ALTER TABLE \`${probe}\`
    ADD CONSTRAINT fk_${probe}_s FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE ${supplierRule},
    ADD CONSTRAINT fk_${probe}_k FOREIGN KEY (sku_id) REFERENCES item_skus (id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_${probe}_u FOREIGN KEY (purchase_sku_uom_id, sku_id) REFERENCES item_sku_uoms (id, sku_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_${probe}_c FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_${probe}_p FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL`);
  await addKeys("RESTRICT");
  assert.equal(await inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: probe }), true, "control: the designed keys pass");
  await h.db.query(`ALTER TABLE \`${probe}\` DROP FOREIGN KEY fk_${probe}_s`);
  await h.db.query(`ALTER TABLE \`${probe}\` ADD CONSTRAINT fk_${probe}_s FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: probe }),
    /foreign key: supplier_sku_refs\.supplier_id>suppliers\(id\):RESTRICT/u, "a CASCADE would delete relations with their Supplier");
});

/** 一個有真權限嘅用戶同 token；`claims` 可以同 DB 唔一致，用嚟測 PERMISSION_STALE。 */
async function httpUser(permissions, { claims = permissions } = {}) {
  const name = `skrh-${randomUUID().slice(0, 8)}`;
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

async function api(user, method, url, body) {
  const response = await fetch(`${h.url}${url}`, { method, headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json, code: json?.error?.code ?? json?.code };
}

const fullUpdate = (row, changes = {}) => ({ supplierItemCode: row.supplierItemCode, supplierItemName: row.supplierItemName,
  purchaseSkuUomId: row.purchaseSkuUomId, minimumOrderQty: row.minimumOrderQty, standardLeadTimeDays: row.standardLeadTimeDays,
  relationshipStatus: row.relationshipStatus, version: row.version, ...changes });

integrationTest("TASK-038 (REV-085 M1, M2): over HTTP, authorization, the owner check, list search and a partial update are enforced", async () => {
  const [manager, viewer] = [await httpUser(["supplier.mgmt", "supplier.view"]), await httpUser(["supplier.view"])];
  const stale = await httpUser(["supplier.view"], { claims: ["supplier.view", "supplier.mgmt"] });
  const [supplierA, supplierB] = [await supplier(), await supplier()];
  const [widget, gadget, third] = [await sku(), await sku(), await sku()];
  const created = await api(manager, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/create`,
    { skuId: widget.id, supplierItemCode: "50%_off\\x", supplierItemName: "Widget", minimumOrderQty: 5 });
  assert.equal(created.status, 201);
  await api(manager, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/create`, { skuId: gadget.id, supplierItemCode: "50-off", relationshipStatus: "preferred" });
  await api(manager, "POST", `/api/v1/suppliers/${supplierB}/sku-relations/create`, { skuId: third.id, supplierItemCode: "50%_off-b" });

  assert.equal((await api(viewer, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/create`, { skuId: third.id })).status, 403);
  assert.equal((await api(stale, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/create`, { skuId: third.id })).code, "PERMISSION_STALE");
  assert.equal((await api(stale, "GET", `/api/v1/suppliers/${supplierA}/sku-relations`)).code, "PERMISSION_STALE", "list checks the actor too");
  assert.equal((await api(manager, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/create`, { skuId: third.id, price: 1 })).status, 400);

  // List：只列呢個 Supplier；preferred 排先；% 同 _ 係字面；SKU Code 精確搵到；分頁。
  const all = await api(viewer, "GET", `/api/v1/suppliers/${supplierA}/sku-relations`);
  assert.deepEqual([all.status, all.data.total, all.data.items.map((row) => row.skuId)], [200, 2, [gadget.id, widget.id]]);
  const literal = await api(viewer, "GET", `/api/v1/suppliers/${supplierA}/sku-relations?q=${encodeURIComponent("50%_")}`);
  assert.deepEqual(literal.data.items.map((row) => row.skuId), [widget.id], "% and _ match themselves, not anything");
  const byCode = await api(viewer, "GET", `/api/v1/suppliers/${supplierA}/sku-relations?q=${encodeURIComponent(gadget.code)}`);
  assert.deepEqual(byCode.data.items.map((row) => row.skuId), [gadget.id]);
  const page2 = await api(viewer, "GET", `/api/v1/suppliers/${supplierA}/sku-relations?pageSize=1&page=2`);
  assert.deepEqual([page2.data.total, page2.data.items.map((row) => row.skuId)], [2, [widget.id]]);
  assert.equal((await api(viewer, "GET", `/api/v1/suppliers/${supplierA}/sku-relations?pageSize=101`)).status, 400);

  // 另一個 Supplier 嘅路徑改唔到呢條關係（IDOR），而且唔透露佢存在。
  const relation = created.data;
  const foreign = await api(manager, "POST", `/api/v1/suppliers/${supplierB}/sku-relations/${relation.id}/update`, fullUpdate(relation));
  assert.deepEqual([foreign.status, foreign.code], [404, "SUPPLIER_SKU_RELATION_NOT_FOUND"]);
  // 漏帶欄位係 400，唔係靜靜雞清空（M1）。
  const partial = await api(manager, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/${relation.id}/update`,
    { relationshipStatus: "stopped", version: relation.version });
  assert.equal(partial.status, 400);
  const [[stored]] = await h.db.query("SELECT supplier_item_code, minimum_order_qty, version FROM supplier_sku_refs WHERE id = ?", [relation.id]);
  assert.deepEqual([stored.supplier_item_code, Number(stored.minimum_order_qty), Number(stored.version)], ["50%_off\\x", 5, 1]);

  await h.db.execute("UPDATE suppliers SET status = 'archived' WHERE id = ?", [supplierA]);
  const archived = await api(manager, "POST", `/api/v1/suppliers/${supplierA}/sku-relations/${relation.id}/update`,
    fullUpdate(relation, { relationshipStatus: "stopped" }));
  assert.deepEqual([archived.status, archived.code], [409, "SUPPLIER_SKU_RELATION_NOT_ALLOWED"]);
});

integrationTest("TASK-038 (REV-085 H1): more concurrent rebinds than the pool has connections all succeed", async () => {
  const pool = h.application.configuration.database.connectionLimit;
  const work = [];
  for (let index = 0; index < pool + 2; index += 1) {
    const [supplierId, item] = [await supplier(), await sku({ uoms: 2 })];
    const relation = await service().create({ ...actor(), supplierId, skuId: item.id });
    work.push(() => service().update({ ...actor(), supplierId, relationId: relation.id, ...fullUpdate(relation, { purchaseSkuUomId: item.uoms[1] }) }));
  }
  const results = await Promise.allSettled(work.map((run) => run()));
  assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => result.reason?.message), []);
});

integrationTest("TASK-038 (REV-085 H2): concurrent first projections do not deadlock, and identical events write once", async () => {
  const projector = service({ verifySource: async () => {} });
  for (let round = 0; round < 5; round += 1) {
    const commands = [];
    for (let index = 0; index < 4; index += 1) {
      const [supplierId, item] = [await supplier(), await sku()];
      commands.push({ eventId: `gr-${randomUUID()}`, sourceType: "goods_receipt", sourceId: 700 + round, sourceLineId: index + 1,
        supplierId, skuId: item.id, purchaseSkuUomId: null, supplierItemCode: "", suppliedAt: 1_000 });
    }
    const results = await Promise.allSettled(commands.map((command) => projector.recordSupply(command)));
    assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => result.reason?.cause?.code ?? result.reason?.message), [], `round ${round}`);
  }
  const [supplierId, item] = [await supplier(), await sku()];
  const same = { eventId: `gr-${randomUUID()}`, sourceType: "goods_receipt", sourceId: 800, sourceLineId: 1, supplierId, skuId: item.id,
    purchaseSkuUomId: null, supplierItemCode: "", suppliedAt: 2_000 };
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => projector.recordSupply(same)));
  assert.equal(outcomes.filter((outcome) => !outcome.replayed).length, 1);
  assert.equal(new Set(outcomes.map((outcome) => outcome.relationId)).size, 1);
  const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_supply_events WHERE event_id = ?", [same.eventId]);
  assert.equal(Number(n), 1);
});

integrationTest("TASK-038 (REV-085 L1, L4, L5, L6 and M2): command checks, case-sensitive events, long codes, no projected UOM, clearing a UOM", async () => {
  const projector = service({ verifySource: async () => {} });
  const [supplierId, item] = [await supplier(), await sku({ uoms: 2 })];
  const base = { eventId: "GR-x", sourceType: "goods_receipt", sourceId: 900, sourceLineId: 1, supplierId, skuId: item.id,
    purchaseSkuUomId: item.uoms[1], supplierItemCode: "ﷺ".repeat(11), suppliedAt: 3_000 };
  for (const [field, value] of [["eventId", "gr x"], ["eventId", "貨-1"], ["sourceType", "invoice"], ["suppliedAt", -1], ["sourceId", 0]]) {
    await assert.rejects(() => projector.recordSupply({ ...base, [field]: value }), conflict("SUPPLIER_SUPPLY_INVALID"), `${field}=${value}`);
  }
  await assert.rejects(() => projector.recordSupply({ ...base, supplierId: 2_000_000_000 }), (error) => error.statusCode === 404);
  await assert.rejects(() => projector.recordSupply({ ...base, eventId: "GR-nosku", skuId: 2_000_000_000 }), conflict("SUPPLIER_SKU_NOT_FOUND"));

  // 「ﷺ」×11 正規化後係 198 個字元：投影照樣建關係，只係唔帶代碼；採購單位唔由投影設定，只記喺稽核。
  const first = await projector.recordSupply(base);
  const [[relation]] = await h.db.query("SELECT supplier_item_code, supplier_item_code_key, purchase_sku_uom_id FROM supplier_sku_refs WHERE id = ?",
    [first.relationId]);
  assert.deepEqual([relation.supplier_item_code, relation.supplier_item_code_key, relation.purchase_sku_uom_id], ["", null, null]);
  const [[audit]] = await h.db.query("SELECT detail FROM supplier_audit_logs WHERE supplier_id = ? AND action = 'supplier_sku.supply'", [supplierId]);
  assert.equal((typeof audit.detail === "string" ? JSON.parse(audit.detail) : audit.detail).after.reportedPurchaseSkuUomId, item.uoms[1]);
  // event_id 大小寫有分：「gr-x」係另一個 event（另一張來源單據行）。
  const lower = await projector.recordSupply({ ...base, eventId: "gr-x", sourceLineId: 2 });
  assert.equal(lower.replayed, false);
  // 手動新增時，同一個超長代碼係輸入錯，唔係 500。
  const longCodeSku = await sku();
  await assert.rejects(() => service().create({ ...actor(), supplierId, skuId: longCodeSku.id, supplierItemCode: "ﷺ".repeat(11) }),
    conflict("SUPPLIER_SKU_RELATION_INVALID"));

  // SKU 停用之後，清空採購單位唔算改綁（L6）；改綁就要可以採購。
  const manual = await service().create({ ...actor(), supplierId, skuId: (await sku({ uoms: 2 })).id });
  const [[ownedUom]] = await h.db.query("SELECT id FROM item_sku_uoms WHERE sku_id = ? ORDER BY id DESC LIMIT 1", [manual.skuId]);
  const bound = await service().update({ ...actor(), supplierId, relationId: manual.id, ...fullUpdate(manual, { purchaseSkuUomId: Number(ownedUom.id) }) });
  await h.db.execute("UPDATE item_skus SET status = 'inactive' WHERE id = ?", [manual.skuId]);
  const cleared = await service().update({ ...actor(), supplierId, relationId: manual.id, ...fullUpdate(bound, { purchaseSkuUomId: null }) });
  assert.equal(cleared.purchaseSkuUomId, null);
});

integrationTest("TASK-038 (REV-085 M2, HD-090 L4): a rerun refuses a missing column, a missing index or a case-insensitive event_id", async (t) => {
  const probes = [];
  t.after(async () => { for (const probe of probes) await h.db.query(`DROP TABLE IF EXISTS \`${probe}\``); });
  const like = async (table) => {
    const probe = `skr_probe_${randomUUID().slice(0, 8)}`;
    probes.push(probe);
    await h.db.query(`CREATE TABLE \`${probe}\` LIKE ${table}`);
    return probe;
  };
  const events = await like("supplier_supply_events");
  await h.db.query(`ALTER TABLE \`${events}\` MODIFY event_id VARCHAR(64) NOT NULL`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_supply_events", { as: events }), /collation: supplier_supply_events\.event_id/u);
  const missingIndex = await like("supplier_sku_refs");
  await h.db.query(`ALTER TABLE \`${missingIndex}\` DROP INDEX idx_supplier_sku_refs_sku_status_supplied`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: missingIndex }), /index: supplier_sku_refs/u);
  const extraColumn = await like("supplier_sku_refs");
  await h.db.query(`ALTER TABLE \`${extraColumn}\` ADD COLUMN unit_price DECIMAL(12,2) NULL`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: extraColumn }),
    /Incompatible existing Supplier schema: supplier_sku_refs$/u, "an extra column (a price) is refused");
  const missingColumn = await like("supplier_sku_refs");
  await h.db.query(`ALTER TABLE \`${missingColumn}\` DROP COLUMN source`);
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: missingColumn }), /Incompatible existing Supplier schema: supplier_sku_refs/u);
});

integrationTest("TASK-038 (REV-085 M2): without UNIQUE(id, sku_id) on item_sku_uoms the migration refuses", async (t) => {
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
    password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined) });
  const scratch = `skr_${randomUUID().slice(0, 8)}`;
  t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``); await admin.end(); });
  await admin.query(`CREATE DATABASE \`${scratch}\``);
  await admin.query(`USE \`${scratch}\``);
  await admin.query("CREATE TABLE item_skus (id BIGINT UNSIGNED NOT NULL PRIMARY KEY)");
  await admin.query("CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED NOT NULL PRIMARY KEY, sku_id BIGINT UNSIGNED NOT NULL)");
  await assert.rejects(() => migrateSupplierSkuRefs(admin), /need UNIQUE\(id, sku_id\) on item_sku_uoms/u);
  const [tables] = await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'supplier%'", [scratch]);
  assert.deepEqual(tables, []);
});

integrationTest("TASK-038 (REV-086 M-1): creates and first projections above the pool size all succeed", async () => {
  const over = h.application.configuration.database.connectionLimit + 2;
  const creates = [];
  const projections = [];
  const projector = service({ verifySource: async () => {} });
  for (let index = 0; index < over; index += 1) {
    const [supplierA, supplierB, itemA, itemB] = [await supplier(), await supplier(), await sku(), await sku()];
    creates.push(() => service().create({ ...actor(), supplierId: supplierA, skuId: itemA.id }));
    projections.push(() => projector.recordSupply({ eventId: `gr-${randomUUID()}`, sourceType: "goods_receipt", sourceId: 1_100, sourceLineId: index + 1,
      supplierId: supplierB, skuId: itemB.id, purchaseSkuUomId: null, supplierItemCode: "", suppliedAt: 5_000 }));
  }
  for (const [label, work] of [["create", creates], ["recordSupply", projections]]) {
    const results = await Promise.allSettled(work.map((run) => run()));
    assert.deepEqual(results.filter((result) => result.status === "rejected").map((result) => result.reason?.message), [], label);
  }
});

integrationTest("TASK-038 (REV-086 M-1): the same event or source line sent to different Suppliers succeeds once and conflicts for the rest", async () => {
  const projector = service({ verifySource: async () => {} });
  for (const variant of ["same event", "same source line"]) {
    const suppliers = [await supplier(), await supplier(), await supplier(), await supplier()];
    const item = await sku();
    const eventId = `gr-${randomUUID()}`;
    const results = await Promise.allSettled(suppliers.map((supplierId, index) => projector.recordSupply({
      // 每個 variant 用自己嘅來源單據：「same event」各行唔同，「same source line」各 event 唔同。
      eventId: variant === "same event" ? eventId : `${eventId}-${index}`, sourceType: "goods_receipt",
      sourceId: variant === "same event" ? 1_200 : 1_201, sourceLineId: variant === "same event" ? index + 1 : 1,
      supplierId, skuId: item.id, purchaseSkuUomId: null, supplierItemCode: "", suppliedAt: 6_000 })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, variant);
    assert.deepEqual([...new Set(results.filter((result) => result.status === "rejected").map((result) => result.reason?.publicCode))],
      ["IDEMPOTENCY_CONFLICT"], variant);
    const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_sku_refs WHERE sku_id = ?", [item.id]);
    assert.equal(Number(n), 1, `${variant}: the losing Suppliers keep no relation`);
  }
});

integrationTest("TASK-038 (REV-086 M-1, L-1): over HTTP, stale actors are refused on create and update, every update field is required, and the list order holds", async () => {
  const manager = await httpUser(["supplier.mgmt", "supplier.view"]);
  const stale = await httpUser(["supplier.view"], { claims: ["supplier.view", "supplier.mgmt"] });
  const supplierId = await supplier();
  const [preferred, recent, older, stopped, blocked] = [await sku(), await sku(), await sku(), await sku(), await sku({ status: "inactive" })];
  // 一個過期 token 唔可以靠「SKU 唔可以採購」嘅錯誤探聽 SKU（L3）：先係權限錯誤。
  assert.equal((await api(stale, "POST", `/api/v1/suppliers/${supplierId}/sku-relations/create`, { skuId: blocked.id })).code, "PERMISSION_STALE");
  // preferred 最先建立（id 最細）：排序靠狀態同供貨時間，唔係 id。
  const created = {};
  for (const [name, item, status] of [["preferred", preferred, "preferred"], ["older", older, "alternative"], ["recent", recent, "alternative"],
    ["stopped", stopped, "stopped"]]) {
    created[name] = (await api(manager, "POST", `/api/v1/suppliers/${supplierId}/sku-relations/create`, { skuId: item.id, relationshipStatus: status })).data;
  }
  await h.db.execute("UPDATE supplier_sku_refs SET last_supplied_at = ? WHERE id = ?", [9_000, created.recent.id]);
  await h.db.execute("UPDATE supplier_sku_refs SET last_supplied_at = ? WHERE id = ?", [1_000, created.older.id]);
  const listed = await api(manager, "GET", `/api/v1/suppliers/${supplierId}/sku-relations`);
  assert.deepEqual(listed.data.items.map((row) => row.id), [created.preferred.id, created.recent.id, created.older.id, created.stopped.id]);

  const relation = (await api(manager, "GET", `/api/v1/suppliers/${supplierId}/sku-relations?q=${encodeURIComponent(older.code)}`)).data.items[0];
  const body = fullUpdate(relation);
  assert.equal((await api(stale, "POST", `/api/v1/suppliers/${supplierId}/sku-relations/${relation.id}/update`, body)).code, "PERMISSION_STALE");
  for (const field of Object.keys(body)) {
    const { [field]: _dropped, ...partial } = body;
    assert.equal((await api(manager, "POST", `/api/v1/suppliers/${supplierId}/sku-relations/${relation.id}/update`, partial)).status, 400, field);
  }
  const [[stored]] = await h.db.query("SELECT version FROM supplier_sku_refs WHERE id = ?", [relation.id]);
  assert.equal(Number(stored.version), relation.version, "no refused update changed the row");
});

integrationTest("TASK-038 (REV-086 L-1): command checks per field, empty codes on one Supplier, and the projection's version bump", async () => {
  const projector = service({ verifySource: async () => {} });
  const [supplierId, item] = [await supplier(), await sku()];
  const base = { eventId: `gr-${randomUUID()}`, sourceType: "goods_receipt", sourceId: 1_300, sourceLineId: 1, supplierId, skuId: item.id,
    purchaseSkuUomId: null, supplierItemCode: "", suppliedAt: 7_000 };
  for (const [field, value] of [["eventId", "e".repeat(65)], ["skuId", 0], ["purchaseSkuUomId", -1], ["supplierItemCode", "bell\u0007"]]) {
    await assert.rejects(() => projector.recordSupply({ ...base, [field]: value }),
      (error) => error.publicCode === "SUPPLIER_SUPPLY_INVALID" && error.details?.field === field, `${field}`);
  }
  // 兩條冇代碼嘅關係可以喺同一個 Supplier（key 係 NULL，唔係 ""）。
  const [first, second] = [await service().create({ ...actor(), supplierId, skuId: (await sku()).id }),
    await service().create({ ...actor(), supplierId, skuId: (await sku()).id })];
  const [[keys]] = await h.db.query("SELECT COUNT(*) AS n, SUM(supplier_item_code_key IS NULL) AS nulls FROM supplier_sku_refs WHERE id IN (?, ?)",
    [first.id, second.id]);
  assert.deepEqual([Number(keys.n), Number(keys.nulls)], [2, 2]);
  // 投影更新現有關係時版本要加，咁用戶手上嘅舊版本修改會撞版本，而唔係覆蓋投影。
  const projected = await projector.recordSupply({ ...base, skuId: first.skuId });
  assert.equal(projected.relationId, first.id);
  const [[after]] = await h.db.query("SELECT version FROM supplier_sku_refs WHERE id = ?", [first.id]);
  assert.equal(Number(after.version), first.version + 1);
});

integrationTest("TASK-038 (REV-086 L-1): a rerun refuses a case-insensitive code key, a non-binary payload hash and a changed column type", async (t) => {
  const probes = [];
  t.after(async () => { for (const probe of probes) await h.db.query(`DROP TABLE IF EXISTS \`${probe}\``); });
  const like = async (table, alter) => {
    const probe = `skr_probe_${randomUUID().slice(0, 8)}`;
    probes.push(probe);
    await h.db.query(`CREATE TABLE \`${probe}\` LIKE ${table}`);
    await h.db.query(`ALTER TABLE \`${probe}\` ${alter}`);
    return probe;
  };
  const codeKey = await like("supplier_sku_refs", "MODIFY supplier_item_code_key VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL");
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: codeKey }), /collation: supplier_sku_refs\.supplier_item_code_key/u);
  const hash = await like("supplier_supply_events", "MODIFY payload_hash CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL");
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_supply_events", { as: hash }), /collation: supplier_supply_events\.payload_hash/u);
  const widened = await like("supplier_sku_refs", "MODIFY minimum_order_qty BIGINT UNSIGNED NULL");
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: widened }), /schema: supplier_sku_refs\.minimum_order_qty/u);
  const required = await like("supplier_sku_refs", "MODIFY purchase_sku_uom_id BIGINT UNSIGNED NOT NULL");
  await assert.rejects(() => inspectSupplierSkuRelationSchema(h.db, "supplier_sku_refs", { as: required }), /schema: supplier_sku_refs\.purchase_sku_uom_id/u);
});
