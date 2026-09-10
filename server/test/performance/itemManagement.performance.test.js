/**
 * T35 release performance test（design_spec §11.5、§12.3），對一個真的、已經
 * migrate 過的 MySQL 執行。呢個唔係日常 unit/integration test：要種
 * 100,000 SKU／1,000,000 barcode／1,000,000 UOM rows，仲要用 50 個模擬
 * 併發使用者打混合負載，正常 `npm test` 唔會跑（見下面嘅 `skip`），亦冇入
 * CI——同 design_spec 明確講嘅「這是 release performance test，不放進每次
 * unit test」一致。
 *
 * 驗嘅嘢對應 tasks.md T35 嘅三個 acceptance criteria：
 *   1. exact SKU／barcode lookup、首頁、常用 status＋category filter 喺
 *      50 併發混合負載下 p95 < 2 秒；`EXPLAIN` 唔係對 exact lookup full scan。
 *   2. 10,000-row CSV 嘅 preflight＋execution 系統處理時間合計 ≤ 10 分鐘，
 *      執行期間一般 lookup 仍然 p95 < 2 秒。
 *   3.（唔喺呢個檔案斷言，屬觀察性文件工作）API latency／error rate／
 *      constraint conflict／queue age／running duration／lease recovery／
 *      media cleanup failure 已經有結構化 log／既有機制可觀察——見
 *      tasks.md T35 段落嘅說明。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { ItemAdminService } from "../../src/modules/item/ItemAdminService.js";
import { ItemImportService } from "../../src/modules/item/ItemImportService.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { cleanupItemPerformanceFixtures, seedItemPerformanceFixtures } from "../../test-support/itemPerformanceFixtures.js";

const skip =
  process.env.ITEM_PERFORMANCE_TESTS === "1"
    ? false
    : "set ITEM_PERFORMANCE_TESTS=1 against a real, migrated MySQL to run this release performance test (design_spec §11.5) — it seeds ~2.1M rows and is not part of routine CI";

const SKU_COUNT = Number(process.env.ITEM_PERFORMANCE_SKU_COUNT || 100_000);
const CONCURRENCY = Number(process.env.ITEM_PERFORMANCE_CONCURRENCY || 50);
const OPS_PER_WORKER = Number(process.env.ITEM_PERFORMANCE_OPS_PER_WORKER || 10);
const IMPORT_ROW_COUNT = Number(process.env.ITEM_PERFORMANCE_IMPORT_ROWS || 10_000);
const P95_BUDGET_MS = 2000;
const IMPORT_BUDGET_MS = 10 * 60 * 1000;
const TEST_TIMEOUT_MS = 30 * 60 * 1000;

function p95(durationsMs) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

async function timeIt(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function seedManager(db) {
  const passwordHash = await hashPassword("Performance-Test-Pass-1!");
  const nowMs = Date.now();
  const roleName = `perf-role-${randomUUID().slice(0, 8)}`;
  const [roleResult] = await db.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  const roleId = roleResult.insertId;

  for (const name of ["item.view", "item.mgmt"]) {
    const [[permission]] = await db.query("SELECT id FROM permissions WHERE name = ?", [name]);
    await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }

  const [userResult] = await db.execute(
    `INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [`perf-user-${randomUUID().slice(0, 8)}`, passwordHash, "Performance Test User", nowMs, nowMs]
  );
  const userId = userResult.insertId;
  await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);

  return {
    actorId: userId,
    claimedRoles: [roleName],
    claimedPermissions: ["item.view", "item.mgmt"],
    async cleanup() {
      await db.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ?", [userId]);
      await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
      await db.execute("DELETE FROM users WHERE id = ?", [userId]);
      await db.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      await db.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    }
  };
}

/** 刪返 import KPI 呢個 sub-test自己建立嘅 Item／SKU／audit（用 skuCode
 * prefix 界定範圍）。items→item_skus 係 CASCADE，所以刪 items 順便帶走
 * item_skus／item_sku_uoms；audit log 冇 FK，要自己另外清。 */
async function cleanupImportedItems(db, skuCodePrefix) {
  const likePattern = `${skuCodePrefix}%`;
  await db.execute(
    `DELETE al FROM item_audit_logs al
       JOIN item_skus s ON al.target_type = 'sku' AND al.target_id = s.id
      WHERE s.sku_code LIKE ?`,
    [likePattern]
  );
  await db.execute(
    `DELETE al FROM item_audit_logs al
       JOIN items i ON al.target_type = 'item' AND al.target_id = i.id
       JOIN item_skus s ON s.item_id = i.id
      WHERE s.sku_code LIKE ?`,
    [likePattern]
  );
  await db.execute(
    `DELETE i FROM items i JOIN item_skus s ON s.item_id = i.id WHERE s.sku_code LIKE ?`,
    [likePattern]
  );
}

test(
  "T35 效能驗證：100k SKU／1M barcode／1M UOM，50 併發混合負載，10,000-row import KPI",
  { skip, timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const application = await startApplication();
    const db = application.services.require("mysqldatabase");
    const logger = application.services.require("logging").logger;
    const time = application.services.require("time");
    const manager = await seedManager(db);

    console.log(`[perf] seeding ${SKU_COUNT} SKU fixtures (${SKU_COUNT * 10} barcode, ${SKU_COUNT * 10} UOM rows)...`);
    const seedStart = performance.now();
    const fixtures = await seedItemPerformanceFixtures({ database: db, skuCount: SKU_COUNT });
    console.log(`[perf] seeded in ${Math.round(performance.now() - seedStart)}ms, marker=${fixtures.marker}`);

    t.after(async () => {
      // 清理呢一步會 cascade 刪走成百萬列 item_sku_uoms，本身已經係一段唔短
      // 嘅重工。先停晒 scheduler（media／import cleanup 呢類背景 job 會周期性
      // 打同一個 connection pool），等清理唔使同佢哋爭 connection，觀察到嘅
      // 清理時間亦先反映呢個 DELETE 本身，唔會混雜背景 job 嘅干擾。
      await application.services.require("scheduler").stop();
      await manager.cleanup();
      await cleanupItemPerformanceFixtures({
        database: db,
        categoryId: fixtures.categoryId,
        brandId: fixtures.brandId,
        uomIds: fixtures.uomIds
      });
      await application.shutdown("performance_test_complete");
    });

    const adminService = new ItemAdminService({ database: db, logger, time });
    const lookupService = new ItemLookupService({ database: db, logger, time });

    await t.test("EXPLAIN：exact SKU code／barcode lookup 唔係 full table scan", async () => {
      const sampleIndex = Math.floor(Math.random() * fixtures.skuCount);
      const skuCode = `PERF-SKU-${fixtures.marker}-${sampleIndex}`;
      const barcode = `PERFBC${fixtures.marker}-${sampleIndex}-0`;

      const [codeExplain] = await db.query(
        `EXPLAIN SELECT s.id FROM item_skus s JOIN items i ON i.id = s.item_id WHERE s.sku_code = ?`,
        [skuCode]
      );
      for (const row of codeExplain) {
        assert.notEqual(row.type, "ALL", `sku_code lookup full-scanned ${row.table}: ${JSON.stringify(row)}`);
      }

      const [barcodeExplain] = await db.query(
        `EXPLAIN SELECT s.id FROM item_skus s
           JOIN item_sku_barcodes b ON b.sku_id = s.id
           JOIN items i ON i.id = s.item_id
          WHERE b.normalized_barcode = ?`,
        [barcode]
      );
      for (const row of barcodeExplain) {
        assert.notEqual(row.type, "ALL", `barcode lookup full-scanned ${row.table}: ${JSON.stringify(row)}`);
      }
    });

    await t.test(
      `${CONCURRENCY} 併發混合負載：exact lookup／首頁／常用 filters p95 < 2 秒`,
      async () => {
        const categories = { exactCode: [], exactBarcode: [], homepage: [], statusAndCategoryFilter: [] };

        async function worker() {
          for (let i = 0; i < OPS_PER_WORKER; i += 1) {
            const index = Math.floor(Math.random() * fixtures.skuCount);
            categories.exactCode.push(
              await timeIt(() => lookupService.findByCode(`PERF-SKU-${fixtures.marker}-${index}`))
            );
            categories.exactBarcode.push(
              await timeIt(() => lookupService.findByBarcode(`PERFBC${fixtures.marker}-${index}-0`))
            );
            categories.homepage.push(
              await timeIt(() => adminService.listItems({ ...manager, page: 1, pageSize: 20 }))
            );
            categories.statusAndCategoryFilter.push(
              await timeIt(() =>
                adminService.listItems({ ...manager, status: "active", categoryId: fixtures.categoryId, page: 1, pageSize: 20 })
              )
            );
          }
        }

        const start = performance.now();
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
        console.log(`[perf] mixed load: ${CONCURRENCY} workers × ${OPS_PER_WORKER} rounds in ${Math.round(performance.now() - start)}ms`);

        for (const [name, durations] of Object.entries(categories)) {
          const value = p95(durations);
          console.log(`[perf] ${name} p95=${value.toFixed(1)}ms (n=${durations.length})`);
          assert.ok(value < P95_BUDGET_MS, `${name} p95 ${value.toFixed(1)}ms 超過 2 秒預算`);
        }
      }
    );

    await t.test(
      `${IMPORT_ROW_COUNT}-row CSV import KPI：preflight＋execution 合計 ≤ 10 分鐘，執行期間 lookup p95 < 2 秒`,
      async (t) => {
        const importDirectory = application.services.config.item.importDirectory;
        await mkdir(importDirectory, { recursive: true });
        const fileStoredName = `${randomUUID()}.csv`;
        const filePath = path.join(importDirectory, fileStoredName);
        const skuCodePrefix = `PERF-IMPORT-${fixtures.marker}-`;

        const [[category]] = await db.query("SELECT name FROM item_categories WHERE id = ?", [fixtures.categoryId]);
        const [[brand]] = await db.query("SELECT name FROM item_brands WHERE id = ?", [fixtures.brandId]);
        const [[uom]] = await db.query("SELECT code FROM item_uoms WHERE id = ?", [fixtures.uomIds[0]]);

        const lines = ["skuCode,skuName,itemName,categoryName,brandName,baseUomCode,suggestedPriceAmount"];
        for (let i = 0; i < IMPORT_ROW_COUNT; i += 1) {
          lines.push(
            `${skuCodePrefix}${i},Perf Import SKU ${i},Perf Import Item ${fixtures.marker} ${i},${category.name},${brand.name},${uom.code},99.0000`
          );
        }
        await writeFile(filePath, `${lines.join("\r\n")}\r\n`, "utf8");

        const nowMs = Date.now();
        const [jobResult] = await db.query(
          `INSERT INTO item_import_jobs (file_stored_name, file_sha256, template_version, mode, status, created_at, updated_at)
           VALUES (?, ?, 'v1', 'create_only', 'uploaded', ?, ?)`,
          [fileStoredName, "a".repeat(64), nowMs, nowMs]
        );
        const jobId = jobResult.insertId;

        t.after(async () => {
          await cleanupImportedItems(db, skuCodePrefix);
          await db.execute("DELETE FROM item_import_rows WHERE job_id = ?", [jobId]);
          await db.execute("DELETE FROM item_import_jobs WHERE id = ?", [jobId]);
          await rm(filePath, { force: true });
        });

        const worker = application.services.require("job.itemImportWorker");

        const validateStart = performance.now();
        const validateOutcome = await worker.runValidation();
        const validateMs = performance.now() - validateStart;
        assert.equal(validateOutcome.claimed, true);
        assert.equal(validateOutcome.jobId, jobId);

        const [[readyJob]] = await db.query(
          "SELECT status, version, total_count, success_count FROM item_import_jobs WHERE id = ?",
          [jobId]
        );
        assert.equal(readyJob.status, "ready");
        assert.equal(readyJob.total_count, IMPORT_ROW_COUNT);

        const importService = new ItemImportService({ database: db, logger, time });
        await importService.confirmJob({
          ...manager,
          id: jobId,
          version: readyJob.version,
          reason: "T35 performance KPI test",
          requestId: randomUUID(),
          ip: "127.0.0.1"
        });

        // 執行期間同時抽樣一般 lookup 延遲，證明匯入執行緊嘅時候一般查詢仍然
        // 符合 p95 < 2 秒（design_spec §11.5 最後一句）。
        const duringExecutionLatencies = [];
        const samplingController = new AbortController();
        const sampler = (async () => {
          while (!samplingController.signal.aborted) {
            const index = Math.floor(Math.random() * fixtures.skuCount);
            duringExecutionLatencies.push(
              await timeIt(() => lookupService.findByCode(`PERF-SKU-${fixtures.marker}-${index}`))
            );
            await new Promise((resolve) => {
              setTimeout(resolve, 20);
            });
          }
        })();

        const executeStart = performance.now();
        const executeOutcome = await worker.runExecution();
        const executeMs = performance.now() - executeStart;
        samplingController.abort();
        await sampler;

        assert.equal(executeOutcome.claimed, true);

        const totalMs = validateMs + executeMs;
        console.log(
          `[perf] import validate=${validateMs.toFixed(0)}ms execute=${executeMs.toFixed(0)}ms total=${totalMs.toFixed(0)}ms`
        );
        assert.ok(totalMs < IMPORT_BUDGET_MS, `preflight+execution 合計 ${totalMs.toFixed(0)}ms 超過 10 分鐘預算`);

        if (duringExecutionLatencies.length > 0) {
          const value = p95(duringExecutionLatencies);
          console.log(`[perf] lookup-during-import p95=${value.toFixed(1)}ms (n=${duringExecutionLatencies.length})`);
          assert.ok(value < P95_BUDGET_MS, `匯入執行期間 lookup p95 ${value.toFixed(1)}ms 超過 2 秒預算`);
        }

        const [[completedJob]] = await db.query(
          "SELECT status, success_count, failure_count FROM item_import_jobs WHERE id = ?",
          [jobId]
        );
        assert.equal(completedJob.status, "completed");
        assert.equal(completedJob.success_count, IMPORT_ROW_COUNT);
        assert.equal(completedJob.failure_count, 0);
      }
    );
  }
);
