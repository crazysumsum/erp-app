/**
 * Item 匯入 CSV 的欄位契約。設計說明見
 * docs/items_management/design_spec.md §5.13、§6.9（Import APIs）。
 *
 * design_spec 本身冇釘死實際欄位名——呢份契約喺 T28 開工前已經喺 chat 同
 * 使用者核對過（範圍：淨係 Standard 商品，Variant 匯入唔喺呢期）。呢個檔案
 * 只放「呢份 CSV 長咩樣」，唔放解析或驗證邏輯（嗰啲喺 ItemImportProcessor.js）。
 *
 * 只支援 Standard 商品：一列 CSV 對應一個 Item＋一個 SKU 嘅 pair。`skuId`
 * 空白代表呢一列建立新嘅 Item＋SKU；有值代表更新一粒已存在嘅 SKU（配對用
 * SKU ID，唔係 SKU Code——SKU Code 淨係顯示／交叉檢查，唔可以藉呢個途徑
 * 繞過專門嘅 code 修改特批流程，見 design_spec §5.13）。
 */

/** CSV contract 版本。改呢份契約（加／減／改欄位語意）就要連呢個版本一齊
 * 升，等舊版本 template 產生嘅 CSV 唔會被誤當做新版本解讀。 */
export const IMPORT_TEMPLATE_VERSION = "v1";

/**
 * 已知欄位，依 template 產生時嘅順序列出。`required` 係「呢個欄位喺
 * create 一列必填」；update 一列嘅必填規則唔同（淨係 `skuId`／
 * `expectedSkuVersion`／`skuCode`／`skuName` 必填），由 ItemImportProcessor.js
 * 按 operation 分支處理，唔喺呢度用單一 flag 表達。
 */
export const IMPORT_CSV_COLUMNS = Object.freeze([
  Object.freeze({ name: "skuId", requiredOnCreate: false }),
  Object.freeze({ name: "expectedSkuVersion", requiredOnCreate: false }),
  Object.freeze({ name: "skuCode", requiredOnCreate: true }),
  Object.freeze({ name: "skuName", requiredOnCreate: true }),
  Object.freeze({ name: "itemName", requiredOnCreate: true }),
  Object.freeze({ name: "categoryName", requiredOnCreate: true }),
  Object.freeze({ name: "brandName", requiredOnCreate: true }),
  Object.freeze({ name: "defaultTrackingPolicy", requiredOnCreate: false }),
  Object.freeze({ name: "suggestedPriceAmount", requiredOnCreate: false }),
  Object.freeze({ name: "purchasable", requiredOnCreate: false }),
  Object.freeze({ name: "sellable", requiredOnCreate: false }),
  Object.freeze({ name: "baseUomCode", requiredOnCreate: true })
]);

export const IMPORT_CSV_COLUMN_NAMES = Object.freeze(IMPORT_CSV_COLUMNS.map((column) => column.name));

/** 顯示／輸入用字串欄位（`skuCode`／`skuName`／`itemName`／`categoryName`／
 * `brandName`）嘅長度上限，對齊實際 DB 欄寬（`item_skus.sku_code` 等都係
 * VARCHAR(190)）——喺呢度擋住，好過等 INSERT 嗰陣先俾資料庫拒絕，錯誤訊息
 * 亦更貼近使用者睇緊嘅嗰欄。 */
export const IMPORT_TEXT_FIELD_MAX_LENGTH = 190;

/** `GET /api/v1/item-imports/template` 用嘅 header row（T29 先接上呢支
 * 端點，呢度先準備好內容）。CRLF 對齊 RFC 4180 同 Excel 開 CSV 嘅慣例。 */
export function buildImportTemplateHeaderRow() {
  return `${IMPORT_CSV_COLUMN_NAMES.join(",")}\r\n`;
}
