/**
 * Item Management 的 domain constants——狀態、追蹤政策、條碼種類、固定價格
 * 口徑、匯入檔案保留期與排序白名單。設計說明見
 * docs/items_management/design_spec.md §5.2、§8.7、§8.8、§12.1、§12.4。
 *
 * 這些值會被 Web UI、CSV 匯入／匯出及未來的整合 API 共同引用（NFR-009：
 * 「所有狀態及 UOM 語意須有中央定義，避免不同模組各自解讀」）。跟
 * config/item.js 的分工：這個檔案放「已確認的商業決策」，不隨部署環境改變、
 * 也不接受環境變數覆寫；config/item.js 放「會隨部署環境變動的資源與路徑」。
 *
 * 此文件只保存常數，不應加入 function 或執行任何初始化邏輯。
 */

/**
 * Item 與 SKU 共用同一組狀態語意（§7.1）：兩者都是
 * draft → active → inactive/discontinued → archived 的生命週期，差別只在
 * 允許的轉換與各自的完整性條件由 service 分別控制，不代表可以用同一個狀態機
 * 常數就假設兩者规则相同。
 */
export const ITEM_STATUSES = Object.freeze([
  "draft",
  "active",
  "inactive",
  "discontinued",
  "archived"
]);

/** Category／Brand／UOM／Attribute 等 catalog 資料共用的較簡單狀態集合。 */
export const CATALOG_STATUSES = Object.freeze(["active", "inactive", "archived"]);

/** Item.product_type：Standard 恰好一個 SKU，Variant 才可有多個（BR-001、DEC-017）。 */
export const ITEM_PRODUCT_TYPES = Object.freeze(["standard", "variant"]);

/** Item／SKU 的批次、序號及有效期追蹤政策（§6.1 名詞定義、BR-009）。 */
export const TRACKING_POLICIES = Object.freeze(["none", "batch", "batch_expiry", "serial"]);

/** 支援的條碼種類（§6.8）。GTIN 系列會驗證長度及檢查碼，internal 只做基本安全字元處理。 */
export const BARCODE_TYPES = Object.freeze(["gtin8", "upca", "ean13", "gtin14", "internal"]);

/** 各 GTIN 條碼種類的固定總長度（含 check digit），§6.8。 */
export const GTIN_LENGTHS = Object.freeze({ gtin8: 8, upca: 12, ean13: 13, gtin14: 14 });

/** Internal 條碼的長度上限，跟 item_sku_barcodes.barcode 的欄寬一致（§4.5）。 */
export const INTERNAL_BARCODE_MAX_LENGTH = 190;

/**
 * SKU UOM 換算係數（to_base_factor）允許的整數範圍（§4.6、§5.8）：1 到
 * 1,000,000 的正整數，不接受小數。已確認的業務決策，不是部署設定。
 */
export const UOM_FACTOR_MIN = 1;
export const UOM_FACTOR_MAX = 1_000_000;

/** 金額（RRP）用 DECIMAL(19,4)：19 位有效數字，其中 4 位是小數（§4.6、§5.7）。 */
export const MONEY_DECIMAL = Object.freeze({ integerDigits: 15, decimalPlaces: 4 });

/** 重量、尺寸、淨含量用 DECIMAL(20,6)（§4.6、§5.7）。 */
export const MEASUREMENT_DECIMAL = Object.freeze({ integerDigits: 14, decimalPlaces: 6 });

/**
 * 建議零售價固定使用公司基礎幣別，不讓每個 SKU 或每次請求自行選擇
 * （DEC-016、BR-025）。改動這個值必須先改 requirement，因為它是已簽核的
 * 業務決策，不是部署設定。
 */
export const ITEM_PRICE_CURRENCY = "HKD";

/** 建議零售價固定的稅務口徑；本期不適用銷售稅（DEC-016、BR-025）。 */
export const ITEM_PRICE_TAX_BASIS = "tax_not_applicable";

/** Item／SKU／Catalog 主資料、audit 及 import job summary 的最低保留年限（DEC-023）。 */
export const ITEM_DATA_RETENTION_YEARS = 7;

/**
 * CSV 匯入原始檔／結果檔從 Job 完成日起的保留天數（DEC-023）。到期後只刪實體
 * 檔並標記 `files_purged_at`，不影響 Job summary 或 audit 的 7 年保留。
 *
 * 用 365 而不是「一年」的月曆計算：ItemImportFileCleanupJob 用 UTC 週年日
 * 判斷到期（§12.1），以固定天數表示才不會在閏年產生歧義。
 */
export const IMPORT_FILE_RETENTION_DAYS = 365;

/** Import Job 狀態機（§5.13）。 */
export const IMPORT_JOB_STATUSES = Object.freeze([
  "uploaded",
  "validating",
  "invalid",
  "ready",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

/** Import Job 的匯入模式：只新增，或新增與更新並存（§5.13）。 */
export const IMPORT_JOB_MODES = Object.freeze(["create_only", "upsert"]);

/** Import Row 逐列狀態（§5.13）。 */
export const IMPORT_ROW_STATUSES = Object.freeze([
  "valid",
  "warning",
  "invalid",
  "applied",
  "skipped",
  "failed"
]);

/**
 * `GET /api/v1/items`／`GET /api/v1/skus` 可接受的排序欄位白名單（FR-LIST-005、
 * §8.8）。排序欄位一律走白名單、不接受任意欄位字串拼 SQL——這是 API 合約的
 * 一部分，所以放在 constants 而不是留給個別 handler 各自決定一份。
 */
export const ITEM_LIST_SORT_FIELDS = Object.freeze([
  "skuCode",
  "name",
  "category",
  "brand",
  "status",
  "updatedAt"
]);

/** Category／Brand／UOM／Attribute 等 catalog 列表可接受的排序欄位白名單。 */
export const CATALOG_LIST_SORT_FIELDS = Object.freeze(["name", "status", "updatedAt"]);
