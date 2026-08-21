import authConfig from "@config/auth.js";

/**
 * 讀寫 token 嘅唯一入口。日後如果要換儲存方式（例如改 httpOnly cookie），
 * 只需要改呢個檔案——HttpClient 嘅 default getToken 同呢度用緊同一個 key，
 * 但兩邊刻意冇互相 import，避免循環依賴（見 HttpClient.js 頂部註解）。
 */
export function getToken() {
  return localStorage.getItem(authConfig.tokenStorageKey);
}

/**
 * 寫入 token，同時記低佢嘅到期時刻。
 *
 * 兩樣嘢一定要一齊寫：watchdog 靠 deadline 決定幾時續期同幾時強制登出，
 * 得 token 冇 deadline 嘅話佢會當成「已經過期」即刻登出，得 deadline 冇 token
 * 就會拎住一個過期時刻去等一個唔存在嘅 session。
 *
 * deadline 用「收到當下 + 伺服器畀嘅秒數」算，唔係讀 JWT 自己嘅 exp 去比本地
 * 時鐘：用戶部機嘅時鐘唔可信，而呢個算法淨係倚賴「收到之後過咗幾耐」。睡眠期間
 * wall clock 照常前進，所以闔上部機再打開都計得啱。
 */
export function setToken(token, expiresInSeconds, sessionExpiresInSeconds) {
  const receivedAt = Date.now();

  localStorage.setItem(authConfig.tokenStorageKey, token);
  localStorage.setItem(
    authConfig.tokenDeadlineKey,
    String(receivedAt + Number(expiresInSeconds) * 1000)
  );
  localStorage.setItem(
    authConfig.sessionDeadlineKey,
    String(receivedAt + Number(sessionExpiresInSeconds) * 1000)
  );
}

/** token 嘅到期時刻（epoch 毫秒）。冇記錄當作 0，即係已經過期。 */
export function getTokenDeadline() {
  return Number(localStorage.getItem(authConfig.tokenDeadlineKey) || 0);
}

/**
 * 絕對 session 上限嘅到期時刻（epoch 毫秒）。
 *
 * 冇記錄當作 0（已經過期），同 getTokenDeadline() 一樣 fail closed：呢個值淨係
 * 由 setToken() 寫入，讀唔到即係冇 token 或者 storage 俾人清咗，兩種都應該登出。
 */
export function getSessionDeadline() {
  return Number(localStorage.getItem(authConfig.sessionDeadlineKey) || 0);
}

export function clearToken() {
  localStorage.removeItem(authConfig.tokenStorageKey);
  localStorage.removeItem(authConfig.tokenDeadlineKey);
  localStorage.removeItem(authConfig.sessionDeadlineKey);
}
