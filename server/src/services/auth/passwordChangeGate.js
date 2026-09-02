/**
 * 強制首次改密碼的豁免清單。設計說明見 docs/user_management/design_spec.md §3.5。
 *
 * `jwtAuthStrategy.js` 對帶著 `mcp: true` claim 的 token 一律擋下，除非這次
 * 請求落在這裡——少了這四條，使用者會被永久鎖在改密碼頁，連改密碼那一支都
 * 打不通。
 *
 * 全是靜態路徑（沒有 `:param`），所以比對 `${method} ${path}` 就夠，不需要
 * route 物件。清單會不會跟著路徑改動而失效：會，而且失效的方式很糟——某支
 * 端點改了路徑，清單卻沒跟著改，使用者就會被永久鎖住。
 * `test/passwordChangeGateConventions.test.js` 把這件事釘住：斷言這裡每一條
 * 都真的對得上一條已註冊的 route，改路徑而忘了改這裡，CI 會擋下來。
 */
export const PASSWORD_CHANGE_GATE_EXEMPTIONS = Object.freeze([
  "POST /api/v1/user/password/change", // 改密碼本身
  "GET /api/v1/user/me", // 前端開機還原 session 要用
  "POST /api/v1/user/token/refresh", // 讓使用者填表時 session 不會在中途死掉
  "POST /api/v1/user/logout" // 永遠要留得住的一條退路
]);

export function isExemptFromPasswordChangeGate(req) {
  return PASSWORD_CHANGE_GATE_EXEMPTIONS.includes(`${req.method} ${req.path}`);
}
