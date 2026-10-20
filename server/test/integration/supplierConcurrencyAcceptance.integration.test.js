import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";

/**
 * TASK-051 step 2b：SKU-005（relation 唯一性同 FK）同 IMP-008（匯入 upload／confirm 冪等），真 app、真 HTTP、真 MySQL，
 * 並發請求同時發出，再喺 DB 直接試錯誤資料。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = Object.assign(createSupplierHarness("con51"), { users: {} });

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
});

after(() => h.stop());

const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function purchasableSku(code, uoms = 1) {
  const now = Date.now();
  const [item] = await h.db.execute("INSERT INTO items (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)", [code, now, now]);
  h.cleanup.push(["DELETE FROM items WHERE id = ?", [item.insertId]]);
  const [sku] = await h.db.execute(
    "INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, ?, ?)",
    [item.insertId, code, code, now, now]);
  h.cleanup.push(["DELETE FROM item_skus WHERE id = ?", [sku.insertId]]);
  const mappings = [];
  for (let index = 0; index < uoms; index += 1) {
    const [uom] = await h.db.execute("INSERT INTO item_uoms (code, name, created_at, updated_at) VALUES (?, 'Each', ?, ?)", [`${code}-${index}`, now, now]);
    h.cleanup.push(["DELETE FROM item_uoms WHERE id = ?", [uom.insertId]]);
    const [mapping] = await h.db.execute(
      "INSERT INTO item_sku_uoms (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [sku.insertId, uom.insertId, index === 0 ? 1 : 12, index === 0 ? 1 : 0, now, now]);
    h.cleanup.push(["DELETE FROM item_sku_uoms WHERE id = ?", [mapping.insertId]]);
    mappings.push(Number(mapping.insertId));
  }
  return { id: Number(sku.insertId), uoms: mappings };
}

integrationTest("TC-082 (SKU-005): concurrent creates keep one relation per Supplier and SKU and one Supplier item code per Supplier, and the database itself refuses duplicates and a UOM of another SKU, keyed by IDs only", async () => {
  const t = tag();
  const supplierId = await h.seedSupplier(`REL-${t}`, `Relation ${t}`);
  const skuA = await purchasableSku(`RA-${t}`);
  const skuB = await purchasableSku(`RB-${t}`);
  const create = (body) => h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:id/sku-relations/create"), { ids: { id: supplierId }, body });

  // 同一個 Supplier＋SKU 同時建立：一個成功，其餘 409，DB 只得一行。
  const sameSku = await Promise.all(Array.from({ length: 5 }, () => create({ skuId: skuA.id, purchaseSkuUomId: skuA.uoms[0] })));
  assert.equal(sameSku.filter((r) => r.status === 201).length, 1, sameSku.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(sameSku.every((r) => r.status === 201 || (r.status === 409 && r.code === "SUPPLIER_SKU_RELATION_EXISTS")),
    sameSku.map((r) => `${r.status} ${r.code}`).join(","));
  // 同一個 Supplier 商品代碼同時用喺兩個 SKU：一個成功，另一個 409。
  const skuC = await purchasableSku(`RC-${t}`);
  const sameCode = await Promise.all([skuB, skuC].map((sku) => create({ skuId: sku.id, purchaseSkuUomId: sku.uoms[0], supplierItemCode: `ITEM-${t}` })));
  assert.deepEqual(sameCode.map((r) => r.status).sort(), [201, 409], sameCode.map((r) => r.text).join(" | "));
  assert.equal(sameCode.find((r) => r.status === 409).code, "SUPPLIER_ITEM_CODE_TAKEN");
  // 另一個 SKU 嘅採購單位：400。
  const freeSku = await purchasableSku(`RD-${t}`);
  const foreignUom = await create({ skuId: freeSku.id, purchaseSkuUomId: skuA.uoms[0] });
  assert.deepEqual([foreignUom.status, foreignUom.code], [400, "SUPPLIER_SKU_UOM_INVALID"], foreignUom.text);
  const [rows] = await h.db.query("SELECT sku_id, supplier_item_code FROM supplier_sku_refs WHERE supplier_id = ? ORDER BY sku_id", [supplierId]);
  assert.equal(rows.filter((row) => Number(row.sku_id) === skuA.id).length, 1);
  assert.equal(rows.filter((row) => row.supplier_item_code === `ITEM-${t}`).length, 1);

  // 直接喺 DB 試：約束本身擋，唔係靠 service。
  const now = Date.now();
  const insert = (fields) => h.db.execute(
    `INSERT INTO supplier_sku_refs (supplier_id, sku_id, purchase_sku_uom_id, supplier_item_code, supplier_item_code_key, relationship_status,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'alternative', ?, ?)`,
    [fields.supplierId ?? supplierId, fields.skuId, fields.uomId ?? null, fields.code ?? "", fields.code ? fields.code.toLowerCase() : null, now, now]);
  const refused = async (fields, codeName) => {
    await assert.rejects(insert(fields), (error) => [error, error.cause].some((link) => link?.code === codeName), JSON.stringify(fields));
  };
  await refused({ skuId: skuA.id }, "ER_DUP_ENTRY");
  const losingSku = [skuB, skuC][sameCode.findIndex((r) => r.status === 409)];
  await refused({ skuId: losingSku.id, code: `ITEM-${t}` }, "ER_DUP_ENTRY");
  await refused({ skuId: freeSku.id, uomId: skuA.uoms[0] }, "ER_NO_REFERENCED_ROW_2");
  await refused({ skuId: freeSku.id, supplierId: 999_999_999 }, "ER_NO_REFERENCED_ROW_2");
  // DEF-029：0087 之前呢行會入到（FK 冇檢查）。
  await refused({ skuId: 999_999_999 }, "ER_NO_REFERENCED_ROW_2");

  // 關係只靠 ID：每條 FK 都指向 id 欄，冇一條用 code 或 name。
  const [foreignKeys] = await h.db.query(
    `SELECT constraint_name AS name, column_name AS columnName, referenced_table_name AS referencedTable, referenced_column_name AS referencedColumn
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = 'supplier_sku_refs' AND referenced_table_name IS NOT NULL ORDER BY name, ordinal_position`);
  assert.deepEqual(foreignKeys.map((key) => [key.name, key.columnName, key.referencedTable, key.referencedColumn]), [
    ["fk_supplier_sku_refs_created_by", "created_by", "users", "id"],
    ["fk_supplier_sku_refs_purchase_uom", "purchase_sku_uom_id", "item_sku_uoms", "id"],
    ["fk_supplier_sku_refs_purchase_uom", "sku_id", "item_sku_uoms", "sku_id"],
    ["fk_supplier_sku_refs_sku", "sku_id", "item_skus", "id"],
    ["fk_supplier_sku_refs_supplier", "supplier_id", "suppliers", "id"],
    ["fk_supplier_sku_refs_updated_by", "updated_by", "users", "id"]
  ]);
});

async function upload(content, key) {
  const form = new FormData();
  form.append("mode", "create_only");
  form.append("file", new Blob([content], { type: "text/csv" }), "suppliers.csv");
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
    headers: { authorization: `Bearer ${h.users.mgmt.token}`, "idempotency-key": key } });
  const json = await response.json();
  if (response.status === 201 && !h.jobIds.includes(json.data.id)) h.jobIds.push(json.data.id);
  return { status: response.status, code: json.error?.code ?? null, json };
}

async function precheck(jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await h.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === jobId) return;
  }
}

async function execute(jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [[job]] = await h.db.query("SELECT status FROM supplier_import_jobs WHERE id = ?", [jobId]);
    if (!["queued", "running"].includes(job.status)) return job.status;
    const result = await h.worker.runExecution(new AbortController().signal);
    if (!result.claimed) await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error(`job ${jobId} never finished`);
}

integrationTest("TC-093 (IMP-008): one key makes one job whether repeated or raced, a different file under it is refused, a double confirm queues once, and the same file under a second key is refused at precheck once the first has run", async () => {
  const t = tag();
  const csv = (codes) => stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...codes.map((code) =>
    SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({ supplierCode: code, supplierName: `Imported ${code}`, defaultCurrencyCode: "HKD" })[name] ?? ""))],
  SUPPLIER_CSV_STRINGIFY_OPTIONS);
  const codes = [`IMA-${t}`, `IMB-${t}`];
  const file = csv(codes);
  const jobsBefore = async () => {
    const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs WHERE created_by = ?", [h.users.mgmt.userId]);
    return Number(n);
  };
  const start = await jobsBefore();

  // 同 key：連續重送回同一個 job；同時送都只得一個 job。
  const key = randomUUID();
  const first = await upload(file, key);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const repeat = await upload(file, key);
  assert.deepEqual([repeat.status, repeat.json.data?.id], [201, first.json.data.id], "the repeat replays the first job");
  const changed = await upload(csv([`IMX-${t}`]), key);
  assert.deepEqual([changed.status, changed.code], [409, "IDEMPOTENCY_CONFLICT"], JSON.stringify(changed.json));
  const raceKey = randomUUID();
  const raced = await Promise.all(Array.from({ length: 4 }, () => upload(csv([`IMR-${t}`]), raceKey)));
  const racedIds = new Set(raced.filter((r) => r.status === 201).map((r) => r.json.data.id));
  assert.equal(racedIds.size, 1, raced.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(raced.every((r) => r.status === 201 || r.code === "IDEMPOTENCY_IN_PROGRESS"), raced.map((r) => `${r.status} ${r.code}`).join(","));
  // 至少一個撞到「處理中」：證明請求真係重疊，唔係逐個做完（REV-100 L-5）。
  assert.ok(raced.some((r) => r.code === "IDEMPOTENCY_IN_PROGRESS"), raced.map((r) => `${r.status} ${r.code}`).join(","));
  assert.equal(await jobsBefore(), start + 2, "two jobs: one per key");

  // 雙擊確認：兩個唔同 key 嘅 confirm 同時入，只有一個排到隊，一行 audit。
  const jobId = first.json.data.id;
  await precheck(jobId);
  const ready = (await h.send(h.users.mgmt, h.route("GET /api/v1/supplier-imports/:id"), { ids: { id: jobId } })).json.data.job;
  assert.equal(ready.status, "ready");
  const confirms = await Promise.all([0, 1].map(() => h.send(h.users.mgmt, h.route("POST /api/v1/supplier-imports/:id/confirm"),
    { ids: { id: jobId }, body: { version: ready.version, activationMode: "draft", approverUserId: null } })));
  assert.deepEqual(confirms.map((r) => r.status).sort(), [200, 409], confirms.map((r) => `${r.status} ${r.code}`).join(","));
  const [confirmAudits] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.confirm'", [jobId]);
  assert.equal(Number(confirmAudits[0].n), 1);

  // 同一個檔用第二個 key：係另一個 job，但第一個執行完之後，precheck 每行都報 Code 已被使用，冇嘢可以確認。
  const second = await upload(file, randomUUID());
  assert.equal(second.status, 201);
  assert.notEqual(second.json.data.id, jobId);
  assert.equal(await execute(jobId), "completed");
  await precheck(second.json.data.id);
  const secondJob = (await h.send(h.users.mgmt, h.route("GET /api/v1/supplier-imports/:id"), { ids: { id: second.json.data.id } })).json.data;
  assert.equal(secondJob.job.status, "ready_with_errors", JSON.stringify(secondJob.job));
  assert.deepEqual(secondJob.rows.map((row) => [row.rowNumber, row.status, row.errors.map((issue) => issue.code)]),
    [[1, "invalid", ["SUPPLIER_CODE_TAKEN"]], [2, "invalid", ["SUPPLIER_CODE_TAKEN"]]]);
  const [created] = await h.db.query("SELECT id, supplier_code FROM suppliers WHERE supplier_code IN (?, ?)", codes);
  for (const row of created) h.supplierIds.push(Number(row.id));
  assert.deepEqual(created.map((row) => row.supplier_code).sort(), [...codes].sort(), "each imported Supplier exists exactly once");
  const [createAudits] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label IN (?, ?)", codes);
  assert.equal(Number(createAudits[0].n), 2, "one create audit per Supplier");
  const [approvals] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_activation_requests WHERE supplier_id IN (?)", [created.map((row) => row.id)]);
  assert.equal(Number(approvals[0].n), 0, "draft import opens no approval");
});
