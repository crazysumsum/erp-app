import { JwtDeviceAuthStrategy } from "./jwtDeviceAuthStrategy.js";
import { assertPasswordConfirmed } from "./passwordReauth.js";
import { UserService } from "../../modules/user/UserService.js";

/**
 * JWT + 已核准設備的簽章 + 當下的密碼，三者齊備才放行。給能提權的端點用
 * （建立用戶、配角色、配權限、重設密碼——見 docs/user_management/design_spec.md §3.1）。
 *
 * 擋的是這件事：偷到 token 又偷到密碼（例如側錄），仍然提不了權，因為簽名
 * 要用的私鑰是 IndexedDB 裡的 non-extractable `CryptoKey`，XSS 帶不走它、
 * 離開那台機器就簽不出來。
 *
 * 繼承 JwtDeviceAuthStrategy 而不是重寫一份：JWT 驗證、撤銷檢查、快照熔斷、
 * 設備簽章驗證完全一樣，複製一份只會讓兩份未來各自漂移。密碼檢查本身在
 * passwordReauth.js，跟 JwtPasswordAuthStrategy 共用（見那個檔案開頭的說明）。
 *
 * 順序是先設備、後密碼：`super.authenticate()` 已經涵蓋 JWT 與設備簽章，設備
 * 簽章驗證（ECDSA）比密碼比對（scrypt）便宜得多，讓沒有合法設備簽章的請求先
 * 被便宜地擋掉，不必先花一次 scrypt 才發現設備不對。
 */
export class JwtDevicePasswordAuthStrategy extends JwtDeviceAuthStrategy {
  static authType = "jwt-device-password";

  static service = Object.freeze({
    name: "auth.jwtDevicePassword",
    lifecycle: "singleton",
    dependencies: ["jwt", "tokenRevocation", "deviceBinding", "mysqldatabase", "time", "logging"],
    eager: true
  });

  constructor({ config, services, options } = {}) {
    super({ config, services, options });
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async authenticate(req) {
    const base = await super.authenticate(req);

    await assertPasswordConfirmed(req, {
      userId: Number(base.claims.sub),
      userService: this.userService,
      logger: this.logger
    });

    return base;
  }
}
