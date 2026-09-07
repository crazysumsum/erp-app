/**
 * Item 查詢端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.2、§6.10。
 */
import { ITEM_LIST_SORT_FIELDS, ITEM_PRODUCT_TYPES, ITEM_PRICE_CURRENCY, ITEM_PRICE_TAX_BASIS, ITEM_STATUSES } from "../../modules/item/itemConstants.js";

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
