/**
 * Item 查詢／建立端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.2、§6.9、§6.10。
 */
import {
  BARCODE_TYPES,
  ITEM_LIST_SORT_FIELDS,
  ITEM_PRODUCT_TYPES,
  ITEM_PRICE_CURRENCY,
  ITEM_PRICE_TAX_BASIS,
  ITEM_STATUSES,
  MONEY_DECIMAL,
  TRACKING_POLICIES,
  UOM_FACTOR_MAX,
  UOM_FACTOR_MIN
} from "../../modules/item/itemConstants.js";
import { decimalStringPattern } from "../../modules/item/itemValidation.js";

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export const ITEM_VIEW_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.view"]) })
  })
]);

export const ITEM_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.mgmt"]) })
  })
]);

/** 路徑上的 Item id。字串是因為 Express 的 req.params 一律是字串。 */
export const ITEM_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

export const ITEM_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    q: { type: "string", maxLength: 190, default: "" },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    // 冇明確指定 status 先套呢個預設：Archived 預設不在日常列表顯示
    // （FR-DELETE-005），明確 status=archived 不受這個預設影響。
    includeArchived: { type: "boolean", default: false },
    sortBy: { type: "string", enum: [...ITEM_LIST_SORT_FIELDS], default: "updatedAt" },
    descending: { type: "boolean", default: true }
  }
});

export const ITEM_PRICE_SCHEMA = Object.freeze({
  type: ["object", "null"],
  required: ["amount", "currency", "taxBasis"],
  additionalProperties: false,
  properties: {
    amount: { type: "string" },
    currency: { const: ITEM_PRICE_CURRENCY },
    taxBasis: { const: ITEM_PRICE_TAX_BASIS }
  }
});

export const ITEM_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "name",
    "shortName",
    "categoryId",
    "categoryName",
    "brandId",
    "brandName",
    "productType",
    "status",
    "skuCount",
    "version",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    shortName: { type: "string" },
    categoryId: { type: ["integer", "null"] },
    categoryName: { type: ["string", "null"] },
    brandId: { type: ["integer", "null"] },
    brandName: { type: ["string", "null"] },
    productType: { type: "string", enum: [...ITEM_PRODUCT_TYPES] },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    skuCount: { type: "integer", minimum: 0 },
    version: { type: "integer", minimum: 1 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

export const ITEM_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: ITEM_SUMMARY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});

const ITEM_DETAIL_SKU_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "skuCode", "skuName", "status", "suggestedRetailPrice", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    skuCode: { type: "string" },
    skuName: { type: "string" },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    suggestedRetailPrice: ITEM_PRICE_SCHEMA,
    version: { type: "integer", minimum: 1 }
  }
});

export const ITEM_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "name",
    "shortName",
    "description",
    "categoryId",
    "categoryName",
    "brandId",
    "brandName",
    "productType",
    "countryOfOrigin",
    "manufacturer",
    "defaultTrackingPolicy",
    "defaultShelfLifeDays",
    "status",
    "attributeValues",
    "skus",
    "version",
    "createdAt",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    shortName: { type: "string" },
    description: { type: ["string", "null"] },
    categoryId: { type: ["integer", "null"] },
    categoryName: { type: ["string", "null"] },
    brandId: { type: ["integer", "null"] },
    brandName: { type: ["string", "null"] },
    productType: { type: "string", enum: [...ITEM_PRODUCT_TYPES] },
    countryOfOrigin: { type: ["string", "null"] },
    manufacturer: { type: "string" },
    defaultTrackingPolicy: { type: "string" },
    defaultShelfLifeDays: { type: ["integer", "null"] },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    // Item attribute values：item_attribute_values 表要等 T23 先建立，現在
    // 固定回空陣列。
    attributeValues: { type: "array", items: {}, maxItems: 0 },
    skus: { type: "array", items: ITEM_DETAIL_SKU_SCHEMA },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "integer", minimum: 0 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

// --- POST /api/v1/items/create ---------------------------------------------
//
// T14 只做 Standard Item：schema 層面仍然開放 productType 兩個值（同一組
// ITEM_PRODUCT_TYPES enum，避免 T23 開放 Variant 時要重新加一個列舉值），但
// 唔接受 variantValues——送 "variant" 由 service 層拒絕（ITEM_VARIANT_NOT_
// SUPPORTED，見 ItemAdminService.createItem()），比 schema 層一個泛用嘅
// enum 錯誤更清楚。範圍決定見 docs/items_management/tasks.md 的 T14／T23
// 條目。

const MONEY_STRING_SCHEMA = Object.freeze({
  type: "string",
  pattern: decimalStringPattern(MONEY_DECIMAL).source
});

const ITEM_CREATE_ITEM_SCHEMA = Object.freeze({
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 190 },
    shortName: { type: "string", maxLength: 100, default: "" },
    description: { type: ["string", "null"], maxLength: 4000 },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 },
    productType: { type: "string", enum: [...ITEM_PRODUCT_TYPES], default: "standard" },
    countryOfOrigin: { type: "string", pattern: "^[A-Z]{2}$" },
    manufacturer: { type: "string", maxLength: 190, default: "" },
    defaultTrackingPolicy: { type: "string", enum: [...TRACKING_POLICIES], default: "none" },
    defaultShelfLifeDays: { type: "integer", minimum: 1 }
  }
});

const ITEM_CREATE_SKU_UOM_SCHEMA = Object.freeze({
  type: "object",
  required: ["uomId", "toBaseFactor"],
  additionalProperties: false,
  properties: {
    uomId: { type: "integer", minimum: 1 },
    toBaseFactor: { type: "integer", minimum: UOM_FACTOR_MIN, maximum: UOM_FACTOR_MAX },
    isBase: { type: "boolean", default: false },
    isDefaultPurchase: { type: "boolean", default: false },
    isDefaultSale: { type: "boolean", default: false }
  }
});

const ITEM_CREATE_SKU_BARCODE_SCHEMA = Object.freeze({
  type: "object",
  required: ["barcode", "barcodeType", "uomId"],
  additionalProperties: false,
  properties: {
    barcode: { type: "string", minLength: 1, maxLength: 190 },
    barcodeType: { type: "string", enum: [...BARCODE_TYPES] },
    // 呢個係 sku.uoms 入面某一列嘅 uomId（唔係 item_sku_uoms.id——嗰個要
    // SKU 建立咗先有），service 負責解析做真正嘅 sku_uom_id。
    uomId: { type: "integer", minimum: 1 },
    isPrimary: { type: "boolean", default: false }
  }
});

const ITEM_CREATE_SKU_SCHEMA = Object.freeze({
  type: "object",
  required: ["skuCode", "skuName"],
  additionalProperties: false,
  properties: {
    skuCode: { type: "string", minLength: 1, maxLength: 190 },
    skuName: { type: "string", minLength: 1, maxLength: 190 },
    // 冇送就用 item.defaultTrackingPolicy——由 service 決定，schema 呢度唔設
    // default，避免同「呼叫端明確送咗 none」分唔清。
    trackingPolicy: { type: "string", enum: [...TRACKING_POLICIES] },
    shelfLifeDays: { type: "integer", minimum: 1 },
    minReceiptLifeDays: { type: "integer", minimum: 0 },
    minSaleLifeDays: { type: "integer", minimum: 0 },
    purchasable: { type: "boolean", default: true },
    sellable: { type: "boolean", default: true },
    inventoryTracked: { type: "boolean", default: true },
    suggestedPriceAmount: MONEY_STRING_SCHEMA,
    effectiveFrom: { type: "integer", minimum: 0 },
    effectiveTo: { type: "integer", minimum: 0 },
    uoms: { type: "array", items: ITEM_CREATE_SKU_UOM_SCHEMA, default: [] },
    barcodes: { type: "array", items: ITEM_CREATE_SKU_BARCODE_SCHEMA, default: [] }
  }
});

export const ITEM_CREATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["item", "skus"],
  additionalProperties: false,
  properties: {
    item: ITEM_CREATE_ITEM_SCHEMA,
    // T14 只做 Standard：恰好一個 SKU 由 service 驗證（見上面說明），schema
    // 呢度唔設 maxItems，等 T23 開放 Variant 時唔使改呢一段。
    skus: { type: "array", items: ITEM_CREATE_SKU_SCHEMA, minItems: 1 },
    activate: { type: "boolean", default: false },
    // 淨係 activate: true 先必填，schema 冇辦法表達「條件式必填」而唔引入
    // if/then（呢個 codebase 未用過呢個 pattern），改由 service 檢查（見
    // ItemAdminService.createItem()）；呢度只驗證「如果有畀，長度啱唔啱」。
    activationReason: { type: "string", minLength: 5, maxLength: 190 }
  }
});

// --- POST /api/v1/items/:id/update ------------------------------------------
//
// 整組覆蓋，唔係 PATCH——同 catalogSchemas.js 嘅 update 系列同一個慣例
// （見 ItemCatalogService.updateCategory() 開頭嘅說明）。冇 `productType`：
// 呢期唔開放喺 Item 層面改變（理由見 ItemAdminService.updateItem()）；
// 冇 attribute values（T23）。

export const ITEM_UPDATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["name", "version"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 190 },
    shortName: { type: "string", maxLength: 100, default: "" },
    description: { type: ["string", "null"], maxLength: 4000 },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 },
    countryOfOrigin: { type: "string", pattern: "^[A-Z]{2}$" },
    manufacturer: { type: "string", maxLength: 190, default: "" },
    defaultTrackingPolicy: { type: "string", enum: [...TRACKING_POLICIES], default: "none" },
    defaultShelfLifeDays: { type: "integer", minimum: 1 },
    version: { type: "integer", minimum: 1 }
  }
});

// --- POST /api/v1/items/:id/{activate,deactivate,discontinue,archive,restore} ---
//
// 高風險（discontinue／archive／restore）動作的原因欄，跟 catalogSchemas.js
// 的 REASON_SCHEMA 同一條規則（5–190 字元），但獨立定義一份——理由同
// catalogSchemas.js 頂部註解：Item 與 Category 是不相關的業務領域，共用同一個
// schema 物件會讓其中一邊的欄寬變動意外波及另一邊。

export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

export const VERSION_SCHEMA = Object.freeze({
  type: "integer",
  minimum: 1
});

export const PASSWORD_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 1024
});

export const ITEM_ACTIVATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["skuIds", "reason", "version"],
  additionalProperties: false,
  properties: {
    skuIds: { type: "array", items: { type: "integer", minimum: 1 }, default: [] },
    reason: REASON_SCHEMA,
    version: VERSION_SCHEMA
  }
});

// --- POST /api/v1/items/:id/delete ------------------------------------------

export const ITEM_DELETE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }
  }
});

// --- POST /api/v1/items/:id/copy --------------------------------------------
//
// 只要求每個來源 SKU 一個新 Code，唔重複來源 Item 已有嘅其餘欄位——複製之後
// 開返 Draft 用一般 update 改名等，唔喺呢個 endpoint 一次過做晒。

export const ITEM_COPY_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["skus"],
  additionalProperties: false,
  properties: {
    skus: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["sourceSkuId", "skuCode"],
        additionalProperties: false,
        properties: {
          sourceSkuId: { type: "integer", minimum: 1 },
          skuCode: { type: "string", minLength: 1, maxLength: 190 }
        }
      }
    }
  }
});
