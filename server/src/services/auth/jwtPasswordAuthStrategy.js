import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { JwtAuthStrategy } from "./jwtAuthStrategy.js";
import { AUTH_FAILURE, UserService } from "../../modules/user/UserService.js";

/**
 * JWT 加密碼再確認的認證策略。給那些光有一個有效 JWT 還不夠、還要求呼叫端
 * 當場再證明一次「知道目前的密碼」的高風險端點用——例如改密碼。跟
 * JwtDeviceAuthStrategy（見同目錄）是同一個模式的另一個實例：JWT 證明這是
 * 誰的 session，第二個因子證明這一刻仍然握有那個身份的憑證。
 *
 * 密碼從 request body 的 `password` 欄位讀，在 handler 的 schema 驗證之前——
 * 跟 JwtDeviceAuthStrategy 讀 X-Device-* header 是同一個理由：認證要先於
 * 「這個請求長什麼樣子對不對」的檢查。
 *
 * 密碼錯 / 帳號被鎖 / 帳號查無，統一收成一個 PASSWORD_INVALID：呼叫端雖然已經
 * 持有這個帳號的有效 JWT，但不該從回應差異分辨出「密碼錯」跟「已被鎖定」，
 * 這對一個拿著偷來的 token 的人是可以拿來校準策略的資訊。帳號被停用單獨給
 * USER_INACTIVE，跟 refreshTokenHandler 的 USER_INACTIVE 同一個理由：那對
 * 正常使用者是「找管理員」這種可行動的資訊，不是密碼猜測相關的洩漏。
 *
 * 繼承 JwtAuthStrategy 而不是重寫一份：JWT 驗證、撤銷檢查、快照熔斷完全一樣，
 * 複製一份只會讓兩份未來各自漂移。
 */
export class JwtPasswordAuthStrategy extends JwtAuthStrategy {
  static authType = "jwt-password";

  static service = Object.freeze({
    name: "auth.jwtPassword",
    lifecycle: "singleton",
    dependencies: ["jwt", "tokenRevocation", "mysqldatabase", "time", "logging"],
    eager: true
  });

  constructor({ config, services, options } = {}) {
    super({ config, services, options });
    // UserService 是業務模組，不經 service container——跟 loginHandler／
    // refreshTokenHandler 同一個理由，見 UserService.js 開頭的說明。
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async authenticate(req) {
    // JWT 無效、過期或已撤銷會在這裡直接拋出，密碼檢查完全不會跑。
    const base = await super.authenticate(req);
    const { claims } = base;

    const password = req.body?.password;

    if (typeof password !== "string" || password.length === 0) {
      throw new ApplicationError("Password confirmation is required", {
        code: "PASSWORD_REQUIRED",
        statusCode: 400,
        publicCode: "PASSWORD_REQUIRED",
        publicMessage: "Please confirm your current password"
      });
    }

    const result = await this.userService.verifyPasswordById(Number(claims.sub), password);

    if (!result.ok) {
      void this.logger?.warn?.(
        "auth.password.rejected",
        "Password re-authentication was rejected",
        {
          requestId: req.requestId || null,
          userId: Number(claims.sub),
          reason: result.reason
        }
      );

      if (result.reason === AUTH_FAILURE.DISABLED) {
        throw new ApplicationError("Account is disabled", {
          code: "USER_INACTIVE",
          statusCode: 401,
          publicCode: "Unauthorized Access",
          publicMessage: "Unauthorized Access"
        });
      }

      throw new ApplicationError(`Password re-authentication rejected: ${result.reason}`, {
        code: "PASSWORD_INVALID",
        statusCode: 401,
        publicCode: "PASSWORD_INVALID",
        publicMessage: "Please confirm your current password"
      });
    }

    return base;
  }
}
