/**
 * Item audit 查詢端點的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.7。
 */

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/** Item 稽核可由純讀取或管理權限查閱；管理者不必額外取得 item.view。 */
export const ITEM_AUDIT_LOG_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.view", "item.mgmt"]), match: "any" })
  })
]);

/**
 * `ItemAuditLogService.record()` 目前實際寫入的所有 action 字串。查詢 allowlist
 * 必須與 producer 同步，否則使用者可以看見事件卻無法以該事件篩選。
 */
export const ITEM_AUDIT_ACTIONS = Object.freeze([
  "category.create",
  "category.update",
  "category.status",
  "category.delete",
  "brand.create",
  "brand.update",
  "brand.status",
  "brand.delete",
  "uom.create",
  "uom.update",
  "uom.status",
  "uom.delete",
  "attribute.create",
  "attribute.update",
  "attribute.status",
  "attribute.delete",
  "category.attributes.assign",
  "item.create",
  "item.update",
  "item.activate",
  "item.deactivate",
  "item.discontinue",
  "item.archive",
  "item.restore",
  "item.delete",
  "item.copy",
  "sku.create",
  "sku.update",
  "sku.activate",
  "sku.deactivate",
  "sku.discontinue",
  "sku.archive",
  "sku.restore",
  "sku.delete",
  "sku.code.change",
  "barcode.release",
  "media.upload",
  "media.update",
  "media.delete",
  "item.import",
  "item.export"
]);

/** target_type 同樣只列目前 producer 真的會寫入的種類。 */
export const ITEM_AUDIT_TARGET_TYPES = Object.freeze([
  "category",
  "brand",
  "uom",
  "attribute",
  "item",
  "sku",
  "media",
  "import",
  "export"
]);

/**
 * 查詢慣例：page／pageSize 沿用 user audit 的做法；固定照
 * occurred_at DESC, id DESC 排，不接受 sortBy——這是唯讀清單，不是靠頁碼記
 * 位置。`from`／`to` 是 epoch 毫秒的時間範圍，`actor`／`target` 是對
 * actor_username／target_label 的 LIKE 搜尋，`targetType` 是精確比對。
 */
export const ITEM_AUDIT_LOG_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    from: { type: "integer", minimum: 0 },
    to: { type: "integer", minimum: 0 },
    actor: { type: "string", maxLength: 190, default: "" },
    target: { type: "string", maxLength: 190, default: "" },
    action: { type: "string", enum: [...ITEM_AUDIT_ACTIONS] },
    targetType: { type: "string", enum: [...ITEM_AUDIT_TARGET_TYPES] }
  }
});

export const ITEM_AUDIT_LOG_ENTRY_SCHEMA = Object.freeze({
  type: "object",
  required: [
    "id",
    "occurredAt",
    "actorUserId",
    "actorUsername",
    "action",
    "targetType",
    "targetId",
    "targetLabel",
    "reason",
    "detail"
  ],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    occurredAt: { type: "integer", minimum: 0 },
    // 操作者的帳號日後若被硬刪除會變 NULL（見 0024 的 ON DELETE SET NULL）。
    actorUserId: { type: ["integer", "null"] },
    actorUsername: { type: "string" },
    action: { type: "string" },
    targetType: { type: "string" },
    targetId: { type: ["integer", "null"] },
    targetLabel: { type: "string" },
    reason: { type: "string" },
    // 形狀因 action 而異，前端自己判斷怎麼渲染。
    detail: { type: ["object", "null"] }
  }
});

export const ITEM_AUDIT_LOG_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: ITEM_AUDIT_LOG_ENTRY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});
