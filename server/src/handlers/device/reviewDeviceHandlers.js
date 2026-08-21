import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  BINDING_ID_PARAMS_SCHEMA,
  DEVICE_APPROVE_POLICY,
  EMPTY_OBJECT_SCHEMA,
  REVIEW_BODY_SCHEMA,
  REVIEW_RESULT_SCHEMA
} from "./deviceBindingSchemas.js";

/**
 * 審批三個動作的共同部分。
 *
 * 三支 handler 的差別只有「呼叫 service 的哪一個方法」與「失敗訊息怎麼寫」，
 * 其餘（權限、schema、找不到就 409、記日誌）完全一樣。抽成基底類別而不是三份
 * 各自複製，是因為那些相同的部分裡有兩個容易寫錯又看不出來的地方：權限政策，
 * 以及「什麼都沒發生」要回 409 而不是 200。
 *
 * `authType: "jwt-password"`（見 JwtPasswordAuthStrategy）：核准會讓一台設備
 * 拿到長期存取權，撤銷會讓一個使用者所有 session 立刻失效——兩者都是光有
 * session 還不夠、值得要求審批者當場再證明一次「現在仍然是我」的動作。密碼
 * 的驗證與錯誤碼全部在 strategy 裡處理，這裡不重複。
 */
class ReviewDeviceHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.deviceBinding = services.require("deviceBinding");
  }

  /** 子類別覆寫：實際執行轉移，回傳轉移後的綁定或 null。 */
  async review(_bindingId, _options) {
    throw new Error(`${this.constructor.name} must implement review()`);
  }

  /** 子類別覆寫：轉移前必須處於的狀態，用來寫錯誤訊息。 */
  static requiredStatus = "pending";

  async execute(req) {
    const bindingId = Number(req.input.params.id);
    const reviewerId = Number(req.auth.claims.sub);
    const note = req.input.body?.note ?? "";

    const binding = await this.review(bindingId, { reviewerId, note });

    if (!binding) {
      // 轉移的 UPDATE 帶著來源狀態，所以影響 0 列可能是 id 不存在，也可能是
      // 它已經不在那個狀態了（別的審批者剛剛處理過）。兩者對呼叫端是同一個
      // 意思：這個動作現在做不了。
      //
      // 409 而不是 404：資源多半是存在的，只是狀態不對；回 404 會讓審批者以為
      // 自己看到的是一份壞掉的清單。
      throw new ApplicationError(
        `Device binding ${bindingId} is not ${this.constructor.requiredStatus}`,
        {
          code: "DEVICE_BINDING_CONFLICT",
          statusCode: 409,
          publicCode: "DEVICE_BINDING_CONFLICT",
          publicMessage: "This request was already handled by someone else"
        }
      );
    }

    await this.afterReview?.(binding, req);

    return this.response({ id: Number(binding.id), status: binding.status });
  }
}

function reviewApi({ path, description }) {
  return {
    method: "POST",
    path,
    description,
    authType: "jwt-password",
    authorizationPolicies: DEVICE_APPROVE_POLICY,
    requestSchema: {
      params: BINDING_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: REVIEW_BODY_SCHEMA
    },
    responseSchema: { 200: REVIEW_RESULT_SCHEMA }
  };
}

export class ApproveDeviceHandler extends ReviewDeviceHandler {
  static handlerName = "approveDevice";
  static requiredStatus = "pending";
  static api = reviewApi({
    path: "/api/v1/device/bindings/:id/approve",
    description: "核准一筆待審批的設備綁定申請。"
  });

  async review(bindingId, options) {
    return this.deviceBinding.approve(bindingId, options);
  }
}

export class RejectDeviceHandler extends ReviewDeviceHandler {
  static handlerName = "rejectDevice";
  static requiredStatus = "pending";
  static api = reviewApi({
    path: "/api/v1/device/bindings/:id/reject",
    description: "拒絕一筆待審批的設備綁定申請。"
  });

  async review(bindingId, options) {
    return this.deviceBinding.reject(bindingId, options);
  }
}

export class RevokeDeviceHandler extends ReviewDeviceHandler {
  static handlerName = "revokeDevice";
  static requiredStatus = "approved";
  static api = reviewApi({
    path: "/api/v1/device/bindings/:id/revoke",
    description: "撤銷一台已核准的設備，並讓該使用者手上的 token 立即失效。"
  });

  constructor(services = {}) {
    super(services);
    this.tokenRevocation = services.require("tokenRevocation");
  }

  async review(bindingId, options) {
    return this.deviceBinding.revoke(bindingId, options);
  }

  async afterReview(binding, req) {
    // 只改 status 的話，那台設備手上的 token 還能再用到自己過期為止（最多 15
    // 分鐘）——它續不了期，但還沒死。遺失電腦是分鐘級的事，所以一併把版本號
    // 推上去，讓現有 token 立刻失效。
    //
    // ⚠️ 版本號是**每個使用者一個**而不是每台設備一個，所以這會讓該使用者在
    // 所有設備上一起登出。這可以接受：其他設備都是已審批的，重新登入一次即可、
    // 不需要再審批，而換到的是撤銷立即生效。
    await this.tokenRevocation.revoke(String(binding.user_id), {
      reason: "device_revoked"
    });

    this.writeLog(
      "info",
      "auth.device.revoked_sessions",
      "Revoking the device also invalidated the user's existing tokens",
      {
        requestId: req.requestId || null,
        bindingId: Number(binding.id),
        userId: Number(binding.user_id)
      }
    );
  }
}
