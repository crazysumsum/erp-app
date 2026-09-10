/**
 * T35 效能驗證用嘅可重複大量資料產生器（design_spec §11.5：100,000 SKU、
 * 1,000,000 barcode、1,000,000 UOM rows）。純 bulk INSERT，唔經過
 * ItemAdminService（呢個係壓測用嘅資料量產，唔係業務邏輯驗證）。
 *
 * 每次執行用一個隨機 marker 標記自己嘅 category／brand／UOM／item 名稱，
 * 令 cleanup 可以精準淨係刪返自己嗰批（唔會誤刪其他 session 嘅資料），亦令
 * 重複執行本身係安全嘅（唔會撞去舊一批嘅唯一值）。
 *
 * 依賴 innodb_autoinc_lock_mode=2（interleaved）：單一 multi-row INSERT
 * statement 拎到嘅 insertId 係嗰個 statement 自己嗰組連續 id 嘅第一個，即使
 * 同時有第二個 session 一齊寫緊入同一張表都唔會斷開——所以下面靠
 * `insertId + offset` 計返每一列自己嘅 id，唔使逐列查一次。
 */
import { randomUUID } from "node:crypto";

const DEFAULT_SKU_COUNT = 100_000;
const DEFAULT_UOMS_PER_SKU = 10;
const DEFAULT_BARCODES_PER_SKU = 10;
const DEFAULT_BATCH_SIZE = 500;

function valuesClause(rowCount, columnsPerRow) {
  const row = `(${Array(columnsPerRow).fill("?").join(",")})`;
  return Array(rowCount).fill(row).join(",");
}

/**
 * 產生 `skuCount` 個 standard product type 嘅 Item＋SKU，每粒 SKU 掛
 * `uomsPerSku` 個包裝單位（第一個係 base／預設採購／預設銷售）同
 * `barcodesPerSku` 個 internal barcode（同 uomsPerSku 一一對應，每個
 * sku_uom 一個 primary barcode）。回傳嘅 `marker` 用嚟做之後嘅 cleanup。
 */
export async function seedItemPerformanceFixtures({
  database,
  skuCount = DEFAULT_SKU_COUNT,
  uomsPerSku = DEFAULT_UOMS_PER_SKU,
  barcodesPerSku = DEFAULT_BARCODES_PER_SKU,
  batchSize = DEFAULT_BATCH_SIZE,
  onProgress
}) {
  if (barcodesPerSku > uomsPerSku) {
    throw new RangeError("barcodesPerSku 唔可以多過 uomsPerSku：每個 barcode 要對應一個唔同嘅 sku_uom_id");
  }

  const marker = randomUUID().slice(0, 8);
  const nowMs = Date.now();

  const [categoryResult] = await database.query(
    "INSERT INTO item_categories (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`perf-cat-${marker}`, nowMs, nowMs]
  );
  const categoryId = categoryResult.insertId;

  const [brandResult] = await database.query(
    "INSERT INTO item_brands (name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
    [`perf-brand-${marker}`, nowMs, nowMs]
  );
  const brandId = brandResult.insertId;

  const uomIds = [];
  for (let index = 0; index < uomsPerSku; index += 1) {
    const [result] = await database.query(
      "INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
      [`PERF${marker}${index}`, `Perf UOM ${marker} ${index}`, nowMs, nowMs]
    );
    uomIds.push(result.insertId);
  }

  let created = 0;
  while (created < skuCount) {
    const count = Math.min(batchSize, skuCount - created);

    const itemParams = [];
    for (let i = 0; i < count; i += 1) {
      itemParams.push(`perf-item-${marker}-${created + i}`, categoryId, brandId, "active", nowMs, nowMs);
    }
    const [itemResult] = await database.query(
      `INSERT INTO items (name, category_id, brand_id, product_type, status, created_at, updated_at)
       VALUES ${Array(count).fill("(?, ?, ?, 'standard', ?, ?, ?)").join(",")}`,
      itemParams
    );
    const firstItemId = itemResult.insertId;

    const skuParams = [];
    for (let i = 0; i < count; i += 1) {
      const itemId = firstItemId + i;
      const index = created + i;
      skuParams.push(itemId, `PERF-SKU-${marker}-${index}`, `Perf SKU ${marker} ${index}`, nowMs, nowMs);
    }
    const [skuResult] = await database.query(
      `INSERT INTO item_skus
         (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked, status,
          created_at, updated_at)
       VALUES ${Array(count).fill("(?, ?, ?, 'none', 1, 1, 1, 'active', ?, ?)").join(",")}`,
      skuParams
    );
    const firstSkuId = skuResult.insertId;

    const uomParams = [];
    for (let i = 0; i < count; i += 1) {
      const skuId = firstSkuId + i;
      for (let u = 0; u < uomsPerSku; u += 1) {
        const isBase = u === 0 ? 1 : 0;
        uomParams.push(skuId, uomIds[u], u === 0 ? 1 : (u + 1) * 10, isBase, isBase, isBase, nowMs, nowMs);
      }
    }
    const [uomResult] = await database.query(
      `INSERT INTO item_sku_uoms
         (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale, created_at, updated_at)
       VALUES ${valuesClause(count * uomsPerSku, 8)}`,
      uomParams
    );
    const firstSkuUomId = uomResult.insertId;

    const barcodeParams = [];
    for (let i = 0; i < count; i += 1) {
      const skuId = firstSkuId + i;
      const skuIndex = created + i;
      const baseSkuUomId = firstSkuUomId + i * uomsPerSku;
      for (let b = 0; b < barcodesPerSku; b += 1) {
        const skuUomId = baseSkuUomId + b;
        const code = `PERFBC${marker}-${skuIndex}-${b}`;
        barcodeParams.push(skuId, skuUomId, code, code, "internal", 1, nowMs, nowMs);
      }
    }
    await database.query(
      `INSERT INTO item_sku_barcodes
         (sku_id, sku_uom_id, barcode, normalized_barcode, barcode_type, is_primary, created_at, updated_at)
       VALUES ${valuesClause(count * barcodesPerSku, 8)}`,
      barcodeParams
    );

    created += count;
    onProgress?.({ created, skuCount });
  }

  return { marker, categoryId, brandId, uomIds, skuCount, uomsPerSku, barcodesPerSku };
}

/** 對稱嘅清理：只刪返 `seedItemPerformanceFixtures()` 呢一次執行建立嘅資料，
 * 順序跟返 FK 約束（barcode 先，先至係 CASCADE 帶埋 sku_uoms 嘅 Item，最後
 * 先係 共用 catalog）。
 *
 * 刻意分批（`batchSize` 個 item 一批）刪除，唔一次過對成百萬列落一句
 * DELETE：實測一次過刪（無論寫成 JOIN 定係 `WHERE id IN (SELECT ...)`
 * 子查詢）喺呢個資料量、透過 mysql2 connection pool 執行時，會喺上一句
 * 大範圍 DELETE 完成之後、下一句都未發出之前完全卡死——MySQL 端睇唔到
 * 任何 executing 緊嘅 query，Node 端 event loop 亦完全 idle，唔拋錯、亦
 * 唔會逾時，只可以外部強制終止進程先擺脫到。用 plain mysql client 執行
 * 完全同一句 SQL 反而每次都跑得完（慢但正常完成），可見唔係 SQL 本身嘅
 * 問題，而係呢個規模下 mysql2／連線池某個邊界情況嘅 bug——超出呢個
 * fixture helper 應該處理嘅範圍，分批令每次操作規模細好多（預設 5,000
 * 個 item，連帶 50,000 條 barcode／sku_uom）作為務實嘅迴避方式。 */
export async function cleanupItemPerformanceFixtures({ database, categoryId, brandId, uomIds, batchSize = 5000 }) {
  for (;;) {
    const [rows] = await database.query("SELECT id FROM items WHERE category_id = ? LIMIT ?", [categoryId, batchSize]);
    if (rows.length === 0) {
      break;
    }

    const ids = rows.map((row) => row.id);
    const idPlaceholders = ids.map(() => "?").join(",");

    await database.execute(
      `DELETE b FROM item_sku_barcodes b
         JOIN item_skus s ON s.id = b.sku_id
        WHERE s.item_id IN (${idPlaceholders})`,
      ids
    );
    // item_skus→item_sku_uoms 係 CASCADE，刪 items 已經帶埋兩張表。
    await database.execute(`DELETE FROM items WHERE id IN (${idPlaceholders})`, ids);
  }

  if (uomIds?.length) {
    const uomPlaceholders = uomIds.map(() => "?").join(",");
    await database.execute(`DELETE FROM item_uoms WHERE id IN (${uomPlaceholders})`, uomIds);
  }
  await database.execute("DELETE FROM item_categories WHERE id = ?", [categoryId]);
  await database.execute("DELETE FROM item_brands WHERE id = ?", [brandId]);
}
