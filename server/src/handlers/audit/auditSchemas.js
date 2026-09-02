/**
 * 稽核查詢端點的 schema 片段。設計說明見 docs/user-management.md §3.1、§4.6。
 */

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/** user.mgmt 或 role.mgmt 都看得到——不另開 audit.view（§5.5）。 */
export const AUDIT_LOG_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({
      permissions: Object.freeze(["user.mgmt", "role.mgmt"]),
      match: "any"
    })
  })
]);

/** AuditLogService.record() 呼叫端目前用到的全部 action 字串（見各 *AdminService.js）。 */
export const AUDIT_ACTIONS = Object.freeze([
  "user.create",
  "user.update",
  "user.disable",
  "user.enable",
  "user.roles",
  "user.password.reset",
  "user.password.change",
  "role.create",
  "role.update",
  "role.delete",
  "role.permissions"
]);

/**
 * 查詢慣例：page / pageSize 沿用 §3.3；固定照 occurred_at DESC 排，不接受
 * sortBy——這是唯讀清單，不是靠頁碼記位置（§3.3 對這個取捨的說明）。
 * `from` / `to` 是 epoch 毫秒的時間範圍，`actor` / `target` 是對
 * actor_username / target_label 的 LIKE 搜尋。
 */
export const AUDIT_LOG_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    from: { type: "integer", minimum: 0 },
    to: { type: "integer", minimum: 0 },
    actor: { type: "string", maxLength: 190, default: "" },
    target: { type: "string", maxLength: 190, default: "" },
    action: { type: "string", enum: [...AUDIT_ACTIONS] }
  }
});

export const AUDIT_LOG_ENTRY_SCHEMA = Object.freeze({
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
    // 操作者的帳號日後若被硬刪除會變 NULL（見 0007 的 ON DELETE SET NULL）。
    actorUserId: { type: ["integer", "null"] },
    actorUsername: { type: "string" },
    action: { type: "string" },
    targetType: { type: "string" },
    targetId: { type: ["integer", "null"] },
    targetLabel: { type: "string" },
    reason: { type: "string" },
    // 形狀因 action 而異（見各 *AdminService.js 寫入時的 detail），前端自己判斷怎麼渲染。
    detail: { type: ["object", "null"] }
  }
});

export const AUDIT_LOG_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: AUDIT_LOG_ENTRY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});
