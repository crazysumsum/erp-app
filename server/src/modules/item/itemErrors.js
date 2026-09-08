import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/**
 * Item Management 共用的公開錯誤 factory，對齊
 * docs/items_management/design_spec.md §6.11 的錯誤代碼表。
 *
 * 集中在一個檔案而不是讓每個 service／handler 各自 `new ApplicationError`：
 * 這份表會被 ItemAdminService、ItemCatalogService、handlers 及未來的 CSV
 * 匯入共同引用（NFR-009：「所有狀態及 UOM 語意須有中央定義，避免不同模組各自
 * 解讀」），錯誤代碼本身就是 Web UI、CSV 及整合介面之間的合約，不該讓同一種
 * 情況在不同呼叫點被拼出兩個不同的 code。
 *
 * publicMessage 直接是繁體中文（跟 UserAdminService 的錯誤 factory 同一慣例）：
 * 前端 errorMessages.js 只翻譯後端英文 debug 字串，已經是中文的業務訊息會原樣
 * 顯示（見 docs/frontend-design.md §九）。
 *
 * `PERMISSION_STALE` 不在這裡：它是 adminGuard.assertActorFresh() 已經提供的
 * 共用框架錯誤，Item service 直接沿用，不重新定義一份。
 */

function invalid(message, { code, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode: 400,
    publicCode: code,
    publicMessage,
    details,
    publicDetails: details
  });
}

function notFound(message, { code, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode: 404,
    publicCode: code,
    publicMessage,
    details,
    publicDetails: details
  });
}

function conflict(message, { code, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode: 409,
    publicCode: code,
    publicMessage,
    details,
    publicDetails: details
  });
}

export function itemVariantNotSupported() {
  return invalid("Variant item creation is not yet supported (Attribute schema lands in a later task)", {
    code: "ITEM_VARIANT_NOT_SUPPORTED",
    publicMessage: "多規格商品建檔功能尚未開放，請先建立一般商品"
  });
}

export function skuCodeInvalid(reason) {
  return invalid(`SKU code is invalid: ${reason}`, {
    code: "SKU_CODE_INVALID",
    publicMessage: "SKU Code 格式不正確"
  });
}

export function gtinInvalid(barcode) {
  return invalid(`Barcode "${barcode}" failed GTIN length/check-digit validation`, {
    code: "GTIN_INVALID",
    publicMessage: "條碼格式不正確"
  });
}

export function uomConversionInvalid(reason) {
  return invalid(`UOM conversion is invalid: ${reason}`, {
    code: "UOM_CONVERSION_INVALID",
    publicMessage: "單位換算設定不正確"
  });
}

export function skuChildMismatch(childType, childId) {
  return invalid(`${childType} ${childId} does not belong to the target SKU`, {
    code: "SKU_CHILD_MISMATCH",
    publicMessage: "提交的資料不屬於這個 SKU，請重新載入後再試",
    details: { childType, childId }
  });
}

export function attributeValueInvalid(reason) {
  return invalid(`Attribute value is invalid: ${reason}`, {
    code: "ATTRIBUTE_VALUE_INVALID",
    publicMessage: "商品屬性內容不正確"
  });
}

export function itemNotFound(id) {
  return notFound(`Item ${id} not found`, {
    code: "ITEM_NOT_FOUND",
    publicMessage: "找不到這個商品"
  });
}

export function skuNotFound(id) {
  return notFound(`SKU ${id} not found`, {
    code: "SKU_NOT_FOUND",
    publicMessage: "找不到這個 SKU"
  });
}

export function categoryNotFound(id) {
  return notFound(`Category ${id} not found`, {
    code: "CATEGORY_NOT_FOUND",
    publicMessage: "找不到這個分類"
  });
}

export function brandNotFound(id) {
  return notFound(`Brand ${id} not found`, {
    code: "BRAND_NOT_FOUND",
    publicMessage: "找不到這個品牌"
  });
}

export function uomNotFound(id) {
  return notFound(`UOM ${id} not found`, {
    code: "UOM_NOT_FOUND",
    publicMessage: "找不到這個單位"
  });
}

export function attributeNotFound(id) {
  return notFound(`Attribute ${id} not found`, {
    code: "ATTRIBUTE_NOT_FOUND",
    publicMessage: "找不到這個商品屬性"
  });
}

export function skuCodeTaken(skuCode) {
  return conflict(`SKU code "${skuCode}" is already taken`, {
    code: "SKU_CODE_TAKEN",
    publicMessage: "這個 SKU Code 已被使用（不分大小寫）",
    details: { skuCode }
  });
}

export function barcodeTaken(barcode) {
  return conflict(`Barcode "${barcode}" is already assigned to another SKU`, {
    code: "BARCODE_TAKEN",
    publicMessage: "這個條碼已被其他 SKU 使用",
    details: { barcode }
  });
}

export function variantCombinationTaken() {
  return conflict("Variant combination is already used by another SKU in this item", {
    code: "VARIANT_COMBINATION_TAKEN",
    publicMessage: "這個規格組合已存在於同一商品內"
  });
}

export function barcodePrimaryDuplicated() {
  return invalid("More than one barcode is marked primary for the same packaging UOM", {
    code: "BARCODE_PRIMARY_DUPLICATED",
    publicMessage: "同一個包裝單位最多只可以有一個主要條碼"
  });
}

export function activationReasonRequired() {
  return invalid("activationReason is required when activate is true", {
    code: "ACTIVATION_REASON_REQUIRED",
    publicMessage: "直接啟用時必須填寫啟用原因"
  });
}

export function standardItemSkuLimit() {
  return conflict("Standard item may have exactly one SKU", {
    code: "STANDARD_ITEM_SKU_LIMIT",
    publicMessage: "單規格商品只能有一個 SKU"
  });
}

export function versionConflict() {
  return conflict("The record changed since it was loaded", {
    code: "VERSION_CONFLICT",
    publicMessage: "畫面上的資料已過期，請重新整理後再試"
  });
}

export function statusTransitionInvalid(from, to) {
  return conflict(`Status transition from "${from}" to "${to}" is not allowed`, {
    code: "STATUS_TRANSITION_INVALID",
    publicMessage: "目前狀態不允許這個操作",
    details: { from, to }
  });
}

export function itemActivationRequiresSku() {
  return invalid("At least one SKU must actually activate for the Item itself to become Active", {
    code: "ITEM_ACTIVATION_REQUIRES_SKU",
    publicMessage: "商品由草稿／停用轉為啟用時，至少要同時啟用一個 SKU"
  });
}

export function lastActiveSku() {
  return conflict("Cannot deactivate the item's last active SKU", {
    code: "LAST_ACTIVE_SKU",
    publicMessage: "這是商品目前唯一啟用中的 SKU，請先停用商品或啟用另一個 SKU"
  });
}

export function itemDeleteRequiresDraft(status) {
  return conflict(`Only a draft item can be permanently deleted (current status: "${status}")`, {
    code: "ITEM_DELETE_REQUIRES_DRAFT",
    publicMessage: "只可以永久刪除草稿狀態嘅商品",
    details: { status }
  });
}

export function skuDeleteRequiresDraft(status) {
  return conflict(`Only a draft SKU can be permanently deleted (current status: "${status}")`, {
    code: "SKU_DELETE_REQUIRES_DRAFT",
    publicMessage: "只可以永久刪除草稿狀態嘅 SKU",
    details: { status }
  });
}

export function lastSkuInItem() {
  return conflict("Cannot delete the item's only remaining SKU", {
    code: "SKU_IS_LAST_IN_ITEM",
    publicMessage: "這是商品目前唯一的 SKU，刪除後商品會變成零 SKU，請改為刪除整個商品"
  });
}

export function barcodeNotFound(id) {
  return notFound(`Barcode ${id} was not found on this SKU`, {
    code: "BARCODE_NOT_FOUND",
    publicMessage: "找不到這個條碼"
  });
}

export function itemReferenced(referenceTypes) {
  return conflict(`Item is referenced by: ${referenceTypes.join(", ")}`, {
    code: "ITEM_REFERENCED",
    publicMessage: "這個商品已被其他資料引用，無法刪除",
    details: { referenceTypes }
  });
}

export function skuReferenced(referenceTypes) {
  return conflict(`SKU is referenced by: ${referenceTypes.join(", ")}`, {
    code: "SKU_REFERENCED",
    publicMessage: "這個 SKU 已被其他資料引用，無法刪除",
    details: { referenceTypes }
  });
}

export function catalogInUse(referenceTypes) {
  return conflict(`Catalog record is referenced by: ${referenceTypes.join(", ")}`, {
    code: "CATALOG_IN_USE",
    publicMessage: "這筆資料使用中，無法刪除",
    details: { referenceTypes }
  });
}

export function categoryHasChildren() {
  return conflict("Category has child categories and cannot be deleted", {
    code: "CATEGORY_HAS_CHILDREN",
    publicMessage: "這個分類還有子分類，無法刪除"
  });
}

// --- Catalog（Category／Brand／UOM）專用錯誤 -------------------------------
//
// 不在 §6.11 的 Item／SKU 錯誤表內，因為那張表描述的是 Item aggregate；這幾個
// 是 Catalog 資料自己的唯一性與樹狀結構規則，錯誤代碼獨立命名避免跟未來的
// Item 專屬衝突撞在一起。

export function categoryNameTaken(name) {
  return conflict(`Category name "${name}" is already used under the same parent`, {
    code: "CATEGORY_NAME_TAKEN",
    publicMessage: "同一父分類下已有相同名稱的分類",
    details: { name }
  });
}

export function brandNameTaken(name) {
  return conflict(`Brand name "${name}" is already taken`, {
    code: "BRAND_NAME_TAKEN",
    publicMessage: "這個品牌名稱已被使用（不分大小寫）",
    details: { name }
  });
}

export function uomCodeTaken(code) {
  return conflict(`UOM code "${code}" is already taken`, {
    code: "UOM_CODE_TAKEN",
    publicMessage: "這個單位代碼已被使用",
    details: { code }
  });
}

export function categoryCycle() {
  return invalid("Moving this category under the given parent would create a cycle", {
    code: "CATEGORY_CYCLE",
    publicMessage: "不能把分類移動到自己或自己的子分類底下"
  });
}

export function categoryMaxDepthExceeded(maxDepth) {
  return invalid(`Category tree depth would exceed the configured maximum of ${maxDepth}`, {
    code: "CATEGORY_MAX_DEPTH_EXCEEDED",
    publicMessage: `分類層數超過系統上限（${maxDepth} 層）`,
    details: { maxDepth }
  });
}

export function categoryParentNotActive() {
  return conflict("Category parent must be active", {
    code: "CATEGORY_PARENT_NOT_ACTIVE",
    publicMessage: "上層分類必須是啟用狀態才可指派子分類"
  });
}

export function uomChangeBlocked() {
  return conflict("Base UOM or its conversion cannot change after transactions exist", {
    code: "UOM_CHANGE_BLOCKED",
    publicMessage: "已有庫存或交易記錄，無法直接修改單位"
  });
}

export function trackingPolicyChangeBlocked() {
  return conflict("Tracking policy cannot change after transactions or stock exist", {
    code: "TRACKING_POLICY_CHANGE_BLOCKED",
    publicMessage: "已有庫存或交易記錄，無法直接修改追蹤政策"
  });
}

/**
 * T16 範圍：Base UOM／換算係數／追蹤政策呢類關鍵變更，本期未有庫存／交易
 * 表可以查（見 design_spec.md §8.4），所以未去到「已有交易／庫存就直接
 * 擋」呢層（嗰層係 `uomChangeBlocked()`／`trackingPolicyChangeBlocked()`，
 * 留俾第一個真引用出現嗰陣先接上）。現在做得到、亦已確認要做嘅係較弱嘅
 * 規則：呢類改動一定要帶 reason，唔可以靜靜哋改。
 */
export function criticalChangeReasonRequired() {
  return invalid("A reason is required when changing Base UOM, UOM factors, or tracking policy", {
    code: "CRITICAL_CHANGE_REASON_REQUIRED",
    publicMessage: "修改 Base 單位、單位換算係數或追蹤政策時必須填寫原因"
  });
}

export function itemNotActivatable(issues) {
  return new ApplicationError("Item/SKU failed activation checks", {
    code: "ITEM_NOT_ACTIVATABLE",
    statusCode: 422,
    publicCode: "ITEM_NOT_ACTIVATABLE",
    publicMessage: "資料尚未符合啟用條件",
    details: { issues },
    // `details` 淨係入 log（見 errorHandler.js），response 實際送嘅係
    // `publicDetails`——呢個 issues 陣列係俾前端逐個 field 標紅用（見
    // client/src/framework/ui/FormPanel.vue），冇呢個 API 契約就得返
    // code／message，前端做唔到逐 field 定位錯誤。
    publicDetails: { issues }
  });
}

export function importNotReady() {
  return conflict("Import job is not in a state that allows this action", {
    code: "IMPORT_NOT_READY",
    publicMessage: "這個匯入工作目前的狀態不允許此操作"
  });
}

export function importStateConflict() {
  return conflict("Import job state changed since it was loaded", {
    code: "IMPORT_STATE_CONFLICT",
    publicMessage: "匯入工作狀態已變更，請重新整理後再試"
  });
}

export function importFileExpired() {
  return new ApplicationError("Import source/result file has been purged by retention cleanup", {
    code: "IMPORT_FILE_EXPIRED",
    statusCode: 410,
    publicCode: "IMPORT_FILE_EXPIRED",
    publicMessage: "檔案已超過保留期限並已被清除，但工作紀錄仍可查閱"
  });
}
