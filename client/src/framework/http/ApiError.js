/**
 * HttpClient 拋出的唯一錯誤型別。頁面只需要 catch 呢一種，唔使逐個判斷
 * fetch 失敗、逾時、後端回錯呢幾種源頭。
 */
export class ApiError extends Error {
  constructor({
    status = null,
    code = "UNKNOWN_ERROR",
    message = "請求失敗",
    details,
    requestId = null,
    retryAfterSeconds = null,
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
