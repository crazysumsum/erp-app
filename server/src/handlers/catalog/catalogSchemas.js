/**
 * Catalog（Category／Brand／UOM／Attribute）端點共用的 schema 片段。設計說明
 * 見 docs/items_management/design_spec.md §6.4。
 */

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

/** 路徑上的 catalog id。字串是因為 Express 的 req.params 一律是字串。 */
export const CATALOG_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

/**
 * 高風險（狀態變更／刪除）動作的原因欄。設計書 §6.4：「所有 catalog 狀態及
 * delete command 均帶 reason、version」——跟角色管理那組高風險端點的
 * REASON_SCHEMA 同一條規則（5–190 字元），但這裡獨立定義一份：目錄不共用，
 * 是因為兩邊分別代表 Item 與 User 兩個不相關的業務領域，共用同一個 schema
 * 物件會讓其中一邊的欄寬變動意外波及另一邊。
 */
export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

/** Optimistic lock 版本號，所有更新／狀態／刪除 command 都要帶。 */
export const VERSION_SCHEMA = Object.freeze({
  type: "integer",
  minimum: 1
});

/** 高風險端點的密碼欄，供 jwt-password strategy 讀取。 */
export const PASSWORD_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 1024
});

/** 與 item_categories.name／item_brands.name 的欄寬一致。 */
export const CATALOG_NAME_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 190
});

/** 分類的父層 id；null 表示根層級。 */
export const CATEGORY_PARENT_ID_SCHEMA = Object.freeze({
  type: ["integer", "null"],
  minimum: 1
});

/** 同層排序值，範圍留夠大但不是無界，避免任意大數字撐大索引。 */
export const SORT_ORDER_SCHEMA = Object.freeze({
  type: "integer",
  minimum: 0,
  maximum: 100000
});

const CATEGORY_FIELDS = Object.freeze({
  id: { type: "integer", minimum: 1 },
  name: CATALOG_NAME_SCHEMA,
  status: { type: "string", enum: ["active", "inactive", "archived"] },
  parentId: CATEGORY_PARENT_ID_SCHEMA,
  sortOrder: SORT_ORDER_SCHEMA,
  version: { type: "integer", minimum: 1 },
  createdAt: { type: "integer", minimum: 0 },
  updatedAt: { type: "integer", minimum: 0 }
});

export const CATEGORY_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "name",
    "status",
    "parentId",
    "sortOrder",
    "version",
    "createdAt",
    "updatedAt"
  ],
  additionalProperties: false,
  properties: CATEGORY_FIELDS
});

/**
 * 樹狀節點：跟 CATEGORY_SUMMARY_SCHEMA 同一組欄位，多一個 `children`。用
 * `$defs` + `$ref: "#/$defs/categoryTreeNode"` 讓 Ajv 認得任意層數的遞迴結構
 * ——分類樹深度上限是設定值（預設 8），不是這個 schema 該寫死的數字。
 */
export const CATEGORY_TREE_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items"],
  additionalProperties: false,
  $defs: {
    categoryTreeNode: {
      type: "object",
      required: [
        "id",
        "name",
        "status",
        "parentId",
        "sortOrder",
        "version",
        "createdAt",
        "updatedAt",
        "children"
      ],
      additionalProperties: false,
      properties: {
        ...CATEGORY_FIELDS,
        children: {
          type: "array",
          items: { $ref: "#/$defs/categoryTreeNode" }
        }
      }
    }
  },
  properties: {
    items: {
      type: "array",
      items: { $ref: "#/$defs/categoryTreeNode" }
    }
  }
});

export const CATEGORY_DELETE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 }
  }
});
