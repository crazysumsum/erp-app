/**
 * T27 嘅兩張 Import 表（`0025`／`0026`），對一個真的、已經 migrate 過的
 * MySQL 驗證 schema 本身：unique key、FK CASCADE／SET NULL、`match_sku_id`
 * 刻意冇 FK 呢啲行為淨係真 DB 先驗得到，假連線頂唔到。設計說明見
 * docs/items_management/design_spec.md §5.13。
 *
 * 呢個檔案直接打 SQL，唔經 HTTP／service——呢個 task 本身只建表，冇 service／
 * handler 可以經 HTTP 打（CSV parsing／validation 係 T28 之後嘅事），想驗嘅
 * 純粹係 migration 本身寫啱行為。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";

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

/** `MySqlDatabaseService` 將真正嘅 mysql2 錯誤包咗做 `.cause`，外層嘅
 * `.message`／`.code` 淨係得返泛用嘅 "DATABASE_OPERATION_FAILED"——要斷言
 * 真正嘅 MySQL error code 一定要睇 `.cause.code`。 */
function rejectsWithMysqlCode(promiseFactory, expectedCode) {
  return assert.rejects(promiseFactory, (error) => {
    const actualCode = error?.cause?.code ?? error?.code;
    assert.equal(actualCode, expectedCode, `expected MySQL error code ${expectedCode}, got ${actualCode}`);
    return true;
  });
}

async function seedUser(db, { username }) {
  const passwordHash = await hashPassword("Integration-Test-Pass-1!");
  const nowMs = Date.now();
  const [result] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, "Integration Test User", nowMs, nowMs]
  );
  return result.insertId;
}

function jobRow({ suffix, resultStoredName = null }) {
  const nowMs = Date.now();
  return {
    // Keep schema-only fixtures non-claimable by the parallel import worker tests.
    sql: `INSERT INTO item_import_jobs
            (file_stored_name, result_stored_name, file_sha256, template_version, mode, status,
             created_at, updated_at)
          VALUES (?, ?, ?, 'v1', 'create_only', 'ready', ?, ?)`,
    params: [`it-import-${suffix}.csv`, resultStoredName, "a".repeat(64), nowMs, nowMs]
  };
}

// --- item_import_jobs ---------------------------------------------------------

test("item_import_jobs.file_stored_name：全域唯一", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  let jobId = null;
  t.after(async () => {
    if (jobId) await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
    await application.shutdown("integration_test_complete");
  });

  const first = jobRow({ suffix });
  const [result] = await db.query(first.sql, first.params);
  jobId = result.insertId;

  await rejectsWithMysqlCode(() => db.query(first.sql, first.params), "ER_DUP_ENTRY");
});

test("item_import_jobs.result_stored_name：UNIQUE key 對 NULL 唔生效，兩個 job 都可以未有結果檔", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffixA = randomUUID().slice(0, 8);
  const suffixB = randomUUID().slice(0, 8);
  const jobIds = [];
  t.after(async () => {
    for (const id of jobIds) {
      await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [id]);
    }
    await application.shutdown("integration_test_complete");
  });

  const a = jobRow({ suffix: suffixA });
  const b = jobRow({ suffix: suffixB });
  const [resultA] = await db.query(a.sql, a.params);
  const [resultB] = await db.query(b.sql, b.params);
  jobIds.push(resultA.insertId, resultB.insertId);

  const [[rowA]] = await db.query("SELECT result_stored_name FROM item_import_jobs WHERE id = ?", [resultA.insertId]);
  const [[rowB]] = await db.query("SELECT result_stored_name FROM item_import_jobs WHERE id = ?", [resultB.insertId]);
  assert.equal(rowA.result_stored_name, null);
  assert.equal(rowB.result_stored_name, null);
});

test("item_import_jobs.created_by／confirmed_by：SET NULL，刪用戶唔會刪走 Job", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const userId = await seedUser(db, { username: `it-import-user-${suffix}` });
  let jobId = null;
  t.after(async () => {
    if (jobId) await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
    await db.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
    await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  const [result] = await db.query(
    `INSERT INTO item_import_jobs
       (file_stored_name, file_sha256, template_version, mode, status, created_by, confirmed_by,
        created_at, updated_at)
     VALUES (?, ?, 'v1', 'create_only', 'ready', ?, ?, ?, ?)`,
    [`it-import-${suffix}.csv`, "b".repeat(64), userId, userId, nowMs, nowMs]
  );
  jobId = result.insertId;

  await db.execute("DELETE FROM users WHERE id = ?", [userId]);

  const [[row]] = await db.query("SELECT created_by, confirmed_by FROM item_import_jobs WHERE id = ?", [jobId]);
  assert.equal(row.created_by, null);
  assert.equal(row.confirmed_by, null);
});

// --- item_import_rows ----------------------------------------------------------

async function seedJob(db, suffix) {
  const nowMs = Date.now();
  const [result] = await db.query(
    `INSERT INTO item_import_jobs
       (file_stored_name, file_sha256, template_version, mode, status, created_at, updated_at)
     VALUES (?, ?, 'v1', 'upsert', 'ready', ?, ?)`,
    [`it-import-${suffix}.csv`, "c".repeat(64), nowMs, nowMs]
  );
  return result.insertId;
}

test("item_import_rows：(job_id, row_number) 係 PK，同一個 job 唔可以有重複行號", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const jobId = await seedJob(db, suffix);
  t.after(async () => {
    await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  const insertRow = () =>
    db.query(
      `INSERT INTO item_import_rows
         (job_id, \`row_number\`, operation, normalized_payload, status, created_at, updated_at)
       VALUES (?, 1, 'create', ?, 'valid', ?, ?)`,
      [jobId, JSON.stringify({ skuCode: "IT-1" }), nowMs, nowMs]
    );

  await insertRow();
  await rejectsWithMysqlCode(insertRow, "ER_DUP_ENTRY");
});

test("item_import_rows.job_id：CASCADE，刪 job 連埋佢啲 row 一齊消失", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const jobId = await seedJob(db, suffix);
  t.after(async () => {
    await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]).catch(() => {});
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  await db.query(
    `INSERT INTO item_import_rows
       (job_id, \`row_number\`, operation, normalized_payload, status, created_at, updated_at)
     VALUES (?, 1, 'create', ?, 'valid', ?, ?)`,
    [jobId, JSON.stringify({ skuCode: "IT-1" }), nowMs, nowMs]
  );

  await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);

  const [[count]] = await db.query("SELECT COUNT(*) AS c FROM item_import_rows WHERE job_id = ?", [jobId]);
  assert.equal(count.c, 0);
});

test("item_import_rows.match_sku_id：刻意冇 FK，指向一個唔存在嘅 SKU id 一樣寫得入——歷史匯入結果唔會因為 SKU 之後被刪就消失", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const jobId = await seedJob(db, suffix);
  t.after(async () => {
    await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  const nonExistentSkuId = 999_999_999;
  await db.query(
    `INSERT INTO item_import_rows
       (job_id, \`row_number\`, operation, match_sku_id, expected_sku_version, normalized_payload, status,
        created_at, updated_at)
     VALUES (?, 1, 'update', ?, 1, ?, 'valid', ?, ?)`,
    [jobId, nonExistentSkuId, JSON.stringify({ skuCode: "IT-1" }), nowMs, nowMs]
  );

  const [[row]] = await db.query(
    "SELECT match_sku_id, expected_sku_version FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.equal(row.match_sku_id, nonExistentSkuId);
  assert.equal(row.expected_sku_version, 1);
});

test("item_import_rows：normalized_payload／errors／warnings 嘅 JSON 內容原樣讀返", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const jobId = await seedJob(db, suffix);
  t.after(async () => {
    await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
    await application.shutdown("integration_test_complete");
  });

  const nowMs = Date.now();
  const payload = { skuCode: "IT-1", uoms: [{ uomId: 1, toBaseFactor: 1 }] };
  const warnings = [{ field: "shelfLifeDays", code: "MISSING_OPTIONAL", message: "未提供保存期限" }];
  await db.query(
    `INSERT INTO item_import_rows
       (job_id, \`row_number\`, operation, normalized_payload, status, warnings, created_at, updated_at)
     VALUES (?, 1, 'create', ?, 'warning', ?, ?, ?)`,
    [jobId, JSON.stringify(payload), JSON.stringify(warnings), nowMs, nowMs]
  );

  const [[row]] = await db.query(
    "SELECT normalized_payload, warnings, errors FROM item_import_rows WHERE job_id = ? AND `row_number` = 1",
    [jobId]
  );
  assert.deepEqual(row.normalized_payload, payload);
  assert.deepEqual(row.warnings, warnings);
  assert.equal(row.errors, null);
});
