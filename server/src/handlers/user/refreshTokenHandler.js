import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { USER_SCHEMA } from "./loginHandler.js";
import { UserService } from "../../modules/user/UserService.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/**
 * 換一個新的 JWT，讓正在使用系統的人不會在 token 到期那一刻被踢出去。
 * 設計說明見 docs/device-binding-auth.md。
 *
 * authType 是 "jwt-device"（見 JwtDeviceAuthStrategy），不是預設的 "jwt"——
 * 這一點是承重的：
 *
 *   1. JWT 驗證、撤銷檢查、快照熔斷的 503，加上「這個簽章是不是這個 token
 *      綁定的那台設備發出的」，全部在進到這支 handler 之前就做完了。
 *   2. **過期的 JWT 一樣在進到這支 handler 之前就被擋成 401。** 那正是我們
 *      要的行為：過期即強制登出，不給寬限。改成 "public" 的話，這裡會變成
 *      一個可以用任意過期 token 換新 token 的端點。
 *
 * 而「還沒過期就能換新的」也不等於 token 可以無限自我延長：換發要求一份設備
 * 私鑰的簽章，所以被偷走的 JWT 自己換不到新的。這是整個設備綁定方案存在的
 * 理由——沒有它，續期端點就是一台把短命 token 變成永久憑證的機器。
 */
export class RefreshTokenHandler extends BaseRequestHandler {
  static handlerName = "refreshToken";

  static api = {
    method: "POST",
    path: "/api/v1/user/token/refresh",
    description: "以目前有效的 JWT 加設備簽章換發一個新的 JWT。",
    authType: "jwt-device",
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: {
      200: {
        type: "object",
        required: [
          "token",
          "tokenType",
          "expiresIn",
          "expiresInSeconds",
          "sessionExpiresInSeconds",
          "user"
        ],
        additionalProperties: false,
        properties: {
          token: { type: "string" },
          tokenType: { type: "string" },
          expiresIn: { type: "string" },
          expiresInSeconds: { type: "integer", minimum: 1 },
          // 這條 session 還剩多久到絕對上限。這裡回的是**剩餘**而不是滿值——
          // 每次續期都回滿值的話，前端會永遠以為還有八小時，那個提醒就永遠
          // 不會出現，而這個欄位存在的唯一理由就是那個提醒。
          //
          // minimum 是 0 不是 1：strategy 用的是「超過才擋」，所以剛好踩在
          // 上限那一刻續期是會過的，那時剩餘正好是 0。
          sessionExpiresInSeconds: { type: "integer", minimum: 0 },
          user: USER_SCHEMA
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.time = services.require("time");
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: this.time
    });
    this.jwt = services.require("jwt");
    this.tokenRevocation = services.require("tokenRevocation");
    this.deviceBinding = services.require("deviceBinding");
  }

  async execute(req) {
    // JwtDeviceAuthStrategy 已經確認過 claims、簽章與這筆綁定的關係——這裡
    // 只管「這次換發要不要真的發生」，不重驗身份。
    const { claims, deviceBinding: binding } = req.auth;
    const subject = String(claims.sub);

    // 重讀資料庫而不是把舊 claims 抄過去。findActiveById 只回傳 status 為
    // active 的人，所以停用的帳號在這裡就換不到新 token 了。
    //
    // 這一步是「沒有絕對 session 上限」的代價換來的東西：session 不會自己過期，
    // 所以停用帳號必須有一條會自己生效的路。少了它，HR 把離職員工設成 disabled
    // 之後，UserService.authenticate() 只擋得住**新登入**——那個人已經開著的
    // session 會一直續期下去，永遠不死。
    const user = await this.userService.findActiveById(Number(subject));

    if (!user) {
      throw new ApplicationError("Authenticated user no longer exists or is disabled", {
        code: "USER_INACTIVE",
        statusCode: 401,
        publicCode: "Unauthorized Access",
        publicMessage: "Unauthorized Access"
      });
    }

    // 版本號要從資料庫讀當下的值，不能用撤銷快照——快照可以落後，用它簽出來的
    // token 會在下一次刷新時被自己的實例判成已撤銷。見 currentVersion() 的註解。
    const version = await this.tokenRevocation.currentVersion(subject);

    // 這個 token 簽發當下的版本號，必須跟現在讀到的完全一樣。不相等代表版本號
    // 在 JwtDeviceAuthStrategy 讀到「approved」之後、這一行之前被推高了——可能
    // 是這個使用者登出、密碼被改，或者正是這台裝置在這次續期途中被撤銷。不管
    // 哪一種，繼續簽下去都是把一次已經追不上的舊快照，複寫成一個蓋著最新版本
    // 號、從此對這次撤銷免疫的新 token，讓一個已經被撤銷的 session 復活。
    //
    // 這裡不需要重新查一次設備狀態：版本號本身就是那個判準，而且比較就在讀到
    // 版本號的下一行，中間沒有任何 await，不會再開新的競態窗口。
    if (claims.ver !== version) {
      this.writeLog("warn", "auth.token.version_stale", "Refresh token version no longer matches", {
        requestId: req.requestId || null,
        userId: Number(subject),
        deviceId: binding.device_id,
        tokenVersion: claims.ver ?? null,
        currentVersion: version
      });
      throw new ApplicationError("Token was issued under a version that no longer exists", {
        code: "TOKEN_VERSION_STALE",
        statusCode: 401,
        publicCode: "Unauthorized Access",
        publicMessage: "Unauthorized Access"
      });
    }

    // roles 與 permissions 取自剛剛重讀的那一份，所以權限變更會在一次續期
    // （最多 15 分鐘）內生效，不必等到 token 過期或被撤銷。這是白賺的。
    const token = this.jwt.issue(
      { roles: user.roles, permissions: user.permissions, did: binding.device_id },
      {
        subject,
        version,
        // 原封不動沿用舊 token 的起算點——絕對 session 上限的全部意義就在這一
        // 行。改成「現在」的話，每一次背景續期都會把上限往後推，session 就永遠
        // 不會到期，而症狀是「沒有人被登出」，不會有任何錯誤浮現。
        //
        // 這裡不必自己檢查有沒有超過上限：JwtDeviceAuthStrategy 繼承的
        // JwtAuthStrategy 已經在進到這支 handler 之前就擋掉了。
        authTime: claims.auth_time
      }
    );

    await this.deviceBinding.markUsed(binding.id);

    this.writeLog("info", "auth.token.refreshed", "JWT was refreshed", {
      requestId: req.requestId || null,
      userId: user.id,
      deviceId: binding.device_id
    });

    return this.response({
      token,
      tokenType: this.jwt.authScheme,
      expiresIn: this.jwt.expiresIn,
      expiresInSeconds: this.jwt.expiresInSeconds,
      sessionExpiresInSeconds: this.#sessionSecondsLeft(claims.auth_time),
      user
    });
  }

  /**
   * 這條 session 距離絕對上限還剩幾秒。
   *
   * 夾在 0 以上：JwtAuthStrategy 是在這支 handler 開始之前檢查的，中間隔著
   * findActiveById 與 currentVersion 兩次查詢。剛好踩在上限那一刻進來的請求，
   * 走到這一行時可能已經超過一兩秒，算出來是負數——那會撞到 responseSchema
   * 的 minimum: 0 變成 500。夾住它，讓那個罕見的邊界情況回一個誠實的 0。
   */
  #sessionSecondsLeft(authTime) {
    const elapsed = Math.floor(this.time.nowMs() / 1000) - authTime;
    return Math.max(0, this.jwt.sessionMaxAgeSeconds - elapsed);
  }
}
