/**
 * SKU 查詢／更新端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.3、§6.9、§6.10。
 */
import {
  BARCODE_TYPES,
  ITEM_LIST_SORT_FIELDS,
  ITEM_PRICE_CURRENCY,
  ITEM_PRICE_TAX_BASIS,
  ITEM_PRODUCT_TYPES,
  ITEM_STATUSES,
  MONEY_DECIMAL,
  TRACKING_POLICIES,
  UOM_FACTOR_MAX,
  UOM_FACTOR_MIN
} from "../../modules/item/itemConstants.js";
import { decimalStringPattern } from "../../modules/item/itemValidation.js";
import { MEDIA_SUMMARY_SCHEMA } from "../item-media/itemMediaSchemas.js";
import { VARIANT_VALUE_PROJECTION_SCHEMA } from "../items/itemAttributeResponseSchemas.js";

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export const ITEM_VIEW_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.view", "item.mgmt"]), match: "any" })
  })
]);

export const ITEM_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.mgmt"]) })
  })
]);

/** 路徑上的 SKU id。字串是因為 Express 的 req.params 一律是字串。 */
export const SKU_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

export const SKU_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    q: { type: "string", maxLength: 190, default: "" },
    itemId: { type: "integer", minimum: 1 },
    categoryId: { type: "integer", minimum: 1 },
    brandId: { type: "integer", minimum: 1 },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    // 冇明確指定 status 先套呢個預設：Archived 預設不在日常列表顯示
    // （FR-DELETE-005），明確 status=archived 不受這個預設影響。
    includeArchived: { type: "boolean", default: false },
    purchasable: { type: "boolean" },
    sellable: { type: "boolean" },
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

export const SKU_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "skuCode",
    "skuName",
    "itemId",
    "itemName",
    "categoryId",
    "categoryName",
    "brandId",
    "brandName",
    "status",
    "primaryBarcode",
    "baseUomCode",
    "suggestedRetailPrice",
    "purchasable",
    "sellable",
    "version",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    skuCode: { type: "string" },
    skuName: { type: "string" },
    itemId: { type: "integer", minimum: 1 },
    itemName: { type: "string" },
    categoryId: { type: ["integer", "null"] },
    categoryName: { type: ["string", "null"] },
    brandId: { type: ["integer", "null"] },
    brandName: { type: ["string", "null"] },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    primaryBarcode: { type: ["string", "null"] },
    baseUomCode: { type: ["string", "null"] },
    suggestedRetailPrice: ITEM_PRICE_SCHEMA,
    purchasable: { type: "boolean" },
    sellable: { type: "boolean" },
    version: { type: "integer", minimum: 1 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

export const SKU_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: SKU_SUMMARY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});

const SKU_DETAIL_ITEM_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "name", "status", "productType", "categoryId", "categoryName", "brandId", "brandName"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    productType: { type: "string", enum: [...ITEM_PRODUCT_TYPES] },
    categoryId: { type: ["integer", "null"] },
    categoryName: { type: ["string", "null"] },
    brandId: { type: ["integer", "null"] },
    brandName: { type: ["string", "null"] }
  }
});

const SKU_DETAIL_UOM_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "uomId", "uomCode", "uomName", "toBaseFactor", "isBase", "isDefaultPurchase", "isDefaultSale"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    uomId: { type: "integer", minimum: 1 },
    uomCode: { type: "string" },
    uomName: { type: "string" },
    toBaseFactor: { type: "integer", minimum: 1 },
    isBase: { type: "boolean" },
    isDefaultPurchase: { type: "boolean" },
    isDefaultSale: { type: "boolean" }
  }
});

const SKU_DETAIL_BARCODE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "skuUomId", "barcode", "normalizedBarcode", "barcodeType", "isPrimary", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    skuUomId: { type: "integer", minimum: 1 },
    barcode: { type: "string" },
    normalizedBarcode: { type: "string" },
    barcodeType: { type: "string", enum: [...BARCODE_TYPES] },
    isPrimary: { type: "boolean" },
    // 每個條碼自己嘅 optimistic lock version（同 SKU 個 version 分開）——
    // POST /skus/:id/barcodes/:barcodeId/release 用呢個做 compare-and-set。
    version: { type: "integer", minimum: 1 }
  }
});

export const SKU_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "skuCode",
    "skuName",
    "item",
    "variantSignature",
    "variantValues",
    "netContent",
    "netContentUomId",
    "weight",
    "weightUomId",
    "length",
    "width",
    "height",
    "dimensionUomId",
    "trackingPolicy",
    "shelfLifeDays",
    "minReceiptLifeDays",
    "minSaleLifeDays",
    "purchasable",
    "sellable",
    "inventoryTracked",
    "suggestedRetailPrice",
    "effectiveFrom",
    "effectiveTo",
    "status",
    "uoms",
    "barcodes",
    "media",
    "version",
    "createdAt",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    skuCode: { type: "string" },
    skuName: { type: "string" },
    item: SKU_DETAIL_ITEM_SCHEMA,
    variantSignature: { type: ["string", "null"] },
    variantValues: { type: "array", items: VARIANT_VALUE_PROJECTION_SCHEMA },
    netContent: { type: ["string", "null"] },
    netContentUomId: { type: ["integer", "null"] },
    weight: { type: ["string", "null"] },
    weightUomId: { type: ["integer", "null"] },
    length: { type: ["string", "null"] },
    width: { type: ["string", "null"] },
    height: { type: ["string", "null"] },
    dimensionUomId: { type: ["integer", "null"] },
    trackingPolicy: { type: "string", enum: [...TRACKING_POLICIES] },
    shelfLifeDays: { type: ["integer", "null"] },
    minReceiptLifeDays: { type: ["integer", "null"] },
    minSaleLifeDays: { type: ["integer", "null"] },
    purchasable: { type: "boolean" },
    sellable: { type: "boolean" },
    inventoryTracked: { type: "boolean" },
    suggestedRetailPrice: ITEM_PRICE_SCHEMA,
    effectiveFrom: { type: ["integer", "null"] },
    effectiveTo: { type: ["integer", "null"] },
    status: { type: "string", enum: [...ITEM_STATUSES] },
    uoms: { type: "array", items: SKU_DETAIL_UOM_SCHEMA },
    barcodes: { type: "array", items: SKU_DETAIL_BARCODE_SCHEMA },
    // SKU 專屬 media（唔包括 Item 層級共用 media，嗰啲喺 Item detail 出現）。
    media: { type: "array", items: MEDIA_SUMMARY_SCHEMA },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "integer", minimum: 0 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

// --- POST /api/v1/skus/:id/update -------------------------------------------
//
// 整組覆蓋，冚 UOM／barcode 完整集合，唔係 PATCH（design_spec §6.3 前言：
// 「由 SKU update 將使用者讀到的完整集合連同 version 一次提交，避免多支
// 請求只成功一半」）。冇 `skuCode`：readonly，特批修改係獨立、未建嘅高
// 強度端點；冇 `variantValues`（T23）。

const MONEY_STRING_SCHEMA = Object.freeze({
  type: "string",
  pattern: decimalStringPattern(MONEY_DECIMAL).source
});

const SKU_UPDATE_UOM_SCHEMA = Object.freeze({
  type: "object",
  required: ["uomId", "toBaseFactor"],
  additionalProperties: false,
  properties: {
    // 有 id 代表覆蓋現有嗰行（一定要屬於呢個 SKU，唔係就 SKU_CHILD_MISMATCH）；
    // 冇 id 代表新增。id 本身唔保證跨次更新維持穩定——見
    // ItemAdminService.updateSku() 嘅說明。
    id: { type: "integer", minimum: 1 },
    uomId: { type: "integer", minimum: 1 },
    toBaseFactor: { type: "integer", minimum: UOM_FACTOR_MIN, maximum: UOM_FACTOR_MAX },
    isBase: { type: "boolean", default: false },
    isDefaultPurchase: { type: "boolean", default: false },
    isDefaultSale: { type: "boolean", default: false }
  }
});

const SKU_UPDATE_BARCODE_SCHEMA = Object.freeze({
  type: "object",
  required: ["barcode", "barcodeType", "uomId"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    barcode: { type: "string", minLength: 1, maxLength: 190 },
    barcodeType: { type: "string", enum: [...BARCODE_TYPES] },
    // 呢個係 uoms 入面某一列嘅 uomId（唔係 item_sku_uoms.id），service 負責
    // 解析做真正嘅 sku_uom_id——同 createItem() 同一個做法。
    uomId: { type: "integer", minimum: 1 },
    isPrimary: { type: "boolean", default: false }
  }
});

// --- POST /api/v1/skus/create ---------------------------------------------
//
// 新增 SKU 與 Item 初建內的 SKU 使用相同欄位語意，但此 route 的 body 是
// 頂層 SKU 欄位加 `itemId`（跟 SKU update 一致），不另包一層 `sku`。

const SKU_CREATE_UOM_SCHEMA = Object.freeze({
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

const SKU_CREATE_BARCODE_SCHEMA = Object.freeze({
  type: "object",
  required: ["barcode", "barcodeType", "uomId"],
  additionalProperties: false,
  properties: {
    barcode: { type: "string", minLength: 1, maxLength: 190 },
    barcodeType: { type: "string", enum: [...BARCODE_TYPES] },
    uomId: { type: "integer", minimum: 1 },
    isPrimary: { type: "boolean", default: false }
  }
});

const SKU_CREATE_VARIANT_VALUE_SCHEMA = Object.freeze({
  type: "object",
  required: ["attributeId", "optionId"],
  additionalProperties: false,
  properties: {
    attributeId: { type: "integer", minimum: 1 },
    optionId: { type: "integer", minimum: 1 }
  }
});

export const SKU_CREATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["itemId", "skuCode", "skuName"],
  additionalProperties: false,
  properties: {
    itemId: { type: "integer", minimum: 1 },
    // Code 的 trim／控制字元／長度規則由 ItemAdminService 集中處理，確保
    // 所有建 SKU 路徑都回同一個 SKU_CODE_INVALID 合約。
    skuCode: { type: "string" },
    skuName: { type: "string", minLength: 1, maxLength: 190, pattern: ".*\\S.*" },
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
    uoms: { type: "array", items: SKU_CREATE_UOM_SCHEMA, default: [] },
    barcodes: { type: "array", items: SKU_CREATE_BARCODE_SCHEMA, default: [] },
    variantValues: { type: "array", items: SKU_CREATE_VARIANT_VALUE_SCHEMA, default: [] }
  }
});

export const SKU_UPDATE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["skuName", "version"],
  additionalProperties: false,
  properties: {
    skuName: { type: "string", minLength: 1, maxLength: 190 },
    trackingPolicy: { type: "string", enum: [...TRACKING_POLICIES], default: "none" },
    shelfLifeDays: { type: "integer", minimum: 1 },
    minReceiptLifeDays: { type: "integer", minimum: 0 },
    minSaleLifeDays: { type: "integer", minimum: 0 },
    purchasable: { type: "boolean", default: true },
    sellable: { type: "boolean", default: true },
    inventoryTracked: { type: "boolean", default: true },
    suggestedPriceAmount: MONEY_STRING_SCHEMA,
    effectiveFrom: { type: "integer", minimum: 0 },
    effectiveTo: { type: "integer", minimum: 0 },
    uoms: { type: "array", items: SKU_UPDATE_UOM_SCHEMA, default: [] },
    barcodes: { type: "array", items: SKU_UPDATE_BARCODE_SCHEMA, default: [] },
    // 淨係「關鍵變更」（Base UOM／換算係數／追蹤政策）先必填，schema 呢度
    // 唔設 if/then（同 itemSchemas.js 嘅 activationReason 同一個理由），
    // 改由 service 檢查（ItemAdminService.updateSku()）。
    reason: { type: "string", minLength: 5, maxLength: 190 },
    version: { type: "integer", minimum: 1 }
  }
});

// --- POST /api/v1/skus/:id/{activate,deactivate,discontinue,archive,restore} ---
//
// 獨立定義一份，理由同 itemSchemas.js 對應的段落：SKU 與 Item 分屬不同 handler
// 目錄，冇跨目錄共用 schema 常數嘅慣例（同 catalogSchemas.js／itemSchemas.js
// 唔共用 REASON_SCHEMA 一樣）。

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

// --- POST /api/v1/skus/:id/delete -------------------------------------------

export const SKU_DELETE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }
  }
});

// --- POST /api/v1/skus/:id/code/change --------------------------------------

export const SKU_CODE_CHANGE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["skuCode", "reason", "version", "password"],
  additionalProperties: false,
  properties: {
    // 同 create／copy 一樣交由 ItemAdminService 回傳 SKU_CODE_INVALID。
    skuCode: { type: "string" },
    reason: REASON_SCHEMA,
    version: VERSION_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

// --- POST /api/v1/skus/:id/barcodes/:barcodeId/release ----------------------

export const SKU_BARCODE_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "barcodeId"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    barcodeId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

export const BARCODE_RELEASE_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "version", "password"],
  additionalProperties: false,
  properties: {
    reason: REASON_SCHEMA,
    version: VERSION_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});
