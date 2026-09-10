import assert from "node:assert/strict";
import test from "node:test";
import { cleanupItemPerformanceFixtures, seedItemPerformanceFixtures } from "../test-support/itemPerformanceFixtures.js";

// itemPerformanceFixtures.js 淨係喺 ITEM_PERFORMANCE_TESTS=1 先會由
// test/performance/itemManagement.performance.test.js 真正跑起，日常
// npm test 完全唔會踩過呢個檔案任何一行。用假 database 直接測 SQL／id 計算
// 邏輯本身（唔起真 MySQL），等呢個檔案喺日常測試都有基本嘅正確性保障，
// 亦令覆蓋率唔會靠「淨係靠 performance test 帶過」。

function fakeDatabase() {
  const calls = [];
  let nextInsertId = 1;

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ method: "query", sql, params });

      if (/^SELECT id FROM items WHERE category_id/i.test(sql)) {
        // cleanup 用嚟分批攞下一批 id；第一次回兩個 id，之後回空陣列令迴圈停低。
        const alreadyReturned = calls.filter(
          (call) => call.method === "query" && /^SELECT id FROM items WHERE category_id/i.test(call.sql)
        ).length;
        return alreadyReturned === 1 ? [[{ id: 101 }, { id: 102 }]] : [[]];
      }

      const rowCount = (sql.match(/\?/g) || []).length && sql.includes("VALUES")
        ? sql.split("(?").length - 1
        : 1;
      const insertId = nextInsertId;
      nextInsertId += Math.max(rowCount, 1);
      return [{ insertId }];
    },
    async execute(sql, params = []) {
      calls.push({ method: "execute", sql, params });
      return [{ affectedRows: 1 }];
    }
  };
}

test("seedItemPerformanceFixtures：分批建立 category／brand／uom／item／sku／sku_uom／barcode，id 靠 insertId+offset 計", async () => {
  const database = fakeDatabase();

  const result = await seedItemPerformanceFixtures({
    database,
    skuCount: 5,
    uomsPerSku: 2,
    barcodesPerSku: 2,
    batchSize: 3
  });

  assert.equal(result.skuCount, 5);
  assert.equal(result.uomIds.length, 2);
  assert.ok(result.marker.length > 0);

  const itemInserts = database.calls.filter((call) => call.sql.includes("INSERT INTO items"));
  const skuInserts = database.calls.filter((call) => call.sql.includes("INSERT INTO item_skus"));
  const uomInserts = database.calls.filter((call) => call.sql.includes("INSERT INTO item_sku_uoms"));
  const barcodeInserts = database.calls.filter((call) => call.sql.includes("INSERT INTO item_sku_barcodes"));

  // batchSize=3，skuCount=5 → 兩批（3＋2）。
  assert.equal(itemInserts.length, 2);
  assert.equal(skuInserts.length, 2);
  assert.equal(uomInserts.length, 2);
  assert.equal(barcodeInserts.length, 2);

  // 每個 sku_uom insert 嘅 params 數量應該係 batch 入面嘅 sku 數 × uomsPerSku × 8 個欄位。
  assert.equal(uomInserts[0].params.length, 3 * 2 * 8);
  assert.equal(uomInserts[1].params.length, 2 * 2 * 8);

  // barcodesPerSku 一定要 <= uomsPerSku，唔係就會拋錯。
  await assert.rejects(
    seedItemPerformanceFixtures({ database: fakeDatabase(), skuCount: 1, uomsPerSku: 1, barcodesPerSku: 2 }),
    RangeError
  );
});

test("seedItemPerformanceFixtures：第一個 barcode 對應 base sku_uom（uom index 0）", async () => {
  const database = fakeDatabase();

  await seedItemPerformanceFixtures({
    database,
    skuCount: 1,
    uomsPerSku: 3,
    barcodesPerSku: 3,
    batchSize: 10
  });

  const [barcodeInsert] = database.calls.filter((call) => call.sql.includes("INSERT INTO item_sku_barcodes"));
  // params 排列：sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at
  assert.equal(barcodeInsert.params[5], 1, "第一個 barcode 應該係 is_primary=1");
});

test("cleanupItemPerformanceFixtures：分批 SELECT＋DELETE，直到冇更多 item 先停", async () => {
  const database = fakeDatabase();

  await cleanupItemPerformanceFixtures({
    database,
    categoryId: 999,
    brandId: 888,
    uomIds: [1, 2, 3]
  });

  const selectCalls = database.calls.filter(
    (call) => call.method === "query" && /^SELECT id FROM items WHERE category_id/i.test(call.sql)
  );
  const barcodeDeletes = database.calls.filter((call) => call.sql.includes("DELETE b FROM item_sku_barcodes"));
  const itemDeletes = database.calls.filter((call) => call.sql.startsWith("DELETE FROM items WHERE id IN"));
  const uomDelete = database.calls.find((call) => call.sql.includes("DELETE FROM item_uoms WHERE id IN"));
  const categoryDelete = database.calls.find((call) => call.sql === "DELETE FROM item_categories WHERE id = ?");
  const brandDelete = database.calls.find((call) => call.sql === "DELETE FROM item_brands WHERE id = ?");

  // 第一次 SELECT 攞到 [101, 102] 先觸發一輪 barcode/item delete，第二次 SELECT 攞到空陣列先停。
  assert.equal(selectCalls.length, 2);
  assert.equal(barcodeDeletes.length, 1);
  assert.equal(itemDeletes.length, 1);
  assert.deepEqual(itemDeletes[0].params, [101, 102]);
  assert.deepEqual(uomDelete.params, [1, 2, 3]);
  assert.deepEqual(categoryDelete.params, [999]);
  assert.deepEqual(brandDelete.params, [888]);
});

test("cleanupItemPerformanceFixtures：uomIds 空陣列就唔會執行 UOM delete", async () => {
  const database = fakeDatabase();

  await cleanupItemPerformanceFixtures({ database, categoryId: 999, brandId: 888, uomIds: [] });

  const uomDelete = database.calls.find((call) => call.sql.includes("DELETE FROM item_uoms WHERE id IN"));
  assert.equal(uomDelete, undefined);
});
