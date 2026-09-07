/**
 * Item audit 查詢端點的 schema 片段。設計說明見
 * docs/items_management/design_spec.md §6.7。
 */

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/** 只要 item.view，不像 user 那邊的 audit 有兩個權限任一都通——Item 稽核目前
 * 只有一種「看」的權限，沒有第二個管理權限可以替代它。 */
export const ITEM_AUDIT_LOG_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["item.view"]) })
  })
]);

/**
 * `ItemAuditLogService.record()` 呼叫端目前用到的全部 action 字串（見
 * ItemCatalogService.js）。design_spec.md §8.7 列出這個模組完整開發完成後的
 * 規劃清單（item.*／sku.*／attribute.*／media.*／import.* 等），但那些呼叫端
 * 現在都還不存在——寫一個沒有任何程式碼會用到的 enum 值，只會在真正實作那些
 * action 時才發現字串對不上。每個 Phase 加新的寫入路徑時，在這裡加對應的
 * action 字串（跟 user 那邊 AUDIT_ACTIONS 的慣例一致）。
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
  "item.create",
  "sku.create"
]);

/** target_type 同樣只列現在真的會寫入的種類；§5.12 規劃的完整清單見
 * 0024_create_item_audit_logs.js 開頭的欄位註解。 */
export const ITEM_AUDIT_TARGET_TYPES = Object.freeze(["category", "brand", "uom", "item", "sku"]);

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
