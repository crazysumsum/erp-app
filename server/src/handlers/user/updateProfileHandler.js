import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AuditLogService } from "../../modules/audit/AuditLogService.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/** 純聯絡資訊，可以留空——空字串代表未填，不是 NULL（見 UserService.js 的
 * #loadUser() 正規化）。 */
const EMAIL_SCHEMA = Object.freeze({
  type: "string",
  maxLength: 254,
  anyOf: [Object.freeze({ const: "" }), Object.freeze({ format: "email" })]
});

const DISPLAY_NAME_SCHEMA = Object.freeze({
  type: "string",
  maxLength: 190
});

const PROFILE_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "username", "displayName", "email"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    email: { type: "string" }
  }
});

/**
 * 使用者自己改自己的 `displayName`／`email`。設計說明見
 * docs/user_management/design_spec.md §4.5、「已確認的決定」表。
 *
 * 不要求密碼、不要求設備簽章：改的是聯絡資訊，不是憑證也不是別人的權限，跟
 * 改密碼（§3.4）、管理端點的高風險動作不同級別。`username` 不在這支端點的
 * body 裡——建立後不可改，理由與用戶管理頁的 `updateUserHandler.js` 相同。
 */
export class UpdateProfileHandler extends BaseRequestHandler {
  static handlerName = "updateProfile";

  static api = {
    method: "POST",
    path: "/api/v1/user/profile",
    description: "使用者自己改顯示名稱與 email。username 與角色都不在這支端點裡。",
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["displayName", "email"],
        additionalProperties: false,
        properties: {
          displayName: DISPLAY_NAME_SCHEMA,
          email: EMAIL_SCHEMA
        }
      }
    },
    responseSchema: { 200: PROFILE_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
    this.time = services.require("time");
    this.auditLog = new AuditLogService({
      database: this.database,
      logger: services.require("logging").logger,
      time: this.time
    });
  }

  async execute(req) {
    const userId = Number(req.auth.claims.sub);
    const { displayName, email } = req.input.body;

    return this.database.withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT username, display_name, email FROM users WHERE id = ?",
        [userId]
      );
      // 走到這裡代表 JWT 剛剛才驗證過這個 id 現在是 active 使用者
      // （jwtAuthStrategy 的自檢），這一列不可能不存在。
      const { username, display_name: beforeDisplayName, email: beforeEmail } = rows[0];

      const nowMs = this.time.nowMs();
      await connection.execute(
        "UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?",
        [displayName, email === "" ? null : email, nowMs, userId]
      );

      await this.auditLog.record(connection, {
        actorUserId: userId,
        actorUsername: username,
        action: "user.profile",
        targetType: "user",
        targetId: userId,
        targetLabel: username,
        detail: {
          displayName: { before: beforeDisplayName, after: displayName },
          email: { before: beforeEmail ?? "", after: email }
        },
        requestId: req.requestId,
        ip: req.ip || req.socket?.remoteAddress || ""
      });

      return this.response({
        id: userId,
        username,
        displayName,
        email
      });
    });
  }
}
