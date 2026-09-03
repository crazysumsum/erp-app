/**
 * 角色與權限管理端點共用的 schema 片段。設計說明見 docs/user_management/design_spec.md §3.1。
 */

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export const ROLE_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["role.mgmt"]) })
  })
]);

/**
 * 只用喺 GET /api/v1/roles：user.mgmt 或 role.mgmt 都睇得到（match: "any"），
 * 同 AUDIT_LOG_POLICY 嗰個判斷一樣——UsersPage 指派角色畀用戶嗰個對話框要靠
 * 呢支 API 畫勾選清單，而指派角色本身淨係要 user.mgmt（見
 * assignUserRolesHandler.js 嘅 USER_MGMT_POLICY）。呢個唔影響 create／
 * update／delete／permissions assign 呢幾支寫入端點——嗰幾支繼續用返
 * ROLE_MGMT_POLICY，淨係 role.mgmt 先入得。
 */
export const ROLE_LIST_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({
      permissions: Object.freeze(["user.mgmt", "role.mgmt"]),
      match: "any"
    })
  })
]);

/** 路徑上的角色 id。字串是因為 Express 的 req.params 一律是字串。 */
export const ROLE_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

/** 高風險動作的原因欄，與用戶管理那邊同一條規則（§3.1）。 */
export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

/** 與 roles.name 的欄寬一致（見 0003_add_auth_tables.js）。 */
export const ROLE_NAME_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 190
});

/** 與 roles.description 的欄寬一致。 */
export const ROLE_DESCRIPTION_SCHEMA = Object.freeze({
  type: "string",
  maxLength: 255
});

/** 權限 id 陣列：與用戶管理的 ROLE_IDS_SCHEMA 同一組限制（§3.1）。 */
export const PERMISSION_IDS_SCHEMA = Object.freeze({
  type: "array",
  maxItems: 50,
  uniqueItems: true,
  items: { type: "integer", minimum: 1 }
});

export const ROLE_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "name", "description", "userCount", "permissions"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    description: { type: "string" },
    userCount: { type: "integer", minimum: 0 },
    permissions: { type: "array", items: { type: "string" } }
  }
});

/** create／update 的回應：只有角色自己的欄位，不含權限（那是另一支端點的事）。 */
export const ROLE_DETAIL_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "name", "description"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    description: { type: "string" }
  }
});

export const ROLE_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: ROLE_SUMMARY_SCHEMA }
  }
});

export const PERMISSION_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "name", "description"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string" },
    description: { type: "string" }
  }
});

export const PERMISSION_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: PERMISSION_SCHEMA }
  }
});
