/**
 * SKU 查詢端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.3、§6.10。
 */
import {
  BARCODE_TYPES,
  ITEM_LIST_SORT_FIELDS,
  ITEM_PRICE_CURRENCY,
  ITEM_PRICE_TAX_BASIS,
  ITEM_PRODUCT_TYPES,
  ITEM_STATUSES,
  TRACKING_POLICIES
} from "../../modules/item/itemConstants.js";

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
  required: ["id", "skuUomId", "barcode", "normalizedBarcode", "barcodeType", "isPrimary"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    skuUomId: { type: "integer", minimum: 1 },
    barcode: { type: "string" },
    normalizedBarcode: { type: "string" },
    barcodeType: { type: "string", enum: [...BARCODE_TYPES] },
    isPrimary: { type: "boolean" }
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
    // SKU attribute values：item_sku_attribute_values 表要等 T23 先建立，
    // 現在固定回空陣列。
    variantValues: { type: "array", items: {}, maxItems: 0 },
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
    // Media：item_media 表要等 T25 先建立，現在固定回空陣列。
    media: { type: "array", items: {}, maxItems: 0 },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "integer", minimum: 0 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});
