/**
 * 後端 ApplicationError 嘅 publicMessage 好多都係俾開發者睇嘅英文 debug
 * 字串（例如 "Internal server error"、"Unauthorized Access"）——見 server
 * 嗰邊 errorHandler.js／ApplicationError.js 嘅慣例：`message` 落 log，
 * `publicMessage` 先係設計俾用戶睇，但基礎設施層（認證／設備綁定／逾時／
 * 限流等）一直冇跟呢個慣例翻譯做中文。前端唔應該將呢啲字串直接顯示，
 * 要按 `error.code`（後端嘅 publicCode，見 HttpClient.js）揀返一句中文。
 *
 * 淨係列出目前後端會用英文 publicMessage 嘅 code。業務邏輯層（用戶／角色
 * 管理等）本身已經用緊中文 publicMessage，唔喺呢個表入面嘅 code 會原樣
 * 顯示 backend 傳落嚟嗰句——所以呢個表只需要覆蓋「已知係英文」嗰啲。
 */
export const ERROR_CODE_MESSAGES = Object.freeze({
  "Too Many Requests": "請求次數過多，請稍後再試",
  "Unauthorized Access": "登入已失效，請重新登入",
  Forbidden: "沒有權限執行這個操作",
  DEVICE_MISMATCH: "登入資訊與這台設備不符，請重新登入",
  PASSWORD_REQUIRED: "請確認你目前的密碼",
  PASSWORD_INVALID: "請確認你目前的密碼",
  DEVICE_SIGNATURE_REQUIRED: "這個請求必須由已註冊的設備簽署",
  DEVICE_SIGNATURE_INVALID: "設備簽章無效",
  DEVICE_SIGNATURE_STALE: "這台設備的時間與伺服器差距太大，請檢查系統時間後再試",
  DEVICE_PENDING_APPROVAL: "這台設備正在等待審批，批准後才可以使用",
  DEVICE_REJECTED: "這台設備的申請已被拒絕，請聯絡管理員",
  DEVICE_REVOKED: "這台設備的存取權已被撤銷，請聯絡管理員",
  DEVICE_BINDING_CONFLICT: "這個請求已經被其他人處理過了",
  REQUEST_TIMEOUT: "請求逾時，請稍後再試",
  REQUEST_BODY_TIMEOUT: "請求內容接收逾時",
  CORS_ORIGIN_DENIED: "不允許的來源",
  HTTPS_REQUIRED: "必須使用 HTTPS",
  SERVICE_UNAVAILABLE: "服務暫時無法使用，請稍後再試",
  INTERNAL_SERVER_ERROR: "系統發生錯誤，請稍後再試",
  NOT_FOUND: "找不到請求的內容",
  REQUEST_BODY_TOO_LARGE: "請求內容過大",
  INVALID_JSON: "請求內容格式錯誤",
  // 上傳中間件（src/framework/upload/uploadMiddleware.js）嘅錯誤，同上面
  // 一樣一直未跟中文 publicMessage 慣例——T25／T26 之前冇任何功能用到
  // 上傳，而家先第一次由 media 上傳觸發呢幾個 code。
  UPLOAD_CONTENT_TYPE_INVALID: "請求格式不正確",
  UPLOAD_REQUEST_TOO_LARGE: "上傳內容超過大小上限",
  UPLOAD_CAPACITY_EXCEEDED: "伺服器目前處理太多上傳，請稍後再試",
  UPLOAD_MALFORMED: "上傳請求格式錯誤",
  UPLOAD_ABORTED: "上傳中斷，請重試",
  UPLOAD_FIELD_TOO_LARGE: "表單欄位內容過大",
  UPLOAD_FILE_TOO_LARGE: "檔案超過大小上限",
  UPLOAD_TYPE_NOT_ALLOWED: "不允許上傳這種檔案類型",
  UPLOAD_TYPE_MISMATCH: "檔案內容與宣告的類型不符，已拒絕上傳",
  UPLOAD_TOTAL_TOO_LARGE: "檔案總大小超過上限",
  UPLOAD_TOO_MANY_FILES: "上傳檔案數量過多",
  UPLOAD_TOO_MANY_FIELDS: "表單欄位數量過多",
  UPLOAD_FAILED: "上傳失敗，請重試"
});
