/**
 * Claim 一個 `queued` import job，重新驗證所引用嘅 catalog／unique／SKU
 * version，喺單一個商品交易入面套用全部 valid row，然後用一個獨立嘅短交易
 * 更新 job 狀態。設計說明見 docs/items_management/design_spec.md §5.13、
 * §8.6、DEC-013（「匯入全有全無」）。
 *
 * 淨係支援 Standard 商品，對應 T28 已經核對過嘅 CSV 欄位契約：一列 CSV
 * 對應一個 Item＋SKU pair，create 建全新嘅 draft Item＋SKU，update 淨係改
 * 目標 SKU 嘅 `skuName`／`defaultTrackingPolicy`／`suggestedPriceAmount`／
 * `purchasable`／`sellable`（唔碰 Item 層級欄位、唔碰 SKU Code、唔碰 UOM／
 * barcode 集合）。
 *
 * 冇重用 `ItemAdminService.createItem()`：嗰個方法自己開一個交易，逐 row
 * 各自 commit 一次會令「任何一 row 失敗、整批 rollback」呢個 all-or-nothing
 * 保證做唔到——要重用就要將 createItem() 拆做「接受外部 connection」嘅版本，
 * 屬於對一個已經有 1000+ 個測試依賴住嘅現有 service 嘅結構性改動，風險同
 * 呢個 task 本身唔成比例。呢度改為直接寫精簡、範圍限定喺 CSV 契約嘅
 * INSERT／UPDATE，代價係同 ItemAdminService 之間有少量重複，換嚟嘅係唔驚
 * 動一個已經穩定嘅既有模組。
 */
import {
  brandNotFound,
  categoryNotFound,
  skuCodeTaken,
  skuNotFound,
  uomNotFound,
  versionConflict
} from "../../../modules/item/itemErrors.js";

function sanitizeExecutionError(error) {
  // ApplicationError（categoryNotFound()／skuCodeTaken() 等）都帶
  // publicMessage，本身已經係安全、冇 SQL／stack 嘅中文訊息；其他錯誤
  // （例如未預期嘅 mysql2 error）一律用一句唔洩漏內部細節嘅泛用訊息，真正
  // 原因留喺 structured log。
  return error?.publicMessage || "套用失敗，已全部復原（詳情請查看伺服器日誌）";
}

async function assertExists(connection, table, id, notFoundError) {
  const [[row]] = await connection.query(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!row) {
    throw notFoundError(id);
  }
}

async function applyCreateRow(connection, row, { nowMs, actorId }) {
  const {
    skuCode,
    skuName,
    itemName,
    categoryId,
    brandId,
    baseUomId,
    defaultTrackingPolicy,
    suggestedPriceAmount,
    purchasable,
    sellable
  } = row.normalizedPayload;

  // 重新驗證：preflight 到 confirm＋execution 之間可能過咗好一段時間，呢幾
  // 個 id 隨時已經唔存在（分類俾人刪咗、品牌俾人刪咗）。
  await assertExists(connection, "item_categories", categoryId, categoryNotFound);
  await assertExists(connection, "item_brands", brandId, brandNotFound);
  await assertExists(connection, "item_uoms", baseUomId, uomNotFound);

  const [[existingCode]] = await connection.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode]);
  if (existingCode) {
    throw skuCodeTaken(skuCode);
  }

  const [itemResult] = await connection.execute(
    `INSERT INTO items
       (name, short_name, description, category_id, brand_id, product_type, country_of_origin,
        manufacturer, default_tracking_policy, default_shelf_life_days, status, version,
        created_at, updated_at, created_by, updated_by)
     VALUES (?, '', NULL, ?, ?, 'standard', NULL, '', ?, NULL, 'draft', 1, ?, ?, ?, ?)`,
    [itemName, categoryId, brandId, defaultTrackingPolicy, nowMs, nowMs, actorId, actorId]
  );
  const itemId = itemResult.insertId;

  const [skuResult] = await connection.execute(
    `INSERT INTO item_skus
       (item_id, sku_code, sku_name, tracking_policy, purchasable, sellable, inventory_tracked,
        suggested_price_amount, status, version, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'draft', 1, ?, ?, ?, ?)`,
    [
      itemId,
      skuCode,
      skuName,
      defaultTrackingPolicy,
      purchasable ? 1 : 0,
      sellable ? 1 : 0,
      suggestedPriceAmount,
      nowMs,
      nowMs,
      actorId,
      actorId
    ]
  );
  const skuId = skuResult.insertId;

  await connection.execute(
    `INSERT INTO item_sku_uoms
       (sku_id, uom_id, to_base_factor, is_base, is_default_purchase, is_default_sale, version,
        created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, 1, 1, ?, ?, 1, ?, ?, ?, ?)`,
    [skuId, baseUomId, purchasable ? 1 : 0, sellable ? 1 : 0, nowMs, nowMs, actorId, actorId]
  );
}

async function applyUpdateRow(connection, row, { nowMs, actorId }) {
  const { skuName, defaultTrackingPolicy, suggestedPriceAmount, purchasable, sellable } = row.normalizedPayload;

  const [result] = await connection.execute(
    `UPDATE item_skus
        SET sku_name = ?, tracking_policy = ?, suggested_price_amount = ?, purchasable = ?, sellable = ?,
            updated_at = ?, updated_by = ?, version = version + 1
      WHERE id = ? AND version = ?`,
    [
      skuName,
      defaultTrackingPolicy,
      suggestedPriceAmount,
      purchasable ? 1 : 0,
      sellable ? 1 : 0,
      nowMs,
      actorId,
      row.matchSkuId,
      row.expectedSkuVersion
    ]
  );

  if (result.affectedRows === 0) {
    const [[stillExists]] = await connection.query("SELECT id FROM item_skus WHERE id = ?", [row.matchSkuId]);
    if (!stillExists) {
      throw skuNotFound(row.matchSkuId);
    }
    throw versionConflict();
  }
}

export async function executeItemImportJob({
  importService,
  database,
  logger,
  time,
  importDirectory,
  transactionTimeoutMs,
  leaseOwner,
  leaseDurationMs
}) {
  const job = await importService.claimNextQueuedJobForExecution({ leaseOwner, leaseDurationMs });

  if (!job) {
    return { claimed: false };
  }

  void logger?.info?.("item.import.claimed", "Import job claimed for execution", { jobId: job.id, leaseOwner });

  const rows = await importService.listValidRowsForExecution({ jobId: job.id });
  const nowMs = time.nowMs();

  let appliedCount = 0;
  let executionError = null;
  let failedRowNumber = null;

  try {
    await database.withTransaction(
      async (connection) => {
        for (const row of rows) {
          try {
            if (row.operation === "create") {
              await applyCreateRow(connection, row, { nowMs, actorId: job.createdBy });
            } else {
              await applyUpdateRow(connection, row, { nowMs, actorId: job.createdBy });
            }
            appliedCount += 1;
          } catch (rowError) {
            failedRowNumber = row.rowNumber;
            throw rowError;
          }
        }
      },
      { timeoutMs: transactionTimeoutMs }
    );
  } catch (error) {
    executionError = error;
  }

  const status = executionError ? "failed" : "completed";
  const successCount = executionError ? 0 : appliedCount;
  const failureCount = executionError ? rows.length : 0;
  const errorSummary = executionError
    ? `第 ${failedRowNumber} 列套用失敗，整批已復原：${sanitizeExecutionError(executionError)}`
    : null;

  // 獨立嘅短交易——見檔案開頭說明，唔可以同上面套用商品變更嗰個交易共用，
  // 否則 rollback 會連呢個狀態更新一齊撤銷。呢度亦一併將 row 逐列狀態由
  // preflight 嘅 valid／warning 覆寫做 applied／failed（見
  // recordExecutionResult() 的說明）。
  await importService.recordExecutionResult({
    jobId: job.id,
    status,
    successCount,
    failureCount,
    errorSummary,
    appliedRowNumbers: executionError ? [] : rows.map((row) => row.rowNumber),
    failedRow: executionError ? { rowNumber: failedRowNumber, message: sanitizeExecutionError(executionError) } : null
  });
  await importService.writeResultFile({ jobId: job.id, importDirectory });

  void logger?.[executionError ? "error" : "info"]?.(
    executionError ? "item.import.failed" : "item.import.completed",
    "Import job execution finished",
    { jobId: job.id, status, successCount, failureCount, ...(failedRowNumber ? { failedRowNumber } : {}) }
  );

  return { claimed: true, jobId: job.id, outcome: status };
}
