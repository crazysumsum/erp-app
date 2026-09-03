/**
 * 用戶管理端點共用的 schema 片段。設計說明見 docs/user_management/design_spec.md §3.1、§3.3。
 */

export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export const USER_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["user.mgmt"]) })
  })
]);

/** 路徑上的用戶 id。字串是因為 Express 的 req.params 一律是字串。 */
export const USER_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

/**
 * 高風險動作的原因欄。強制而不是選填——見 §3.1 的說明：日常維護多一個必填欄，
 * 換到的是三個月後回頭看那一列稽核時，「為什麼」不必靠猜。
 */
export const REASON_SCHEMA = Object.freeze({
  type: "string",
  minLength: 5,
  maxLength: 190
});

/**
 * username：3–190 字元，字元集限制在 URL、日誌與稽核裡都安全的範圍。
 * `trim: true` 係畀 RequestValidator 讀嘅標註（design_spec.md:310：「收進來先
 * trim()」）——喺 pattern 驗證之前去掉頭尾空白，唔係 AJV 自己嘅驗證行為。
 */
export const USERNAME_SCHEMA = Object.freeze({
  type: "string",
  minLength: 3,
  maxLength: 190,
  pattern: "^[A-Za-z0-9._-]{3,190}$",
  trim: true
});

export const DISPLAY_NAME_SCHEMA = Object.freeze({
  type: "string",
  maxLength: 190
});

/**
 * 新密碼欄：只設長度上限，不在 schema 裡塞大小寫的 pattern——AJV 對 pattern
 * 失敗只會說「不符合格式」，講不出差在哪。長度與字元組成的判斷交給
 * passwordPolicy.js，那裡的錯誤訊息才指名得出「差一個大寫字母」。
 */
export const NEW_PASSWORD_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 200
});

/** 角色 id 陣列：50 筆上限、不重複、元素是正整數；空陣列合法，null 不合法。 */
export const ROLE_IDS_SCHEMA = Object.freeze({
  type: "array",
  maxItems: 50,
  uniqueItems: true,
  items: { type: "integer", minimum: 1 }
});

export const USER_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "username", "displayName", "status", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    status: { type: "string", enum: ["active", "disabled"] },
    createdAt: { type: "integer", minimum: 0 }
  }
});

export const USER_DETAIL_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "username", "displayName", "status", "createdAt", "mustChangePassword", "roles"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    status: { type: "string", enum: ["active", "disabled"] },
    createdAt: { type: "integer", minimum: 0 },
    mustChangePassword: { type: "boolean" },
    roles: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name"],
        additionalProperties: false,
        properties: {
          id: { type: "integer", minimum: 1 },
          name: { type: "string" }
        }
      }
    }
  }
});

/**
 * 分頁清單的查詢慣例：page / pageSize / q / status / sortBy / descending。
 * 之後所有列表 API 照抄（§3.3）。`pageSize` 上限寫進 schema，不是靠 handler
 * 自己夾——超出就回 400，而不是安靜地只給你 20 筆。
 */
export const USER_LIST_QUERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    q: { type: "string", maxLength: 190, default: "" },
    status: { type: "string", enum: ["active", "disabled"] },
    sortBy: {
      type: "string",
      enum: ["username", "displayName", "status", "createdAt"],
      default: "username"
    },
    descending: { type: "boolean", default: false }
  }
});

export const USER_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items", "total", "page", "pageSize"],
  additionalProperties: false,
  properties: {
    items: { type: "array", items: USER_SUMMARY_SCHEMA },
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 }
  }
});

export function toUserSummaryResponse(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt
  };
}
