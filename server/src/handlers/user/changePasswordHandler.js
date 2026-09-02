import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AuditLogService } from "../../modules/audit/AuditLogService.js";
import { hashPassword } from "../../modules/user/passwordHash.js";
import { assertPasswordChanged, assertPasswordStrength } from "../../modules/user/passwordPolicy.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/**
 * 使用者自己改密碼。設計說明見 docs/user_management/design_spec.md §3.4。
 *
 * `authType: "jwt-password"`：`password` 是舊密碼，被 JwtPasswordAuthStrategy
 * 在 schema 驗證之前讀走、拿去確認「現在仍然是本人」；`newPassword` 才是這支
 * handler 真正要處理的欄位。不叫 `currentPassword`——那會讓這支 API 與其他
 * jwt-password 端點的 body 形狀不一致，而 strategy 讀的欄位名是固定的。
 *
 * 這是 passwordChangeGate.js 豁免清單上的第一條：即使目前這個帳號的 token 帶
 * 著 mcp（必須改密碼），這支端點本身仍然打得通——否則使用者永遠沒有機會走完
 * 「被要求改密碼」這件事。
 */
export class ChangePasswordHandler extends BaseRequestHandler {
  static handlerName = "changePassword";

  static api = {
    method: "POST",
    path: "/api/v1/user/password/change",
    description: "使用者自己改密碼。成功後撤銷自己所有 token，需要重新登入。",
    authType: "jwt-password",
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["password", "newPassword"],
        additionalProperties: false,
        properties: {
          // jwt-password strategy 在 schema 驗證之前就讀走 password，這裡仍要
          // 宣告它：沒宣告的話 additionalProperties: false 會讓通過了 strategy
          // 的請求，反而在 schema 驗證這一步被擋下來。
          password: { type: "string", minLength: 1, maxLength: 1024 },
          newPassword: { type: "string", minLength: 1, maxLength: 200 }
        }
      }
    },
    responseSchema: {
      200: {
        type: "object",
        required: ["changed"],
        additionalProperties: false,
        properties: {
          changed: { type: "boolean" }
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
    this.time = services.require("time");
    this.tokenRevocation = services.require("tokenRevocation");
    this.auditLog = new AuditLogService({
      database: this.database,
      logger: services.require("logging").logger,
      time: this.time
    });
  }

  async execute(req) {
    const userId = Number(req.auth.claims.sub);
    const { newPassword } = req.input.body;

    assertPasswordStrength(newPassword);

    await this.database.withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT username, password_hash FROM users WHERE id = ?",
        [userId]
      );
      // 走到這裡代表 jwt-password strategy 剛剛才用同一個 id 驗證過現在的
      // 密碼，這一列不可能不存在——查不到就是資料庫本身出了問題，讓錯誤原樣
      // 往上拋，不特別處理。
      const { username, password_hash: currentHash } = rows[0];

      await assertPasswordChanged(newPassword, currentHash);

      const passwordHash = await hashPassword(newPassword);
      const nowMs = this.time.nowMs();

      await connection.execute(
        `UPDATE users
         SET password_hash = ?, must_change_password = 0, temporary_password_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`,
        [passwordHash, nowMs, userId]
      );

      await this.auditLog.record(connection, {
        actorUserId: userId,
        actorUsername: username,
        action: "user.password.change",
        targetType: "user",
        targetId: userId,
        targetLabel: username
      });
    });

    // 撤銷放在交易之外、資料庫寫入確認成功之後：撤銷是另一個系統（版本號快照）
    // 的狀態，把它塞進同一個交易換不到原子性，只會讓交易多背一個跟資料庫寫入
    // 無關的失敗來源。
    //
    // 舊密碼可能已經外洩，外洩者手上的 session 還活著；改密碼卻不把那條
    // session 殺掉，等於改了個寂寞。這裡撤銷的是自己，不像管理員重設密碼
    // 撤銷的是別人（§3.6）。
    await this.tokenRevocation.revoke(String(userId), { reason: "password_changed" });

    this.writeLog("info", "auth.password.changed", "User changed their own password", {
      requestId: req.requestId || null,
      userId
    });

    return this.response({ changed: true });
  }
}
