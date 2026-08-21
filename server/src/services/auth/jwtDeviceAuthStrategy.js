import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { JwtAuthStrategy } from "./jwtAuthStrategy.js";
import { DEVICE_STATUS } from "../deviceBinding/DeviceBindingService.js";
import {
  deviceSignatureError,
  deviceStatusError,
  readDeviceSignature
} from "../deviceBinding/deviceSignatureRequest.js";

/**
 * JWT 加設備簽章的認證策略。給那些光有一個沒過期、沒被撤銷的 JWT 還不夠、
 * 還要求請求本身由簽發它的那台已核准設備發出的高風險端點用——目前只有續期
 * （見 refreshTokenHandler.js），但這個保證跟哪一支 handler 在用它無關。
 *
 * 這裡做的每一件事都是身份問題，不是業務邏輯：JWT 有效嗎、沒被撤銷、這個
 * 簽章是不是這個 token 綁定的那台設備發出的。「這個帳號還 active 嗎」「這個
 * token 的版本號是不是已經被這次請求本身的動作(簽發新 token)追過」這種跟
 * 個別端點在做什麼有關的問題，仍然留在 handler 裡——見
 * docs/device-binding-auth.md 的競態分析那一節。
 *
 * 繼承 JwtAuthStrategy 而不是重寫一份：JWT 驗證、撤銷檢查、快照熔斷這三件事
 * 完全一樣，複製一份只會讓兩份未來各自漂移。this.authType 在建構時就已經是
 * "jwt-device"（見 BaseAuthStrategy 用 new.target 取值），所以
 * super.authenticate() 回傳的物件已經帶著正確的 type，不需要另外處理。
 */
export class JwtDeviceAuthStrategy extends JwtAuthStrategy {
  static authType = "jwt-device";

  static service = Object.freeze({
    name: "auth.jwtDevice",
    lifecycle: "singleton",
    // time 是繼承來的：JwtAuthStrategy 用它判斷絕對 session 上限。子類別必須
    // 自己列出來——service discovery 讀的是每個類別自己的 static metadata。
    dependencies: ["jwt", "tokenRevocation", "deviceBinding", "time", "logging"],
    eager: true
  });

  constructor({ config, services, options } = {}) {
    super({ config, services, options });
    this.deviceBinding = services.require("deviceBinding");
  }

  async authenticate(req) {
    // JWT 無效、過期或已撤銷會在這裡直接拋出，設備檢查完全不會跑——這正是
    // 「過期即強制登出，不給寬限」這條保證的來源，不是這個策略自己加的。
    const base = await super.authenticate(req);
    const { claims } = base;

    const signature = readDeviceSignature(req);

    // token 裡的 did 必須與簽名的設備是同一台。少了這一步，任何一台已審批的
    // 設備都能替任何一個 token 通過驗證——包括用自己的金鑰去用一個偷來的 token。
    if (claims.did !== signature.deviceId) {
      void this.logger?.warn?.("auth.device.mismatch", "Request came from a different device", {
        requestId: req.requestId || null,
        userId: Number(claims.sub),
        tokenDeviceId: claims.did ?? null,
        requestDeviceId: signature.deviceId
      });
      throw new ApplicationError("Request device does not match the token", {
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
    // 自己過期為止，通不過這裡。
    if (!binding) {
      throw deviceStatusError(DEVICE_STATUS.revoked);
    }

    if (binding.status !== DEVICE_STATUS.approved) {
      throw deviceStatusError(binding.status);
    }

    // 一律用資料庫裡那把公鑰。請求自帶的 X-Device-Public-Key 在這裡完全沒有
    // 意義——通過這裡的前提就是這台設備已經綁定過了。
    const verification = await this.deviceBinding.verifyRequest({
      ...signature,
      publicKeyDer: binding.public_key,
      bodyHash: this.deviceBinding.bodyHash(req.rawBody)
    });

    if (!verification.ok) {
      void this.logger?.warn?.(
        "auth.device.signature_rejected",
        "Device signature was rejected",
        {
          requestId: req.requestId || null,
          userId: Number(claims.sub),
          deviceId: signature.deviceId,
          reason: verification.reason,
          detail: verification.detail ?? null
        }
      );
      throw deviceSignatureError(verification.reason);
    }

    return { ...base, deviceBinding: binding };
  }
}
