/**
 * Item Management 的部署／資源設定。設計說明見
 * docs/items_management/design_spec.md §12.1。
 *
 * 只放會隨部署環境變動的數字與路徑（容量上限、目錄、timeout）。已確認的
 * domain constants——狀態、追蹤政策、條碼種類，尤其是固定 HKD／
 * `tax_not_applicable` 價格口徑——一律定義在
 * `src/modules/item/itemConstants.js`，不放進這個檔案、也不接受環境變數
 * 覆寫：允許用環境變數改價格口徑，等於讓部署設定決定商業口徑，而那必須
 * 先改 requirement 再改程式碼（見 design_spec.md §5.2）。
 *
 * 此文件只保存配置資料，不應加入 function 或執行任何初始化邏輯。
 */
const itemConfig = {
  // Category tree 的最大層數。需求書 §6.4 只要求「至少三級」，8 是目前已確認
  // 的實際上限；调整前先確認前端 tree 元件與壓測資料是否也要跟著改。
  categoryMaxDepth: Number(process.env.ITEM_CATEGORY_MAX_DEPTH || 8),

  // Item／SKU media 的受控儲存根目錄。相對路徑以 server 目錄為基準（與
  // config/logging.js 的 directory 同一慣例），正規化後只會是一個受控的
  // absolute path——ItemMediaService 與 ItemMediaCleanupJob 之外，任何程式碼
  // 都不應該自己組這個路徑。
  mediaDirectory: process.env.ITEM_MEDIA_DIRECTORY || "storage/items",

  // 單張圖片上限，預設 5MB。
  imageMaxBytes: Number(process.env.ITEM_IMAGE_MAX_BYTES || 5_242_880),

  // 單個附件（PDF 等）上限，預設 10MB。
  attachmentMaxBytes: Number(process.env.ITEM_ATTACHMENT_MAX_BYTES || 10_485_760),

  // Media 記錄在 DB 交易中被刪除後，實體檔案還要保留多久（毫秒）才會被
  // ItemMediaCleanupJob 清除。DB 與檔案系統不能用同一個交易，這段寬限期是為了
  // 讓「metadata 已刪、實體檔還在」這個過渡狀態不會被清理 job 誤刪成正在使用
  // 中的檔案。預設 1 天。
  mediaOrphanGraceMs: Number(process.env.ITEM_MEDIA_ORPHAN_GRACE_MS || 86_400_000),

  // Phase 3：CSV 匯入單一 Job 允許的最大資料列數，對齊 NFR-004 的 10,000 列
  // 基準。
  importMaxRows: Number(process.env.ITEM_IMPORT_MAX_ROWS || 10_000),

  // Phase 3：匯入執行階段每個 batch 處理的列數，用來讓單一 transaction 的
  // 大小有界。
  importBatchSize: Number(process.env.ITEM_IMPORT_BATCH_SIZE || 200),

  // Phase 3：匯入執行 transaction 的最長時間（毫秒），交給 scheduler 的
  // abort signal 執行。
  importTransactionTimeoutMs: Number(
    process.env.ITEM_IMPORT_TRANSACTION_TIMEOUT_MS || 120_000
  )
};

export default itemConfig;
