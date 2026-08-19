import authConfig from "@config/auth.js";

/**
 * 讀寫 token 嘅唯一入口。日後如果要換儲存方式（例如改 httpOnly cookie），
 * 只需要改呢個檔案——HttpClient 嘅 default getToken 同呢度用緊同一個 key，
 * 但兩邊刻意冇互相 import，避免循環依賴（見 HttpClient.js 頂部註解）。
 */
export function getToken() {
  return localStorage.getItem(authConfig.tokenStorageKey);
}

export function setToken(token) {
  localStorage.setItem(authConfig.tokenStorageKey, token);
}

export function clearToken() {
  localStorage.removeItem(authConfig.tokenStorageKey);
}
