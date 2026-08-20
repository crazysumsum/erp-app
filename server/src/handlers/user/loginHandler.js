import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { UserService } from "../../modules/user/UserService.js";
import { clientQuotaKey } from "../../services/requestLimiter/clientKey.js";
import { MemoryRateLimitStore } from "../../services/requestLimiter/RateLimitStore.js";
import { DEVICE_STATUS } from "../../services/deviceBinding/DeviceBindingService.js";
import {
  deviceSignatureError,
  deviceStatusError,
  readDeviceSignature
} from "../../services/deviceBinding/deviceSignatureRequest.js";

// 這個節流只管登入端點，跟全站的 requestLimiter service 完全分開、各自計算：
// 全站配額是為了扛流量，這裡是為了讓「用一個 IP 對很多不同帳號各送 5 次錯密碼、
// 把它們全部鎖住」這件事變貴——帳號鎖定本身沒有能力擋這件事，因為攻擊者鎖一個
// 帳號只需要 5 次請求，遠低於任何合理的全站流量配額。20 次／10 分鐘遠低於
// 「鎖光一份帳號清單」需要的量，但一般使用者打錯密碼、或同一個辦公室 NAT 出口
// 底下多人登入，正常不會撞到。
const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_IP_MAX_TRACKED_KEYS = 50_000;
// 跟 requestLimiter 預設的 ipv6PrefixLength 一致，不另外加一組設定：這裡的
// IPv6 聚合理由跟那邊完全一樣（見 clientKey.js 的說明），沒必要各自可調。
const IPV6_PREFIX_LENGTH = 64;

// 使用者物件的形狀，登入與 /me 共用。前端的 session store 直接吃這個。
export const USER_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "username", "displayName", "roles", "permissions"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    username: { type: "string" },
    displayName: { type: "string" },
    roles: { type: "array", items: { type: "string" } },
    permissions: { type: "array", items: { type: "string" } }
  }
});

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false
});

export class LoginHandler extends BaseRequestHandler {
  static handlerName = "login";

  static api = {
    method: "POST",
    path: "/api/v1/user/login",
    description: "以帳號密碼登入，成功時簽發 JWT。",
    authType: "public",
    authorizationPolicies: [
      {
        name: "allowAll",
        options: {}
      }
    ],
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["username", "password"],
        additionalProperties: false,
        properties: {
          username: { type: "string", minLength: 1, maxLength: 190 },
          // 上限不是密碼強度的限制，是成本的限制：沒有上限的話，一個貼滿整個
          // body limit 的「密碼」也會走完一次完整的雜湊。
          password: { type: "string", minLength: 1, maxLength: 1024 },
          // 首次從一台設備登入時附上，成為審批佇列裡給人看的裝置名稱。選填：
          // 沒有它審批者還有 IP 與 User-Agent 可看，不該因為少一個標籤就擋下
          // 整個登入。
          deviceLabel: { type: "string", maxLength: 190 }
        }
      }
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
          // 前端要靠這個數字算出到期時刻，才能排定續期與強制登出。字串
          // "15m" 會逼前端自己再實作一次單位解析。
          expiresInSeconds: { type: "integer", minimum: 1 },
          user: USER_SCHEMA
        }
      }
    }
  };

  constructor(services = {}) {
    super(services);
    // 業務模組直接 import 再自己建，不經 service container——container 管的是
    // 公用技術服務。它要用的那幾個技術服務仍然從 container 拿。
    this.userService = new UserService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
    this.jwt = services.require("jwt");
    this.tokenRevocation = services.require("tokenRevocation");
    this.deviceBinding = services.require("deviceBinding");
    // Handler 由 handlerRegistry 在啟動時建一次、之後每個請求重用（見
    // createHandlerRegistry），所以這個 store 的狀態會跨請求累積，不是每次
    // 登入都重建一個空的。
    this.loginIpLimiter = new MemoryRateLimitStore({
      maxTrackedKeys: LOGIN_IP_MAX_TRACKED_KEYS
    });
  }

  async execute(req, res) {
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    const quotaKey = clientQuotaKey(clientIp, IPV6_PREFIX_LENGTH);
    const rateLimit = await this.loginIpLimiter.consume(quotaKey, {
      limit: LOGIN_IP_LIMIT,
      windowMs: LOGIN_IP_WINDOW_MS
    });

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000));

      this.writeLog(
        "warn",
        "auth.login.rate_limited",
        "Login attempt was rejected by the per-IP login throttle",
        { requestId: req.requestId || null, clientIp, retryAfterSeconds }
      );

      res.setHeader("Retry-After", String(retryAfterSeconds));
      throw new ApplicationError("Too many login attempts from this client", {
        code: "LOGIN_RATE_LIMITED",
        statusCode: 429,
        publicCode: "Too Many Requests",
        publicMessage: "Too many login attempts. Try again later."
      });
    }

    const { username, password } = req.input.body;
    const result = await this.userService.authenticate(username, password);

    if (!result.ok) {
      // 失敗原因只進日誌。回應對每一種原因都一樣，否則回應本身就會告訴攻擊者
      // 哪些帳號存在、哪些已被鎖定。
      this.writeLog(
        "warn",
        "auth.login.failed",
        "Login attempt was rejected",
        {
          requestId: req.requestId || null,
          username: String(username),
          reason: result.reason
        }
      );

      throw new ApplicationError(`Login rejected: ${result.reason}`, {
        code: "LOGIN_FAILED",
        statusCode: 401,
        publicCode: "Unauthorized Access",
        publicMessage: "Invalid username or password"
      });
    }

    const { user } = result;
    const subject = String(user.id);

    // 設備檢查排在密碼**之後**，順序不可調換。反過來的話，任何人都能對任意
    // 帳號灌爆審批佇列，而且「這個帳號的設備還沒審批」這個回應本身就會洩漏
    // 帳號存不存在。走到這一行代表對方確實握有這個帳號的密碼。
    const binding = await this.#verifyDevice(req, user);

    // 版本號要從資料庫讀當下的值，不能用撤銷快照——快照可以落後，用它簽出來的
    // token 會在下一次刷新時被自己的實例判成已撤銷。見 currentVersion() 的註解。
    const version = await this.tokenRevocation.currentVersion(subject);

    // roles 與 permissions 進 claims，授權策略 hasRole／hasPermission 直接讀它們，
    // 請求路徑上因此不需要再查資料庫。代價是改權限要等 token 過期或被撤銷。
    //
    // did 是設備 id：續期時會比對它與請求簽章的設備是否為同一台，所以一個
    // token 只能被簽發它的那台設備續期。
    const token = this.jwt.issue(
      { roles: user.roles, permissions: user.permissions, did: binding.device_id },
      { subject, version }
    );

    await this.deviceBinding.markUsed(binding.id);

    this.writeLog("info", "auth.login.succeeded", "Login succeeded", {
      requestId: req.requestId || null,
      userId: user.id,
      username: user.username,
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
   * 驗證請求由一台已審批的設備發出，回傳那筆綁定。
   *
   * 沒有綁定就建立一筆待審批的並拋出 403——第一次從新設備登入的正常路徑就是
   * 走到這裡，使用者會看到「等待審批」而不是「登入失敗」。
   */
  async #verifyDevice(req, user) {
    const signature = readDeviceSignature(req);
    const existing = await this.deviceBinding.findBinding(user.id, signature.deviceId);

    // 已有綁定就一律用資料庫裡那把公鑰，請求自帶的直接忽略；否則任何人都能
    // 用自己的金鑰簽名、再附上自己的公鑰，整個綁定形同虛設。
    const publicKeyDer = existing ? existing.public_key : signature.publicKeyDer;

    if (!publicKeyDer) {
      throw deviceSignatureError("public_key_missing");
    }

    // 首次申請時 device id 必須真的是所附公鑰的 thumbprint。少了這一步，申請
    // 者可以宣稱一個與自己金鑰無關的 id，之後那個 id 對應到誰的金鑰就說不準了。
    if (!existing && this.deviceBinding.deviceIdFor(publicKeyDer) !== signature.deviceId) {
      throw deviceSignatureError("device_id_mismatch");
    }

    const verification = await this.deviceBinding.verifyRequest({
      ...signature,
      publicKeyDer,
      bodyHash: this.deviceBinding.bodyHash(req.rawBody)
    });

    if (!verification.ok) {
      // 原因只進日誌：「簽章不符」與「nonce 用過了」的差別會告訴攻擊者他離
      // 成功還差多遠。對外只有籠統的兩種（見 deviceSignatureError）。
      this.writeLog("warn", "auth.device.signature_rejected", "Device signature was rejected", {
        requestId: req.requestId || null,
        userId: user.id,
        deviceId: signature.deviceId,
        reason: verification.reason,
        detail: verification.detail ?? null
      });
      throw deviceSignatureError(verification.reason);
    }

    if (!existing) {
      const created = await this.deviceBinding.requestBinding({
        userId: user.id,
        deviceId: signature.deviceId,
        publicKeyDer,
        label: req.input.body.deviceLabel ?? "",
        ip: req.ip || req.socket?.remoteAddress || "",
        userAgent: req.get("user-agent") || ""
      });

      throw deviceStatusError(created.status);
    }

    if (existing.status !== DEVICE_STATUS.approved) {
      throw deviceStatusError(existing.status);
    }

    return existing;
  }
}
