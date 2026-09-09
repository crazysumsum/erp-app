/**
 * T28 嘅 CSV 匯入 preflight，對一個真的、已經 migrate 過的 MySQL 驗收。
 * 設計說明見 docs/items_management/design_spec.md §5.13、§8.6。
 *
 * 呢個 task 冇任何 HTTP handler（upload／confirm 等要等 T29），所以呢度
 * 唔經 HTTP：直接種一個 `item_import_jobs` row＋喺受控 import 目錄放一份
 * 真嘅 CSV 檔案，然後直接攞 `job.itemImportWorker` 呢個 service 嚟叫
 * `runValidation()`——同「下一個 task 先有嘅 HTTP 入口，測試直接種 DB／
 * 直接叫 service」呢個貫穿成個 session 嘅慣例一致。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";

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
