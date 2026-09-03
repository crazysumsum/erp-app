import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { verifyPassword } from "./passwordHash.js";

/**
 * 新密碼的共用檢查。設計說明見 docs/user_management/design_spec.md §3.4。
 *
 * 三條路徑（建立帳號、管理員重設、使用者自己改）共用這一個函式，寫在
 * passwordHash.js 隔壁：三處各寫一次的話，遲早有一處會漏——而漏掉的那一處
 * 一定是管理員設初始密碼那一條。
 *
 * 規則只有兩條，刻意不加數字與符號的要求：再往上加只會把密碼推向
 * `Password123!` 這種同時滿足所有規則、又在每一份字典裡的寫法。長度是這裡
 * 真正承重的那一條。
 */

const MIN_LENGTH = 12;

function weak(publicMessage) {
  return new ApplicationError(`Password does not meet policy: ${publicMessage}`, {
    code: "PASSWORD_TOO_WEAK",
    statusCode: 400,
    publicCode: "PASSWORD_TOO_WEAK",
    publicMessage
  });
}

/**
 * 檢查密碼本身的強度，並回傳 trim 後的值。錯誤訊息指名差在哪，而不是一句
 * 「密碼不符要求」——後者只會讓人一直試。
 *
 * 只 trim 前後空白，中間原樣保留：允許空格與可列印字元，不擋密碼管理器產生
 * 的隨機字串。長度上限（200）與截斷防護留給 request schema，這裡不重複。
 *
 * 回傳值（而不是 void）是刻意的：呼叫端拿這個 trim 後的值去 hash、去跟目前
 * 密碼比對，三處共用同一個 trim 結果，不會有「驗證時 trim、實際存的時候冇
 * trim」這種落差（DEF-004）。
 */
export function assertPasswordStrength(password) {
  const trimmed = String(password ?? "").trim();

  if (trimmed.length < MIN_LENGTH) {
    throw weak(`至少需要 ${MIN_LENGTH} 個字元`);
  }

  if (!/[a-z]/.test(trimmed)) {
    throw weak("需要包含至少一個小寫英文字母");
  }

  if (!/[A-Z]/.test(trimmed)) {
    throw weak("需要包含至少一個大寫英文字母");
  }

  return trimmed;
}

/**
 * 新密碼不得與目前的密碼相同。
 *
 * 要跑一次雜湊比對，成本跟登入的一次密碼驗證相同——只在 assertPasswordStrength
 * 已經過關之後才呼叫這個，避免對一個連基本強度都不符的字串白跑一次 scrypt。
 */
export async function assertPasswordChanged(newPassword, currentPasswordHash) {
  if (await verifyPassword(newPassword, currentPasswordHash)) {
    throw new ApplicationError("New password matches the current password", {
      code: "PASSWORD_UNCHANGED",
      statusCode: 400,
      publicCode: "PASSWORD_UNCHANGED",
      publicMessage: "新密碼不可與目前的密碼相同"
    });
  }
}
