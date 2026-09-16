/**
 * Item／SKU media 端點共用的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.6。
 *
 * 上傳 body schema（`ITEM_MEDIA_UPLOAD_BODY_SCHEMA`）同時被
 * `handlers/items/itemMediaUploadHandler.js` 及 `handlers/skus/
 * skuMediaUploadHandler.js` 引用——同 REASON_SCHEMA／VERSION_SCHEMA 那種
 * 「同名但故意各自定義一份，避免 Item／SKU 兩個 handler 目錄互相耦合」不同，
 * media 上傳本來就是同一個 `item_media` 資料表、同一套驗證規則的同一個功能，
 * 只是掛在兩個不同的 URL 前綴，分開定義兩份反而是「規則之後各自漂移」的
 * 風險，所以在這裡集中定義一份，三個 handler（items／skus／item-media）
 * 共用。
 */
import { MEDIA_KINDS } from "../../modules/item/itemConstants.js";

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

/** 路徑上的 Media id。字串是因為 Express 的 req.params 一律是字串。 */
export const MEDIA_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

export const PASSWORD_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 1024
});

// Multipart 中間件把非檔案欄位一律當成字串放進 req.body（見
// src/framework/upload/uploadMiddleware.js），isPrimary／sortOrder／version
// 因此不能用一般的 boolean／integer schema——那樣只會讓每一次上傳都因為型別
// 不符而 400。這裡改用嚴格的字串樣式白名單（isPrimary 只接受完全等於
// "true"／"false"，不接受空字串或其他 truthy 字串），實際轉型在 handler 裡
// 明確做，呼應 design_spec.md §6.6 對這件事的要求。
const MULTIPART_BOOLEAN_STRING_SCHEMA = Object.freeze({ type: "string", enum: ["true", "false"] });
const MULTIPART_INTEGER_STRING_SCHEMA = Object.freeze({ type: "string", pattern: "^[0-9]{1,19}$" });

export const ITEM_MEDIA_UPLOAD_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["kind", "version"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: MEDIA_KINDS },
    isPrimary: MULTIPART_BOOLEAN_STRING_SCHEMA,
    sortOrder: MULTIPART_INTEGER_STRING_SCHEMA,
    version: MULTIPART_INTEGER_STRING_SCHEMA
  }
});

export const ITEM_MEDIA_UPDATE_BODY_SCHEMA = Object.freeze({
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    displayName: { type: "string", minLength: 1, maxLength: 255 },
    sortOrder: { type: "integer", minimum: 0 },
    isPrimary: { type: "boolean" }
  }
});

export const ITEM_MEDIA_DELETE_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "password"],
  additionalProperties: false,
  properties: {
    reason: REASON_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

export const MEDIA_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "itemId",
    "skuId",
    "mediaKind",
    "originalName",
    "mimeType",
    "byteSize",
    "isPrimary",
    "sortOrder",
    "createdAt"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer" },
    itemId: { type: "integer" },
    skuId: { type: ["integer", "null"] },
    mediaKind: { type: "string", enum: MEDIA_KINDS },
    originalName: { type: "string" },
    mimeType: { type: "string" },
    byteSize: { type: "integer" },
    isPrimary: { type: "boolean" },
    sortOrder: { type: "integer" },
    createdAt: { type: "integer" }
  }
});

export const ITEM_MEDIA_DELETE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "integer" }
  }
});
