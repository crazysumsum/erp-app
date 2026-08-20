import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { USER_SCHEMA } from "./loginHandler.js";
import { UserService } from "../../modules/user/UserService.js";
import { DEVICE_STATUS } from "../../services/deviceBinding/DeviceBindingService.js";
import {
  deviceSignatureError,
  deviceStatusError,
  readDeviceSignature
} from "../../services/deviceBinding/deviceSignatureRequest.js";

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

/**
 * 換一個新的 JWT，讓正在使用系統的人不會在 token 到期那一刻被踢出去。
 * 設計說明見 docs/device-binding-auth.md。
 *
 * authType 刻意不覆寫，沿用預設的 jwt——這一點是承重的，不只是省字：
 *
 *   1. JwtAuthStrategy 的簽章驗證、撤銷檢查、快照熔斷的 503 全部免費繼承。
 *   2. **過期的 JWT 在進到這支 handler 之前就被擋成 401。** 那正是我們要的
 *      行為：過期即強制登出，不給寬限。改成 public 的話，這裡會變成一個可以
 *      用任意過期 token 換新 token 的端點。
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
    const { claims } = req.auth;
    const subject = String(claims.sub);
    const binding = await this.#verifyDevice(req, claims);

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

  /**
   * 確認這次續期由簽發這個 token 的那台設備發出，而且它仍然是被批准的。
   */
  async #verifyDevice(req, claims) {
    const signature = readDeviceSignature(req);

    // token 裡的 did 必須與簽名的設備是同一台。少了這一步，任何一台已審批的
    // 設備都能替任何一個 token 續期——包括用自己的金鑰去續一個偷來的 token。
    if (claims.did !== signature.deviceId) {
      this.writeLog("warn", "auth.device.mismatch", "Refresh came from a different device", {
        requestId: req.requestId || null,
        userId: Number(claims.sub),
        tokenDeviceId: claims.did ?? null,
        requestDeviceId: signature.deviceId
      });
      throw new ApplicationError("Refresh device does not match the token", {
        code: "DEVICE_MISMATCH",
        statusCode: 403,
        publicCode: "DEVICE_MISMATCH",
        publicMessage: "This token was issued to a different device"
      });
    }

    const binding = await this.deviceBinding.findBinding(
      Number(claims.sub),
      signature.deviceId
    );

    // 沒有綁定，或已經不是 approved：設備被撤銷之後，手上的 token 最多再活到
    // 自己過期為止，換不到新的。
    if (!binding) {
      throw deviceStatusError(DEVICE_STATUS.revoked);
    }

    if (binding.status !== DEVICE_STATUS.approved) {
      throw deviceStatusError(binding.status);
    }

    // 一律用資料庫裡那把公鑰。請求自帶的 X-Device-Public-Key 在這裡完全沒有
    // 意義——續期的前提就是這台設備已經綁定過了。
    const verification = await this.deviceBinding.verifyRequest({
      ...signature,
      publicKeyDer: binding.public_key,
      bodyHash: this.deviceBinding.bodyHash(req.rawBody)
    });

    if (!verification.ok) {
      this.writeLog("warn", "auth.device.signature_rejected", "Device signature was rejected", {
        requestId: req.requestId || null,
        userId: Number(claims.sub),
        deviceId: signature.deviceId,
        reason: verification.reason,
        detail: verification.detail ?? null
      });
      throw deviceSignatureError(verification.reason);
    }

    return binding;
  }
}
