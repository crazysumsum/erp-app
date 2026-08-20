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
        required: ["token", "tokenType", "expiresIn", "expiresInSeconds", "user"],
        additionalProperties: false,
        properties: {
          token: { type: "string" },
          tokenType: { type: "string" },
          expiresIn: { type: "string" },
          expiresInSeconds: { type: "integer", minimum: 1 },
          user: USER_SCHEMA
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
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
      { subject, version }
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
      user
    });
  }
}
