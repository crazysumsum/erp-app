import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { AUTH_FAILURE } from "../../modules/user/UserService.js";

/**
 * 密碼再次確認的共用邏輯。`JwtPasswordAuthStrategy` 與
 * `JwtDevicePasswordAuthStrategy`（見同目錄）都在各自的 `super.authenticate()`
 * 通過之後呼叫這個——JWT 證明這是誰的 session，這裡證明這一刻仍然握有那個
 * 身份的憑證。抽出來共用是因為這是兩個 strategy 第二次真的需要一模一樣的
 * 邏輯，不是預先猜測；複製一份只會讓兩份未來各自漂移（例如某一邊忘了處理
 * 新加的 TEMPORARY_EXPIRED）。
 *
 * 密碼從 request body 的 `password` 欄位讀，在 handler 的 schema 驗證之前——
 * 認證要先於「這個請求長什麼樣子對不對」的檢查。
 *
 * 密碼錯 / 帳號被鎖 / 帳號查無，統一收成一個 PASSWORD_INVALID：呼叫端雖然已經
 * 持有這個帳號的有效 JWT，但不該從回應差異分辨出「密碼錯」跟「已被鎖定」，
 * 這對一個拿著偷來的 token 的人是可以拿來校準策略的資訊。帳號被停用單獨給
 * USER_INACTIVE、臨時密碼過期單獨給 TEMPORARY_PASSWORD_EXPIRED，理由相同：
 * 那對正常使用者是可行動的資訊（找管理員），不是密碼猜測相關的洩漏。
 *
 * PASSWORD_INVALID 是 403，不是 401——這不是措辭問題。前端把任何 401 都當成
 * 「這個 JWT 已經不算數」，全域清 session、踢回登入頁（見 HttpClient.js 的
 * onUnauthorized）。JWT 本身是有效的，錯的是再次確認用的密碼；用 401 的話，
 * 單純打錯一次密碼就會把整個工作階段登出，這正是這個機制的存在意義想避免的
 * 事——它要做的是多一層確認，不是意外提早結束一個原本有效的 session。
 * USER_INACTIVE 與 TEMPORARY_PASSWORD_EXPIRED 維持各自的原生狀態碼：帳號被
 * 停用、臨時密碼過期都是真的要結束這個 session，不是意外副作用。
 */
export async function assertPasswordConfirmed(req, { userId, userService, logger }) {
  const password = req.body?.password;

  if (typeof password !== "string" || password.length === 0) {
    throw new ApplicationError("Password confirmation is required", {
      code: "PASSWORD_REQUIRED",
      statusCode: 400,
      publicCode: "PASSWORD_REQUIRED",
      publicMessage: "Please confirm your current password"
    });
  }

  const result = await userService.verifyPasswordById(userId, password);

  if (result.ok) {
    return;
  }

  void logger?.warn?.("auth.password.rejected", "Password re-authentication was rejected", {
    requestId: req.requestId || null,
    userId,
    reason: result.reason
  });

  if (result.reason === AUTH_FAILURE.DISABLED) {
    throw new ApplicationError("Account is disabled", {
      code: "USER_INACTIVE",
      statusCode: 401,
      publicCode: "Unauthorized Access",
      publicMessage: "Unauthorized Access"
    });
  }

  if (result.reason === AUTH_FAILURE.TEMPORARY_EXPIRED) {
    throw new ApplicationError("Temporary password has expired", {
      code: "TEMPORARY_PASSWORD_EXPIRED",
      statusCode: 401,
      publicCode: "TEMPORARY_PASSWORD_EXPIRED",
      publicMessage: "初始密碼已逾期，請聯絡管理員重設"
    });
  }

  throw new ApplicationError(`Password re-authentication rejected: ${result.reason}`, {
    code: "PASSWORD_INVALID",
    statusCode: 403,
    publicCode: "PASSWORD_INVALID",
    publicMessage: "Please confirm your current password"
  });
}
