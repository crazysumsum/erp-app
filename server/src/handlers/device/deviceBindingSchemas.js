export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/**
 * 審批這個功能的權限。migration 0004 種入，0005 改名為 device.mgmt，掛在
 * system-admin 角色上。
 *
 * 核准、拒絕、撤銷與審批佇列共用同一個權限——名字用 mgmt 而不是 approve，
 * 就是為了讓字串與這個事實相符。
 */
export const DEVICE_MGMT_POLICY = Object.freeze([
  Object.freeze({
    name: "hasPermission",
    options: Object.freeze({ permissions: Object.freeze(["device.mgmt"]) })
  })
]);

/** 路徑上的綁定 id。字串是因為 Express 的 req.params 一律是字串。 */
export const BINDING_ID_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

/**
 * 審批動作的 body：一句可選的備註，會寫進 review_note 供日後稽核，加上密碼
 * 再確認——approve / reject / revoke 全部走 `authType: "jwt-password"`
 * （見 reviewDeviceHandlers.js），password 是那個 strategy 在 schema
 * 驗證之前就讀走的欄位。這裡仍然要宣告它：沒宣告的話 additionalProperties:
 * false 會讓通過了 strategy 的請求，反而在 schema 驗證這一步被擋下來。
 */
export const REVIEW_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["password"],
  additionalProperties: false,
  properties: {
    password: { type: "string", minLength: 1 },
    note: { type: "string", maxLength: 190 }
  }
});

/**
 * 審批佇列裡的一筆申請。
 *
 * **沒有 public_key**：審批者看不懂它，而它是驗簽用的資料，沒有理由出現在一個
 * 給人看的清單裡。additionalProperties: false 是這個保證的實作——handler 多回
 * 一個欄位會被回應驗證擋下，而不是安靜地送出去。
 */
export const PENDING_BINDING_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "userId", "username", "deviceId", "label", "requestedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    userId: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    // 完整的 thumbprint 對人沒有用，但前端要拿它來顯示前幾個字元供對認。
    deviceId: { type: "string" },
    label: { type: "string" },
    requestedAt: { type: "integer" },
    requestedIp: { type: "string" },
    requestedUserAgent: { type: "string" }
  }
});

/** 使用者自己的設備。比審批佇列少了「是誰」，多了狀態與最後使用時間。 */
export const MY_DEVICE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "deviceId", "label", "status", "requestedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    deviceId: { type: "string" },
    label: { type: "string" },
    status: { type: "string" },
    requestedAt: { type: "integer" },
    requestedIp: { type: "string" },
    requestedUserAgent: { type: "string" },
    reviewedAt: { type: ["integer", "null"] },
    lastUsedAt: { type: ["integer", "null"] }
  }
});

/** 審批動作的回應。 */
export const REVIEW_RESULT_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "status"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    status: { type: "string" }
  }
});

const asNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

export function toPendingBinding(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    username: row.username,
    displayName: row.display_name ?? "",
    deviceId: row.device_id,
    label: row.label ?? "",
    requestedAt: Number(row.requested_at),
    requestedIp: row.requested_ip ?? "",
    requestedUserAgent: row.requested_ua ?? ""
  };
}

export function toMyDevice(row) {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    label: row.label ?? "",
    status: row.status,
    requestedAt: Number(row.requested_at),
    requestedIp: row.requested_ip ?? "",
    requestedUserAgent: row.requested_ua ?? "",
    reviewedAt: asNumberOrNull(row.reviewed_at),
    lastUsedAt: asNumberOrNull(row.last_used_at)
  };
}
