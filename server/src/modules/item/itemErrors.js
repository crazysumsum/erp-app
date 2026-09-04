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
    details
  });
}

function notFound(message, { code, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode: 404,
    publicCode: code,
    publicMessage,
    details
  });
}

function conflict(message, { code, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode: 409,
    publicCode: code,
    publicMessage,
    details
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

export function lastActiveSku() {
  return conflict("Cannot deactivate the item's last active SKU", {
    code: "LAST_ACTIVE_SKU",
    publicMessage: "這是商品目前唯一啟用中的 SKU，請先停用商品或啟用另一個 SKU"
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

export function itemNotActivatable(issues) {
  return new ApplicationError("Item/SKU failed activation checks", {
    code: "ITEM_NOT_ACTIVATABLE",
    statusCode: 422,
    publicCode: "ITEM_NOT_ACTIVATABLE",
    publicMessage: "資料尚未符合啟用條件",
    details: { issues }
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
