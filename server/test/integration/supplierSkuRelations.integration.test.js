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
const h = { cleanup: [], userId: null, supplierIds: [], skuIds: [] };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  h.logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-sku-logs-"));
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  h.application = await createApplication({ configurationSource: { ...source, logging: { loggers: {
    request: { ...source.logging.loggers.request, directory: path.join(h.logRoot, "requests") },
    system: { ...source.logging.loggers.system, directory: path.join(h.logRoot, "system") } } } } });
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
