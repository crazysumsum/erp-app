import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { DEVICE_STATUS } from "../../services/deviceBinding/DeviceBindingService.js";
import {
  BINDING_ID_PARAMS_SCHEMA,
  DEVICE_MGMT_POLICY,
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
    authorizationPolicies: DEVICE_MGMT_POLICY,
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
    description: "撤銷一台已核准的設備，並讓該使用者手上的 token 失效。"
  });

  constructor(services = {}) {
    super(services);
    this.tokenRevocation = services.require("tokenRevocation");
  }

  /**
   * 撤銷是兩次獨立的寫入：推高 token 版本號，以及把綁定轉成 revoked。跨兩張
   * 表、沒有共用交易，所以一定要決定「先做哪一個」——而這個順序是承重的。
   *
   * **先推版本號，再轉狀態。** 反過來的話（本來就是反過來的），第二步失敗會
   * 留下一台狀態已經是 revoked、但手上 token 仍然有效到自己過期為止的設備；
   * 而重試會因為狀態已經不是 approved 而回 409，永遠不會補做那次 token 撤銷。
   * 也就是說那次失敗是**永久性的少撤銷**，而且畫面上看起來是撤銷成功的。
   *
   * 照現在的順序，每一種失敗都落在安全的一邊，而且重試一定補得回來：
   *
   *   - 版本號那一步失敗 → 什麼都沒改，綁定仍是 approved，重試會完整重做
   *   - 轉狀態那一步失敗 → token 已經撤銷（多撤了，安全的方向），綁定仍是
   *     approved，重試會完整重做
   *   - 轉狀態回 null（另一個審批者同時做完了）→ 回 409，而最終狀態仍然正確：
   *     設備是 revoked、token 也撤銷了
   *
   * 代價是先查一次狀態：不查的話，對一台早就 revoked 的設備再按一次撤銷，會在
   * 什麼都不該發生的情況下把那個使用者從所有設備登出。查完到推版本號之間仍然
   * 有一個極窄的窗，那段時間內的並行撤銷會讓版本號被多推一次——那只是多一次
   * 登出，不是少一次撤銷，可以接受。
   */
  async review(bindingId, options) {
    const existing = await this.deviceBinding.findById(bindingId);

    if (!existing || existing.status !== DEVICE_STATUS.approved) {
      // 交給基底類別翻成 409。這裡不推版本號：這個動作本來就不該發生。
      return null;
    }

    // 只改 status 的話，那台設備手上的 token 還能再用到自己過期為止（最多 15
    // 分鐘）——它續不了期，但還沒死。遺失電腦是分鐘級的事，撐不起那個窗。
    //
    // ⚠️ 版本號是**每個使用者一個**而不是每台設備一個，所以這會讓該使用者在
    // 所有設備上一起登出。這可以接受：其他設備都是已審批的，重新登入一次即可、
    // 不需要再審批。
    await this.tokenRevocation.revoke(String(existing.user_id), {
      reason: "device_revoked"
    });

    return this.deviceBinding.revoke(bindingId, options);
  }

  async afterReview(binding, req) {
    // 訊息刻意不寫「立即失效」：撤銷不是全域瞬時的。處理這個請求的實例會馬上
    // 更新自己的快照，其他實例要等下一次刷新，上界是 tokenRevocation 設定裡的
    // maxStalenessSeconds（見 TokenRevocationService 的說明，啟動時會與實際刷新
    // 間隔交叉檢查）。事後查「為什麼撤銷後那半分鐘還進得來」的人，看到的第一
    // 行就該是準確的。
    this.writeLog(
      "info",
      "auth.device.revoked_sessions",
      "Revoking the device bumped the user's token version; other instances pick it up within the revocation staleness bound",
      {
        requestId: req.requestId || null,
        bindingId: Number(binding.id),
        userId: Number(binding.user_id)
      }
    );
  }
}
