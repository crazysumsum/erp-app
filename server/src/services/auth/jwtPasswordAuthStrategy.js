import { JwtAuthStrategy } from "./jwtAuthStrategy.js";
import { assertPasswordConfirmed } from "./passwordReauth.js";
import { UserService } from "../../modules/user/UserService.js";

/**
 * JWT 加密碼再確認的認證策略。給那些光有一個有效 JWT 還不夠、還要求呼叫端
 * 當場再證明一次「知道目前的密碼」的高風險端點用——例如改密碼。跟
 * JwtDeviceAuthStrategy／JwtDevicePasswordAuthStrategy（見同目錄）是同一個
 * 模式的另一個實例：JWT 證明這是誰的 session，第二個因子證明這一刻仍然握有
 * 那個身份的憑證。
 *
 * 密碼檢查本身（欄位驗證、錯誤碼、訊息）在 passwordReauth.js——
 * JwtDevicePasswordAuthStrategy 需要一模一樣的邏輯，抽出來共用，理由見那個
 * 檔案開頭的說明。
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

    await assertPasswordConfirmed(req, {
      userId: Number(base.claims.sub),
      userService: this.userService,
      logger: this.logger
    });

    return base;
  }
}
