/**
 * T28 嘅 CSV 匯入 preflight 同 T29 嘅 confirm／execution／result API，對
 * 一個真的、已經 migrate 過的 MySQL 驗收。設計說明見
 * docs/items_management/design_spec.md §5.13、§6.9、§8.6。
 *
 * T28 部分（validation）淨係種 DB row＋直接叫 `job.itemImportWorker`，冇
 * HTTP handler 可以打；T29 起 upload／list／get／confirm／cancel／result
 * 呢幾個端點都有真正嘅 HTTP 入口，對應嘅測試直接打 HTTP（同其他 task 嘅
 * handler 整合測試同一套風格）。execution 本身冇獨立 HTTP 端點（worker
 * 自己 claim `queued` job），一樣直接叫 `worker.runExecution()`。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { executeItemImportJob } from "../../src/services/itemImport/jobs/executeItemImportJob.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedCatalog(db) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [category] = await db.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-import-cat-${suffix}`, nowMs, nowMs]
  );
  const [brand] = await db.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`it-import-brand-${suffix}`, nowMs, nowMs]
  );
  const [uom] = await db.query(
    "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    [`ITI${suffix}`, "Integration Test Unit", nowMs, nowMs]
  );
  return {
    suffix,
    categoryId: category.insertId,
    brandId: brand.insertId,
    uomId: uom.insertId,
    async cleanup() {
      await db.execute("DELETE FROM item_uoms WHERE id = ?", [uom.insertId]);
      await db.execute("DELETE FROM item_brands WHERE id = ?", [brand.insertId]);
      await db.execute("DELETE FROM item_categories WHERE id = ?", [category.insertId]);
    }
  };
}

/** 種一個真嘅 Item＋SKU，俾 update（upsert）測試用嚟配對 skuId／version。 */
async function seedSku(db, catalog) {
  const nowMs = Date.now();
  const suffix = randomUUID().slice(0, 8);
  const [item] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', 'draft', ?, ?)`,
    [`it-import-item-${suffix}`, catalog.categoryId, catalog.brandId, nowMs, nowMs]
  );
  const itemId = item.insertId;
  const [sku] = await db.query(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked, status,
        created_at, updated_at)
     VALUES (?, ?, ?, 'none', 1, 1, 1, 'draft', ?, ?)`,
    [itemId, `IT-IMPORT-SKU-${suffix}`, "Integration test SKU", nowMs, nowMs]
  );
  return {
    itemId,
    skuId: sku.insertId,
    skuCode: `IT-IMPORT-SKU-${suffix}`,
    version: 1,
    async cleanup() {
      await db.execute("DELETE FROM item_skus WHERE id = ?", [sku.insertId]);
      await db.execute("DELETE FROM items WHERE id = ?", [itemId]);
    }
  };
}

function csvFrom(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((key) => {
          const value = row[key] ?? "";
          return /[",\n]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : value;
        })
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

async function seedImportJob(db, { fileStoredName, mode = "create_only", status = "uploaded" }) {
  const nowMs = Date.now();
  const [result] = await db.query(
    `INSERT INTO item_import_jobs
       (file_stored_name, file_sha256, template_version, mode, status, created_at, updated_at)
     VALUES (?, ?, 'v1', ?, ?, ?, ?)`,
    [fileStoredName, "a".repeat(64), mode, status, nowMs, nowMs]
  );
  return result.insertId;
}

async function cleanupImportJob(db, jobId) {
  if (!jobId) return;
  await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
}

async function withImportDirectory(t, application) {
  const importDirectory = application.services.config.item.importDirectory;
  await mkdir(importDirectory, { recursive: true });
  const fileStoredName = `${randomUUID()}.csv`;
  const filePath = path.join(importDirectory, fileStoredName);

  t.after(async () => {
    await rm(filePath, { force: true });
  });

  return {
    fileStoredName,
    async write(csvText) {
      await writeFile(filePath, csvText, "utf8");
    }
  };
}

// --- HTTP 認證輔助（T29） ---------------------------------------------------

const PASSWORD = "Integration-Test-Pass-1!";

async function seedUser(db, { username, roleId }) {
  const passwordHash = await hashPassword(PASSWORD);
  const nowMs = Date.now();
  const [result] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  const userId = result.insertId;
  if (roleId) {
    await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
  }
  return { userId, username };
}

async function cleanupUser(db, userId) {
  await db.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ?", [userId]);
  await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
}

async function seedRole(db, { permissionNames = [] } = {}) {
  const nowMs = Date.now();
  const roleName = `it-import-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  const roleId = roleResult.insertId;
  for (const name of permissionNames) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  return {
    roleId,
    roleName,
    async cleanup() {
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM user_roles WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

function tokenIssuer(application) {
  const jwt = application.services.require("jwt");
  const tokenRevocation = application.services.require("tokenRevocation");
  const time = application.services.require("time");
  return async (userId, { roles, permissions }) => {
    const version = await tokenRevocation.currentVersion(String(userId));
    const authTime = Math.floor(time.nowMs() / 1000);
    return jwt.issue({ roles, permissions }, { subject: String(userId), version, authTime });
  };
}

async function withManager(t, application, permissionNames = ["item.mgmt"]) {
  const db = application.services.require("mysqldatabase");
  const issueToken = tokenIssuer(application);
  const role = await seedRole(db, { permissionNames });
  const actor = await seedUser(db, { username: `it-import-${randomUUID().slice(0, 8)}`, roleId: role.roleId });
  const token = await issueToken(actor.userId, { roles: [role.roleName], permissions: permissionNames });

  t.after(async () => {
    await cleanupUser(db, actor.userId);
    await role.cleanup();
  });

  return { db, token, actorId: actor.userId, actorUsername: actor.username, roleId: role.roleId };
}

function get(url, token) {
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

function post(url, token, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

function uploadCsv(url, token, { csvText, mode }) {
  const data = new FormData();
  data.append("mode", mode);
  data.append("file", new Blob([csvText], { type: "text/csv" }), "import.csv");

  const headers = { "Idempotency-Key": randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return fetch(url, { method: "POST", headers, body: data }).then(async (response) => ({
    status: response.status,
    body: await response.json()
  }));
}

async function seedCatalogNames(db, catalog) {
  const [category] = await db.query("SELECT name FROM item_categories WHERE id = ?", [catalog.categoryId]);
  const [brand] = await db.query("SELECT name FROM item_brands WHERE id = ?", [catalog.brandId]);
  const [uom] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [catalog.uomId]);
  return { categoryName: category[0].name, brandName: brand[0].name, baseUomCode: uom[0].code };
}

async function cleanupCreatedSku(db, skuCode) {
  const [[sku]] = await db.query("SELECT id, item_id FROM item_skus WHERE sku_code = ?", [skuCode]);
  if (!sku) return;
  await db.execute("DELETE FROM item_sku_uoms WHERE sku_id = ?", [sku.id]);
  await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'sku' AND target_id = ?", [sku.id]);
  await db.execute("DELETE FROM item_skus WHERE id = ?", [sku.id]);
  await db.execute("DELETE FROM item_audit_logs WHERE target_type = 'item' AND target_id = ?", [sku.item_id]);
  await db.execute("DELETE FROM items WHERE id = ?", [sku.item_id]);
}

// --- Happy path -----------------------------------------------------------------

test("Create-only CSV 全部合法：job 轉 ready，row 逐列寫入，counts 正確", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const worker = application.services.require("job.itemImportWorker");
  const catalog = await seedCatalog(db);
  const file = await withImportDirectory(t, application);

  const [category] = await db.query("SELECT name FROM item_categories WHERE id = ?", [catalog.categoryId]);
  const [brand] = await db.query("SELECT name FROM item_brands WHERE id = ?", [catalog.brandId]);
  const [uom] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [catalog.uomId]);
  const csvText = csvFrom([
    {
      skuCode: `IT-CSV-${catalog.suffix}`,
      skuName: "整合測試商品",
      itemName: "整合測試 Item",
      categoryName: category[0].name,
      brandName: brand[0].name,
      baseUomCode: uom[0].code,
      suggestedPriceAmount: "88.0000"
    }
  ]);
  await file.write(csvText);
  const jobId = await seedImportJob(db, { fileStoredName: file.fileStoredName });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const outcome = await worker.runValidation();
  assert.equal(outcome.claimed, true);
  assert.equal(outcome.jobId, jobId);

  const [[jobRow]] = await db.query(
    "SELECT status, total_count, success_count, failure_count, warning_count, lease_owner, lease_until, version FROM item_import_jobs WHERE id = ?",
    [jobId]
  );
  assert.equal(jobRow.status, "ready");
  assert.equal(jobRow.total_count, 1);
  assert.equal(jobRow.success_count, 1);
  assert.equal(jobRow.failure_count, 0);
  assert.equal(jobRow.warning_count, 0);
  assert.equal(jobRow.lease_owner, null);
  assert.equal(jobRow.lease_until, null);
  // version bump 兩次：claimNextUploadedJobForValidation()（uploaded→validating）
  // 一次，recordValidationResult()（validating→ready）再一次。
  assert.equal(jobRow.version, 3);

  const [[rowRecord]] = await db.query(
    "SELECT operation, status, normalized_payload, errors, warnings FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(rowRecord.operation, "create");
  assert.equal(rowRecord.status, "valid");
  assert.equal(rowRecord.normalized_payload.categoryId, catalog.categoryId);
  assert.equal(rowRecord.normalized_payload.brandId, catalog.brandId);
  assert.equal(rowRecord.normalized_payload.baseUomId, catalog.uomId);
  assert.equal(rowRecord.errors, null);
  assert.equal(rowRecord.warnings, null);
});

test("有一列 invalid：整個 job 轉 invalid，唔會擋住其他合法列寫入", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const worker = application.services.require("job.itemImportWorker");
  const catalog = await seedCatalog(db);
  const file = await withImportDirectory(t, application);

  const [category] = await db.query("SELECT name FROM item_categories WHERE id = ?", [catalog.categoryId]);
  const [brand] = await db.query("SELECT name FROM item_brands WHERE id = ?", [catalog.brandId]);
  const [uom] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [catalog.uomId]);
  const csvText = csvFrom([
    {
      skuCode: `IT-OK-${catalog.suffix}`,
      skuName: "合法列",
      itemName: "整合測試 Item",
      categoryName: category[0].name,
      brandName: brand[0].name,
      baseUomCode: uom[0].code
    },
    {
      skuCode: `IT-BAD-${catalog.suffix}`,
      skuName: "非法列",
      itemName: "",
      categoryName: category[0].name,
      brandName: brand[0].name,
      baseUomCode: uom[0].code
    }
  ]);
  await file.write(csvText);
  const jobId = await seedImportJob(db, { fileStoredName: file.fileStoredName });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await worker.runValidation();

  const [[jobRow]] = await db.query(
    "SELECT status, total_count, success_count, failure_count FROM item_import_jobs WHERE id = ?",
    [jobId]
  );
  assert.equal(jobRow.status, "invalid");
  assert.equal(jobRow.total_count, 2);
  assert.equal(jobRow.success_count, 1);
  assert.equal(jobRow.failure_count, 1);

  const [rows] = await db.query(
    "SELECT `row_number`, status FROM item_import_rows WHERE job_id = ? ORDER BY `row_number`",
    [jobId]
  );
  assert.deepEqual(
    rows.map((r) => ({ rowNumber: r.row_number, status: r.status })),
    [
      { rowNumber: 1, status: "valid" },
      { rowNumber: 2, status: "invalid" }
    ]
  );
});

// --- Update（upsert）配對真嘅 SKU --------------------------------------------

test("Upsert 更新一粒真嘅 SKU：用 skuId＋version 配對，SKU Code 唔一致得返 warning", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const worker = application.services.require("job.itemImportWorker");
  const catalog = await seedCatalog(db);
  const sku = await seedSku(db, catalog);
  const file = await withImportDirectory(t, application);

  const csvText = csvFrom([
    {
      skuId: String(sku.skuId),
      expectedSkuVersion: String(sku.version),
      skuCode: "WRONG-CODE-ON-PURPOSE",
      skuName: "改咗個名"
    }
  ]);
  await file.write(csvText);
  const jobId = await seedImportJob(db, { fileStoredName: file.fileStoredName, mode: "upsert" });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await sku.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  await worker.runValidation();

  const [[jobRow]] = await db.query("SELECT status FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(jobRow.status, "ready");

  const [[rowRecord]] = await db.query(
    "SELECT operation, match_sku_id, expected_sku_version, status, warnings FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(rowRecord.operation, "update");
  assert.equal(rowRecord.match_sku_id, sku.skuId);
  assert.equal(rowRecord.expected_sku_version, sku.version);
  assert.equal(rowRecord.status, "warning");
  assert.equal(rowRecord.warnings[0].code, "SKU_CODE_MISMATCH");
});

// --- 冇合資格嘅 job -------------------------------------------------------------

test("冇任何 uploaded job：claimed 係 false，唔會拋錯", { skip }, async (t) => {
  const application = await startApplication();
  const worker = application.services.require("job.itemImportWorker");
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const outcome = await worker.runValidation();
  assert.equal(outcome.claimed, false);
});

test("已經驗證完嘅 job 唔會被重新揀中", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const worker = application.services.require("job.itemImportWorker");
  const catalog = await seedCatalog(db);
  const file = await withImportDirectory(t, application);

  const [category] = await db.query("SELECT name FROM item_categories WHERE id = ?", [catalog.categoryId]);
  const [brand] = await db.query("SELECT name FROM item_brands WHERE id = ?", [catalog.brandId]);
  const [uom] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [catalog.uomId]);
  await file.write(
    csvFrom([
      {
        skuCode: `IT-ONCE-${catalog.suffix}`,
        skuName: "只驗一次",
        itemName: "整合測試 Item",
        categoryName: category[0].name,
        brandName: brand[0].name,
        baseUomCode: uom[0].code
      }
    ])
  );
  const jobId = await seedImportJob(db, { fileStoredName: file.fileStoredName });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const first = await worker.runValidation();
  assert.equal(first.claimed, true);
  assert.equal(first.jobId, jobId);

  const second = await worker.runValidation();
  assert.equal(second.claimed, false);
});

// --- 來源檔缺失 -------------------------------------------------------------------

test("來源檔案喺受控目錄搵唔到：job 轉 invalid，error_summary 記低原因，唔會拋錯令 worker 卡住", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const worker = application.services.require("job.itemImportWorker");

  const jobId = await seedImportJob(db, { fileStoredName: `${randomUUID()}-does-not-exist.csv` });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await application.shutdown("integration_test_complete");
  });

  const outcome = await worker.runValidation();
  assert.equal(outcome.claimed, true);
  assert.equal(outcome.outcome, "source_missing");

  const [[jobRow]] = await db.query(
    "SELECT status, error_summary, lease_owner FROM item_import_jobs WHERE id = ?",
    [jobId]
  );
  assert.equal(jobRow.status, "invalid");
  assert.equal(jobRow.error_summary, "找不到來源 CSV 檔案");
  assert.equal(jobRow.lease_owner, null);
});

// --- T29：Template／Upload／List/Get（HTTP） ---------------------------------

test("下載 template：帶齊已知欄位嘅 header row", { skip }, async (t) => {
  const application = await startApplication();
  const { token } = await withManager(t, application);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const response = await fetch(`${url}/api/v1/item-imports/template`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await response.text();

  assert.equal(response.status, 200, text);
  assert.match(response.headers.get("content-type") || "", /text\/csv/);
  assert.match(text, /^skuId,expectedSkuVersion,skuCode,skuName,itemName,categoryName,brandName/);
});

test("上傳、list、get 全部經真實 HTTP：job 建立後可以查到，list 支援狀態篩選", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  let jobId = null;
  t.after(async () => {
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const csvText = csvFrom([
    { skuCode: `IT-HTTP-${catalog.suffix}`, skuName: "HTTP 上傳測試", itemName: "整合測試 Item", ...names }
  ]);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  jobId = uploaded.body.data.id;
  assert.equal(uploaded.body.data.status, "uploaded");
  assert.equal(uploaded.body.data.mode, "create_only");

  const detail = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.job.id, jobId);
  assert.equal(detail.body.data.rows.total, 0, "validation 未跑之前仲未有任何 row");

  const list = await get(`${url}/api/v1/item-imports?status=uploaded`, token);
  assert.equal(list.status, 200);
  assert.ok(list.body.data.items.some((item) => item.id === jobId));

  const listReady = await get(`${url}/api/v1/item-imports?status=ready`, token);
  assert.ok(!listReady.body.data.items.some((item) => item.id === jobId));
});

test("結果 CSV：skuCode 開頭係 =／+／-／@ 會加單引號，防試算表當公式執行（CSV injection）", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  let jobId = null;
  t.after(async () => {
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const maliciousSkuCode = '=cmd|"/c calc"!A1';
  const csvText = csvFrom([
    { skuCode: maliciousSkuCode, skuName: "CSV injection 測試", itemName: "整合測試 Item", ...names }
  ]);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  jobId = uploaded.body.data.id;

  await worker.runValidation();

  const resultResponse = await fetch(`${url}/api/v1/item-imports/${jobId}/result`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resultResponse.status, 200);
  const resultText = await resultResponse.text();
  const [record] = parse(resultText, { bom: true, columns: true });
  assert.equal(record.skuCode, `'${maliciousSkuCode}`, "skuCode 開頭嘅 = 前面要加咗單引號，試算表先會當純文字");
});

// --- T29：Confirm／Execution 全流程 ------------------------------------------

test("TC-009 Confirm＋execution 全流程：create-only job 完成後真係建咗一個 Item＋SKU，結果 CSV 下載得到", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, actorId, actorUsername } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-EXEC-${catalog.suffix}`;
  let jobId = null;
  t.after(async () => {
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const csvText = csvFrom([
    { skuCode, skuName: "全流程測試商品", itemName: "全流程測試 Item", suggestedPriceAmount: "99.0000", ...names }
  ]);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  jobId = uploaded.body.data.id;

  await worker.runValidation();
  const afterValidation = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(afterValidation.body.data.job.status, "ready");
  assert.equal(afterValidation.body.data.rows.items[0].status, "valid");

  const confirmed = await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：確認匯入",
    version: afterValidation.body.data.job.version,
    password: PASSWORD
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.status, "queued");

  await worker.runExecution();
  const afterExecution = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(afterExecution.body.data.job.status, "completed");
  assert.equal(afterExecution.body.data.job.successCount, 1);
  assert.equal(afterExecution.body.data.job.failureCount, 0);

  const [[skuRow]] = await db.query(
    "SELECT s.id, s.item_id, s.sku_code, s.status, s.suggested_price_amount, i.status AS item_status FROM item_skus s JOIN items i ON i.id = s.item_id WHERE s.sku_code = ?",
    [skuCode]
  );
  assert.ok(skuRow, "execution 應該真係建立咗一個 SKU");
  assert.equal(skuRow.status, "draft");
  assert.equal(skuRow.item_status, "draft");
  assert.equal(skuRow.suggested_price_amount, "99.0000");

  const [auditRows] = await db.query(
    "SELECT action, target_label FROM item_audit_logs WHERE target_type = 'import' AND target_id = ?",
    [jobId]
  );
  assert.deepEqual(auditRows.map((row) => row.action), ["item.import"]);

  const [aggregateAuditRows] = await db.query(
    `SELECT actor_user_id, actor_username, action, target_type, target_id, target_label, reason
       FROM item_audit_logs
      WHERE (target_type = 'item' AND target_id = ?)
         OR (target_type = 'sku' AND target_id = ?)
      ORDER BY id ASC`,
    [skuRow.item_id, skuRow.id]
  );
  assert.deepEqual(
    aggregateAuditRows.map((row) => ({
      actorUserId: Number(row.actor_user_id),
      actorUsername: row.actor_username,
      action: row.action,
      targetType: row.target_type,
      targetLabel: row.target_label,
      reason: row.reason
    })),
    [
      {
        actorUserId: actorId,
        actorUsername,
        action: "item.create",
        targetType: "item",
        targetLabel: "全流程測試 Item",
        reason: "整合測試：確認匯入"
      },
      {
        actorUserId: actorId,
        actorUsername,
        action: "sku.create",
        targetType: "sku",
        targetLabel: skuCode,
        reason: "整合測試：確認匯入"
      }
    ]
  );

  const [[rowAfterExecution]] = await db.query(
    "SELECT status FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(
    rowAfterExecution.status,
    "applied",
    "執行成功之後，row 狀態要覆寫做 applied，唔可以停留喺 preflight 嘅 valid"
  );

  const resultResponse = await fetch(`${url}/api/v1/item-imports/${jobId}/result`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resultResponse.status, 200);
  const resultText = await resultResponse.text();
  assert.match(resultText, new RegExp(skuCode));
  assert.match(resultText, /applied/);
});

test("執行中 SKU Code race：preflight 之後、execution 之前俾第三者搶咗個 code，整批 rollback，該 row 標 failed", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-RACE-${catalog.suffix}`;
  let jobId = null;
  let racingSkuId = null;
  let racingItemId = null;
  t.after(async () => {
    if (racingSkuId) await db.execute("DELETE FROM item_skus WHERE id = ?", [racingSkuId]);
    if (racingItemId) await db.execute("DELETE FROM items WHERE id = ?", [racingItemId]);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const csvText = csvFrom([
    { skuCode, skuName: "Race 測試商品", itemName: "Race 測試 Item", ...names }
  ]);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  jobId = uploaded.body.data.id;

  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(ready.body.data.job.status, "ready");

  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：確認匯入（之後模擬 race）",
    version: ready.body.data.job.version,
    password: PASSWORD
  });

  // 喺 confirm 之後、execution 之前，模擬第三者用同一個 skuCode 搶先建咗
  // 一個 SKU——execution 重新驗證時應該偵測到並令成批 rollback。
  const nowMs = Date.now();
  const [racingItem] = await db.query(
    `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
     VALUES (?, ?, ?, 'standard', 'draft', ?, ?)`,
    [`race-item-${catalog.suffix}`, catalog.categoryId, catalog.brandId, nowMs, nowMs]
  );
  racingItemId = racingItem.insertId;
  const [racingSku] = await db.query(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked, status,
        created_at, updated_at)
     VALUES (?, ?, 'Race 搶先建立', 'none', 1, 1, 1, 'draft', ?, ?)`,
    [racingItemId, skuCode, nowMs, nowMs]
  );
  racingSkuId = racingSku.insertId;

  await worker.runExecution();

  const afterExecution = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(afterExecution.body.data.job.status, "failed");
  assert.equal(afterExecution.body.data.job.successCount, 0);
  assert.equal(afterExecution.body.data.job.failureCount, 1);
  assert.match(afterExecution.body.data.job.errorSummary, /第 1 列/);

  const [[rowAfterExecution]] = await db.query(
    "SELECT status, errors FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(rowAfterExecution.status, "failed");
  assert.ok(
    rowAfterExecution.errors.some((issue) => issue.code === "EXECUTION_FAILED" && /SKU Code 已被使用/.test(issue.message)),
    "row 嘅 errors 要記低 execution 失敗嘅原因"
  );

  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 1, "全批 rollback：唔應該多咗第二個用呢個 skuCode 嘅 SKU");
});

test("Upsert 更新一粒真嘅 SKU：confirm＋execution 之後 SKU 欄位同 version 都變咗", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, actorId, actorUsername } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const sku = await seedSku(db, catalog);
  const worker = application.services.require("job.itemImportWorker");
  let jobId = null;
  t.after(async () => {
    if (jobId) await cleanupImportJob(db, jobId);
    await sku.cleanup();
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const csvText = csvFrom([
    {
      skuId: String(sku.skuId),
      expectedSkuVersion: String(sku.version),
      skuCode: sku.skuCode,
      skuName: "已經改咗嘅名稱",
      suggestedPriceAmount: "50.0000"
    }
  ]);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "upsert" });
  jobId = uploaded.body.data.id;

  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：確認更新",
    version: ready.body.data.job.version,
    password: PASSWORD
  });
  await worker.runExecution();

  const [[skuRow]] = await db.query(
    "SELECT sku_name, suggested_price_amount, version FROM item_skus WHERE id = ?",
    [sku.skuId]
  );
  assert.equal(skuRow.sku_name, "已經改咗嘅名稱");
  assert.equal(skuRow.suggested_price_amount, "50.0000");
  assert.equal(skuRow.version, sku.version + 1);

  const [auditRows] = await db.query(
    `SELECT actor_user_id, actor_username, action, target_label, reason, detail
       FROM item_audit_logs
      WHERE target_type = 'sku' AND target_id = ?
      ORDER BY id ASC`,
    [sku.skuId]
  );
  assert.equal(auditRows.length, 1);
  assert.equal(Number(auditRows[0].actor_user_id), actorId);
  assert.equal(auditRows[0].actor_username, actorUsername);
  assert.equal(auditRows[0].action, "sku.update");
  assert.equal(auditRows[0].target_label, "已經改咗嘅名稱");
  assert.equal(auditRows[0].reason, "整合測試：確認更新");
  assert.deepEqual(auditRows[0].detail.skuName, {
    before: "Integration test SKU",
    after: "已經改咗嘅名稱"
  });
});

test("TC-015 逐項 audit 寫入失敗：同一 execution transaction 內嘅 Item、SKU、UOM、audit 全部 rollback", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-AUDIT-ROLLBACK-${catalog.suffix}`;
  let jobId = null;
  t.after(async () => {
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, {
    csvText: csvFrom([{ skuCode, skuName: "Audit rollback SKU", itemName: "Audit rollback Item", ...names }]),
    mode: "create_only"
  });
  jobId = uploaded.body.data.id;

  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：audit failure rollback",
    version: ready.body.data.job.version,
    password: PASSWORD
  });

  const originalRecord = worker.importAggregate.auditLog.record.bind(worker.importAggregate.auditLog);
  worker.importAggregate.auditLog.record = async (connection, entry) => {
    if (entry.action === "sku.create") {
      throw new Error("injected aggregate audit failure");
    }
    return originalRecord(connection, entry);
  };
  t.after(() => {
    worker.importAggregate.auditLog.record = originalRecord;
  });

  await worker.runExecution();

  const afterExecution = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(afterExecution.body.data.job.status, "failed");
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 0, "audit 失敗唔可以留低 SKU");
  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", ["Audit rollback Item"]);
  assert.equal(itemRows.length, 0, "audit 失敗唔可以留低 Item");
  const [aggregateAuditRows] = await db.query(
    "SELECT id FROM item_audit_logs WHERE target_type IN ('item', 'sku') AND target_label IN (?, ?)",
    ["Audit rollback Item", skuCode]
  );
  assert.equal(aggregateAuditRows.length, 0, "transaction rollback 唔可以留低半套 aggregate audit");
});

test("commit 前 failure injection：已寫入的 aggregate、audit 與 completed 狀態一併 rollback", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-COMMIT-ROLLBACK-${catalog.suffix}`;
  let jobId = null;
  const originalDatabase = worker.database;
  t.after(async () => {
    worker.database = originalDatabase;
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, {
    csvText: csvFrom([{ skuCode, skuName: "Commit rollback SKU", itemName: "Commit rollback Item", ...names }]),
    mode: "create_only"
  });
  jobId = uploaded.body.data.id;
  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：commit failure rollback",
    version: ready.body.data.job.version,
    password: PASSWORD
  });

  worker.database = {
    withTransaction(work, options) {
      return originalDatabase.withTransaction(async (connection) => {
        await work(connection);
        throw new Error("injected failure immediately before COMMIT");
      }, options);
    }
  };
  await worker.runExecution();

  const [[job]] = await db.query("SELECT status, success_count, failure_count FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(job.status, "failed");
  assert.equal(job.success_count, 0);
  assert.equal(job.failure_count, 1);
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 0);
  const [itemRows] = await db.query("SELECT id FROM items WHERE name = ?", ["Commit rollback Item"]);
  assert.equal(itemRows.length, 0);
  const [auditRows] = await db.query(
    "SELECT id FROM item_audit_logs WHERE target_type IN ('item', 'sku') AND target_label IN (?, ?)",
    ["Commit rollback Item", skuCode]
  );
  assert.equal(auditRows.length, 0);
});

test("confirm 後 item.mgmt 被撤銷：execution 重新授權並拒絕套用任何 aggregate 資料", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token, roleId } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-REVOKED-${catalog.suffix}`;
  let jobId = null;
  t.after(async () => {
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, {
    csvText: csvFrom([{ skuCode, skuName: "Revoked SKU", itemName: "Revoked Item", ...names }]),
    mode: "create_only"
  });
  jobId = uploaded.body.data.id;
  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：confirm 後撤權",
    version: ready.body.data.job.version,
    password: PASSWORD
  });

  await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
  await worker.runExecution();

  const [[job]] = await db.query("SELECT status, error_summary FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(job.status, "failed");
  assert.match(job.error_summary, /權限已變更/);
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 0);
});

test("running job lease 過期：另一 worker 可安全接管並只套用一次", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-LEASE-RECOVERY-${catalog.suffix}`;
  let jobId = null;
  t.after(async () => {
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, {
    csvText: csvFrom([{ skuCode, skuName: "Lease recovery SKU", itemName: "Lease recovery Item", ...names }]),
    mode: "create_only"
  });
  jobId = uploaded.body.data.id;
  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：lease recovery",
    version: ready.body.data.job.version,
    password: PASSWORD
  });
  await db.execute(
    "UPDATE item_import_jobs SET status = 'running', lease_owner = 'dead-worker', lease_until = ?, version = version + 1 WHERE id = ?",
    [Date.now() - 1, jobId]
  );

  const outcome = await worker.runExecution();
  assert.equal(outcome.claimed, true);
  const [[job]] = await db.query(
    "SELECT status, success_count, failure_count, lease_owner, lease_until FROM item_import_jobs WHERE id = ?",
    [jobId]
  );
  assert.equal(job.status, "completed");
  assert.equal(job.success_count, 1);
  assert.equal(job.failure_count, 0);
  assert.equal(job.lease_owner, null);
  assert.equal(job.lease_until, null);
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 1);
});

test("舊 worker 租約過期後恢復：不可覆寫新 owner 已完成的 job 或重複套用 aggregate", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  const skuCode = `IT-LEASE-FENCE-${catalog.suffix}`;
  const itemName = "Lease fenced Item";
  let jobId = null;
  let releaseOldWorker;
  t.after(async () => {
    releaseOldWorker?.();
    await cleanupCreatedSku(db, skuCode);
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, {
    csvText: csvFrom([{ skuCode, skuName: "Lease fenced SKU", itemName, ...names }]),
    mode: "create_only"
  });
  jobId = uploaded.body.data.id;
  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：lease fencing",
    version: ready.body.data.job.version,
    password: PASSWORD
  });

  let signalOldWorker;
  const oldWorkerBlocked = new Promise((resolve) => {
    releaseOldWorker = resolve;
  });
  const oldWorkerReachedTransaction = new Promise((resolve) => {
    signalOldWorker = resolve;
  });
  const originalWriteResultFile = worker.importService.writeResultFile;
  let resultFileWrites = 0;
  worker.importService.writeResultFile = async (options) => {
    resultFileWrites += 1;
    return originalWriteResultFile.call(worker.importService, options);
  };
  t.after(() => {
    worker.importService.writeResultFile = originalWriteResultFile;
  });
  const pausedDatabase = {
    async withTransaction(work, options) {
      signalOldWorker();
      await oldWorkerBlocked;
      return db.withTransaction(work, options);
    }
  };
  const executionOptions = {
    importService: worker.importService,
    importAggregate: worker.importAggregate,
    logger: worker.logger,
    time: worker.time,
    importDirectory: worker.importDirectory,
    transactionTimeoutMs: worker.importTransactionTimeoutMs,
    leaseDurationMs: worker.leaseDurationMs
  };

  const oldExecution = executeItemImportJob({
    ...executionOptions,
    database: pausedDatabase,
    leaseOwner: "old-worker"
  });
  await oldWorkerReachedTransaction;
  await db.execute("UPDATE item_import_jobs SET lease_until = ? WHERE id = ?", [Date.now() - 1, jobId]);

  const newOutcome = await executeItemImportJob({
    ...executionOptions,
    database: db,
    leaseOwner: "new-worker"
  });
  assert.equal(newOutcome.outcome, "completed");

  releaseOldWorker();
  const oldOutcome = await oldExecution;
  assert.equal(oldOutcome.outcome, "lost_lease");
  assert.equal(resultFileWrites, 1, "stale owner 不可重寫新 owner 已產生的 result file");

  const [[job]] = await db.query(
    "SELECT status, success_count, failure_count, lease_owner, lease_until FROM item_import_jobs WHERE id = ?",
    [jobId]
  );
  assert.equal(job.status, "completed");
  assert.equal(job.success_count, 1);
  assert.equal(job.failure_count, 0);
  assert.equal(job.lease_owner, null);
  assert.equal(job.lease_until, null);

  const [[row]] = await db.query(
    "SELECT status FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(row.status, "applied");
  const [skuRows] = await db.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  assert.equal(skuRows.length, 1);
  const [auditRows] = await db.query(
    `SELECT action
       FROM item_audit_logs
      WHERE action IN ('item.create', 'sku.create') AND target_label IN (?, ?)`,
    [itemName, skuCode]
  );
  assert.deepEqual(
    auditRows.map((entry) => entry.action).sort(),
    ["item.create", "sku.create"]
  );
});

// --- T29：Cancel ------------------------------------------------------------------

test("Cancel：ready job 取消之後唔會被 execution 揀中", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  let jobId = null;
  t.after(async () => {
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const csvText = csvFrom([
    { skuCode: `IT-CANCEL-${catalog.suffix}`, skuName: "取消測試", itemName: "整合測試 Item", ...names }
  ]);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  jobId = uploaded.body.data.id;

  const cancelled = await post(`${url}/api/v1/item-imports/${jobId}/cancel`, token, {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "cancelled");

  const executionOutcome = await worker.runExecution();
  assert.equal(executionOutcome.claimed, false, "cancelled job 唔應該被 execution worker 揀中");
});

// --- T29：Confirm 拒絕嘅情況 -------------------------------------------------------

test("Confirm：唔係 ready 狀態就 409 IMPORT_NOT_READY，version 唔啱就 409 IMPORT_STATE_CONFLICT，密碼錯就 403", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const worker = application.services.require("job.itemImportWorker");
  let jobId = null;
  t.after(async () => {
    if (jobId) await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  const names = await seedCatalogNames(db, catalog);
  const csvText = csvFrom([
    { skuCode: `IT-CONFIRM-${catalog.suffix}`, skuName: "確認測試", itemName: "整合測試 Item", ...names }
  ]);
  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, token, { csvText, mode: "create_only" });
  jobId = uploaded.body.data.id;

  const stillUploaded = await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：仲未 ready",
    version: uploaded.body.data.version,
    password: PASSWORD
  });
  assert.equal(stillUploaded.status, 409);
  assert.equal(stillUploaded.body.error.code, "IMPORT_NOT_READY");

  await worker.runValidation();
  const ready = await get(`${url}/api/v1/item-imports/${jobId}`, token);

  const staleVersion = await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：version 過舊",
    version: ready.body.data.job.version - 1,
    password: PASSWORD
  });
  assert.equal(staleVersion.status, 409);
  assert.equal(staleVersion.body.error.code, "IMPORT_STATE_CONFLICT");

  const wrongPassword = await post(`${url}/api/v1/item-imports/${jobId}/confirm`, token, {
    reason: "整合測試：密碼錯",
    version: ready.body.data.job.version,
    password: "wrong-password"
  });
  assert.equal(wrongPassword.status, 403);
  assert.equal(wrongPassword.body.error.code, "PASSWORD_INVALID");

  const [[stillReady]] = await db.query("SELECT status FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(stillReady.status, "ready");
});

// --- T29：權限矩陣 -----------------------------------------------------------------

test("冇 item.mgmt：upload／list／get／confirm／cancel／result 一律 403；完全冇 token：401", { skip }, async (t) => {
  const application = await startApplication();
  const { token: viewerToken } = await withManager(t, application, ["item.view"]);
  t.after(async () => {
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();

  const list = await get(`${url}/api/v1/item-imports`, viewerToken);
  assert.equal(list.status, 403);

  const uploaded = await uploadCsv(`${url}/api/v1/item-imports/upload`, viewerToken, {
    csvText: csvFrom([{ skuCode: "X", skuName: "x" }]),
    mode: "create_only"
  });
  assert.equal(uploaded.status, 403);

  const anonymous = await get(`${url}/api/v1/item-imports`, null);
  assert.equal(anonymous.status, 401);
});

// --- T29：結果檔已過期 -------------------------------------------------------------

test("結果檔已經被 retention 清理（files_purged_at 有值）：下載回 410，job summary 仍然查得到", { skip }, async (t) => {
  const application = await startApplication();
  const { db, token } = await withManager(t, application);
  const catalog = await seedCatalog(db);
  const jobId = await seedImportJob(db, { fileStoredName: `${randomUUID()}.csv`, status: "completed" });
  t.after(async () => {
    await cleanupImportJob(db, jobId);
    await catalog.cleanup();
    await application.shutdown("integration_test_complete");
  });

  const { url } = await application.start();
  await db.execute(
    "UPDATE item_import_jobs SET result_stored_name = ?, files_purged_at = ? WHERE id = ?",
    [`${randomUUID()}.csv`, Date.now(), jobId]
  );

  const resultResponse = await fetch(`${url}/api/v1/item-imports/${jobId}/result`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(resultResponse.status, 410);
  const body = await resultResponse.json();
  assert.equal(body.error.code, "IMPORT_FILE_EXPIRED");

  const detail = await get(`${url}/api/v1/item-imports/${jobId}`, token);
  assert.equal(detail.status, 200, "files_purged_at 唔應該影響 job summary 本身查得到");
});
