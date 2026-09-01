import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { AuthenticationError } from "../../framework/auth/AuthenticationError.js";
import { BaseAuthStrategy } from "../../framework/auth/BaseAuthStrategy.js";
import { isExemptFromPasswordChangeGate } from "./passwordChangeGate.js";

/**
 * 從 Authorization header 取出 bearer token。格式不對回 null——呼叫端自己決定
 * 那要翻成什麼錯誤。
 *
 * 抽出來共用，是因為 JwtDeviceAuthStrategy 也需要**原始 token**（拿去算
 * accessTokenHash）。另一條路是讓 authenticate() 把 token 一併放進回傳的 auth
 * 物件，但那個物件會被塞進 req.auth 與 request context，也就是說一份憑證會跟著
 * 請求到處跑、包括進日誌。重新拆一次字串遠比那個便宜。
 */
export function readBearerToken(req, jwt) {
  const [scheme, token, extra] = String(req.get(jwt.headerName) || "")
    .trim()
    .split(/\s+/);

  if (!token || extra || scheme.toLowerCase() !== jwt.authScheme.toLowerCase()) {
    return null;
  }

  return token;
}

export class JwtAuthStrategy extends BaseAuthStrategy {
  static authType = "jwt";

  // 完全一般的 service metadata：簽發與驗證都交給 jwt service，這個策略只
  // 負責把 token 從 HTTP header 裡取出來，再問它有沒有被撤銷、有沒有超過
  // 絕對 session 上限。
  static service = Object.freeze({
    name: "auth.jwt",
    lifecycle: "singleton",
    dependencies: ["jwt", "tokenRevocation", "time", "logging"],
    eager: true
  });

  constructor({ config, services, options } = {}) {
    super({ config, services, options });
    this.jwt = services.require("jwt");
    this.tokenRevocation = services.require("tokenRevocation");
    // 時鐘從 container 拿而不是直接叫 Date.now()：絕對上限的判斷完全建立在
    // 「現在幾點」上面，注入進來才測得到「八小時又一秒」這種邊界。
    this.time = services.require("time");
  }

  async authenticate(req) {
    const token = readBearerToken(req, this.jwt);

    if (!token) {
      throw new AuthenticationError(
        "JWT_REQUIRED",
        `A valid ${this.jwt.authScheme} token is required`
      );
    }

    try {
      const claims = this.jwt.verify(token);

      // 絕對 session 上限。排在最前面，因為它是這三道檢查裡唯一不依賴任何外部
      // 狀態的一道——純粹是兩個數字相減。撤銷要讀快照，快照可能不健康；而一條
      // 已經超過上限的 session 是死的，跟快照健不健康完全無關。放在後面的話，
      // 撤銷服務故障期間，一個九小時前的 token 會拿到 503（「稍後再試」）而不是
      // 401（「請重新登入」）——那是個會誤導人的答案。
      //
      // auth_time 由 issue() 強制寫入，續期時原封不動沿用（見 JwtService），
      // 所以續期推不動這個起算點。verify() 已經擋掉沒有 auth_time 的 token。
      const sessionAgeSeconds =
        Math.floor(this.time.nowMs() / 1000) - claims.auth_time;

      if (sessionAgeSeconds > this.jwt.sessionMaxAgeSeconds) {
        // info 而不是 warn：每個使用者每天都會撞到一次，這是設計本身要求的
        // 行為，不是異常。記成 warn 只會把真正的 warn 淹掉。
        void this.logger?.info?.(
          "auth.jwt.session_expired",
          "JWT was rejected because its session reached the absolute maximum age",
          {
            requestId: req.requestId || null,
            subject: claims.sub ?? null,
            sessionAgeSeconds,
            sessionMaxAgeSeconds: this.jwt.sessionMaxAgeSeconds
          }
        );
        // 對外仍然只有籠統的 401，跟其他認證失敗一致。客戶端要做的事情是一樣
        // 的——清掉憑證、回登入頁——而那條路它已經走得很對了。
        throw new AuthenticationError("SESSION_EXPIRED", "JWT is invalid or expired");
      }

      // 撤銷檢查刻意放在這裡而不是 JwtService.verify() 裡：jwt service 沒有
      // 任何依賴，是純粹的簽發與驗證。讓它依賴資料庫，會把整個 auth 堆疊——
      // 連 issue() 都算在內——綁死在 MySQL 上。
      //
      // 代價是任何直接呼叫 jwt.verify() 的地方都會繞過撤銷。目前只有這裡在
      // 呼叫，新增呼叫端時必須自己想清楚這一點。
      if (this.tokenRevocation.isRevoked(claims)) {
        // 撤銷後仍被使用，通常代表對方還不知道自己已經被踢掉，也可能是被盜的
        // token 正在被使用。這個區別靠 subject 與頻率去看，所以兩者都要記。
        void this.logger?.warn?.("auth.jwt.revoked", "JWT was revoked", {
          requestId: req.requestId || null,
          subject: claims.sub ?? null,
          issuedAt: claims.iat ?? null,
          // 判定的依據。缺 ver 的 token 也走這條路（部署切換前簽的、或手工造
          // 的），而 null 與一個落後的數字要分得出來——前者是相容性，後者是
          // 真的被撤銷了。
          tokenVersion: claims.ver ?? null,
          snapshotAgeSeconds: this.tokenRevocation.snapshotAgeSeconds()
        });
        throw new AuthenticationError("JWT_INVALID", "JWT is invalid or expired");
      }

      // 快照過期的檢查排在撤銷判定之後：舊快照仍然可能已經記著這個 subject，
      // 那時「已撤銷」是比「無法判斷」更準確的答案。
      if (!this.tokenRevocation.snapshotUsable()) {
        // 401 是錯的答案。token 本身沒問題，是伺服器沒辦法判斷它有沒有被撤銷。
        // 回 401 會讓客戶端丟掉憑證去重新登入，把一次撤銷故障放大成一場登入
        // 風暴；503 說的是「這是伺服器的問題，稍後再試」，憑證留著。
        //
        // 只有 authType 是 jwt 的 route 受影響。public route——登入、/health
        // ——照常運作，恢復手段不會被一起鎖掉。
        void this.logger?.error?.(
          "auth.revocation.circuit_open",
          "Rejecting authenticated requests: the revocation snapshot is too stale to trust",
          {
            requestId: req.requestId || null,
            snapshotAgeSeconds: this.tokenRevocation.snapshotAgeSeconds()
          }
        );
        throw new ApplicationError(
          "Token revocation snapshot is too stale to trust",
          {
            code: "REVOCATION_UNAVAILABLE",
            statusCode: 503,
            publicCode: "SERVICE_UNAVAILABLE",
            publicMessage: "Service unavailable"
          }
        );
      }

      // mcp（must change password）：排在撤銷檢查與快照熔斷之後——一個已撤銷、
      // 或者連撤銷狀態都無法判斷的 token，不該先被這道檢查攔下來，讓人以為
      // 問題是要改密碼。
      //
      // 擋在認證層而不是授權層，是因為授權策略是逐條 route 宣告的，而 handler
      // 只要自己寫了 authorizationPolicies 就會整組取代預設值（見
      // apiDefinitionResolver.js）——提權端點那幾支就是這樣。掛在預設值上的
      // 檢查會被它們安靜地繞過，而「安靜地繞過」正是這道門最不能有的失敗方式。
      // JwtPasswordAuthStrategy 與 JwtDeviceAuthStrategy（含
      // JwtDevicePasswordAuthStrategy）都繼承自這裡，所以四種認證方式一起被
      // 擋住，不必各寫一次。
      if (claims.mcp === true && !isExemptFromPasswordChangeGate(req)) {
        // 403 而不是 401：token 本身有效。前端把任何 401 都當成「session 已死」
        // 而清憑證（見 HttpClient.js），用 401 會讓使用者在改密碼之前先被踢回
        // 登入頁，然後登入、再被擋、再被踢——一個迴圈。
        throw new ApplicationError("Password change is required before continuing", {
          code: "PASSWORD_CHANGE_REQUIRED",
          statusCode: 403,
          publicCode: "PASSWORD_CHANGE_REQUIRED",
          publicMessage: "請先修改密碼"
        });
      }

      return { type: this.authType, claims };
    } catch (error) {
      // 上面刻意丟出來的錯誤都已經是最終結論，不該被重新包裝成「驗證失敗」，
      // 那會多記一筆誤導的 auth.jwt.rejected。
      //
      // 這裡認的是 ApplicationError 而不是 AuthenticationError：熔斷丟的是
      // 503，繼承關係上它不是 AuthenticationError，只認後者的話 503 會在這裡
      // 被降級成 401——正好是熔斷要避免的那個後果。
      if (error instanceof ApplicationError) {
        throw error;
      }

      // 客戶端只會收到籠統的 JWT_INVALID——「簽章錯誤」與「已過期」的差別
      // 會告訴攻擊者他離成功還差多遠。但這個差別對防守方極重要：過期是日常，
      // 簽章錯誤代表有人在偽造 token。原因只寫進日誌，不進回應。
      void this.logger?.warn?.("auth.jwt.rejected", "JWT verification failed", {
        requestId: req.requestId || null,
        // jsonwebtoken 用 name 區分 TokenExpiredError／JsonWebTokenError／
        // NotBeforeError，message 則載明是 issuer、audience 還是簽章不符。
        error: { name: error.name, message: error.message }
      });
      throw new AuthenticationError("JWT_INVALID", "JWT is invalid or expired");
    }
  }
}
