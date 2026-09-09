import authConfig from "@config/auth.js";
import httpConfig from "@config/http.js";
import { ApiError } from "./ApiError.js";
import { ERROR_CODE_MESSAGES } from "./errorMessages.js";

/**
 * 包住 fetch，對應後端統一的 response 信封（{success, data, meta} /
 * {success:false, error, meta}）：成功直接回 data，失敗一律拋 ApiError。
 *
 * getToken 同 onUnauthorized 用依賴注入而唔係直接讀 localStorage／導頁：
 * token 儲存層同路由要到 Phase 3 先落地，呢度預留掛勾，等 Phase 3 接上
 * 真正嘅 session store，測試亦唔使假 localStorage 或真路由。
 */
export class HttpClient {
  constructor({
    baseUrl = httpConfig.baseUrl,
    timeoutMs = httpConfig.timeoutMs,
    authHeaderName = httpConfig.authHeaderName,
    authScheme = httpConfig.authScheme,
    fetchImpl = (...args) => fetch(...args),
    getToken = defaultGetToken,
    onUnauthorized = () => {},
    signRequest = null
  } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.authHeaderName = authHeaderName;
    this.authScheme = authScheme;
    this.fetchImpl = fetchImpl;
    this.getToken = getToken;
    this.onUnauthorized = onUnauthorized;
    // 同 getToken／onUnauthorized 一樣用注入：簽名要用 Web Crypto 同 IndexedDB，
    // 直接 import 會令每一個 HttpClient 測試都要備妥呢兩樣。真正嘅簽名器喺
    // main.js 接上（見 framework/auth/deviceKey.js）。
    this.signRequest = signRequest;
  }

  get(path, options) {
    return this.request("GET", path, options);
  }

  post(path, options) {
    return this.request("POST", path, options);
  }

  put(path, options) {
    return this.request("PUT", path, options);
  }

  patch(path, options) {
    return this.request("PATCH", path, options);
  }

  delete(path, options) {
    return this.request("DELETE", path, options);
  }

  async request(
    method,
    path,
    {
      params,
      body,
      idempotent = false,
      idempotencyKey,
      signal,
      signed = false,
      includePublicKey = false
    } = {}
  ) {
    const url = buildUrl(this.baseUrl, path, params);
    const headers = { Accept: "application/json" };

    const token = this.getToken();
    if (token) {
      headers[this.authHeaderName] = `${this.authScheme} ${token}`;
    }

    if (idempotent) {
      headers["Idempotency-Key"] = idempotencyKey || crypto.randomUUID();
    }

    let payload;
    if (body instanceof FormData) {
      // Multipart 上傳：唔手動設 Content-Type。瀏覽器需要自己生成一個
      // 唯一嘅 boundary 並寫入呢個 header，人手夾一個字串必然同 fetch
      // 實際產生嘅 body 對唔上，令後端 uploadMiddleware.js 解唔到請求。
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    if (signed) {
      if (!this.signRequest) {
        // 靜默唔簽會令請求一路去到後端先被拒，而錯誤係「簽章缺失」——查極都
        // 查唔到原因喺客戶端根本冇裝簽名器。喺呢度即刻炸。
        throw new Error("A signed request was made but no signRequest was configured");
      }

      Object.assign(
        headers,
        await this.signRequest({
          method,
          // 簽 pathname 而唔係完整 URL：後端簽嘅係 req.path，唔含 origin 同
          // query string。呢兩邊唔一致嘅話每一個帶 params 嘅簽名請求都會失敗。
          path: new URL(url).pathname,
          // 簽嘅係真正送出去嗰個字串。重新 stringify 一次可能得出唔同嘅 bytes
          // （鍵順序、空白），咁樣簽章會時好時壞——最難查嗰一種。
          body: payload,
          // 簽章要綁死喺呢個請求用緊嗰枚 token 上（見 deviceKey.js 嘅
          // accessTokenHash）。冇 token 嘅請求（登入）傳 undefined。
          token,
          includePublicKey
        })
      );
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response;
    try {
      response = await this.fetchImpl(url, { method, headers, body: payload, signal: requestSignal });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new ApiError({ code: "TIMEOUT", message: "請求逾時，請稍後再試", cause: error });
      }
      if (signal?.aborted) {
        // 頁面／元件主動取消（例如卸載），唔係錯誤，原樣拋出俾呼叫方識別。
        throw error;
      }
      throw new ApiError({ code: "NETWORK_ERROR", message: "網路錯誤，請檢查連線", cause: error });
    } finally {
      clearTimeout(timeoutId);
    }

    const envelope = await parseJsonBody(response);

    if (!response.ok || envelope?.success === false) {
      const errorBody = envelope?.error || {};
      const code = errorBody.code || `HTTP_${response.status}`;
      // 後端嘅 message 好多時係俾開發者睇嘅英文 debug 字串，唔係設計俾用戶
      // 睇（見 errorMessages.js 的說明）。已知係英文嗰啲用 code 揀返中文；
      // 業務邏輯層本身已經用中文 publicMessage 嘅 code 唔喺表入面，原樣用
      // errorBody.message。
      const apiError = new ApiError({
        status: response.status,
        code,
        message: ERROR_CODE_MESSAGES[code] || errorBody.message || response.statusText || "請求失敗",
        details: errorBody.details,
        requestId: envelope?.meta?.requestId || response.headers.get("x-request-id"),
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"))
      });

      if (response.status === 401) {
        this.onUnauthorized();
      }

      throw apiError;
    }

    return envelope?.data ?? null;
  }

  /**
   * 下載一個二進位檔案（media 預覽／下載用）。唔可以借用 request()：成功
   * 回應本身就係檔案內容，唔係 `{success,data}` 信封，套用 parseJsonBody()
   * 只會炸開。認證同逾時處理跟 request() 一致，失敗回應（框架仍然回 JSON
   * envelope）盡量解出 code／message，解唔到就退回 HTTP 狀態本身。
   *
   * 呢個方法存在嘅原因：認證用 Authorization header 帶 Bearer token（唔係
   * cookie），瀏覽器嘅 `<img src>`／`<a href>` 冇辦法夾帶自訂 header，所以
   * 唔可以直接指向下載端點嘅 URL——一定要用 fetch 先攞到 blob，先再用
   * `URL.createObjectURL()` 俾 `<img>` 顯示或者觸發下載。
   */
  async getBlob(path, { signal } = {}) {
    const url = buildUrl(this.baseUrl, path);
    const headers = {};
    const token = this.getToken();
    if (token) {
      headers[this.authHeaderName] = `${this.authScheme} ${token}`;
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response;
    try {
      response = await this.fetchImpl(url, { method: "GET", headers, signal: requestSignal });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new ApiError({ code: "TIMEOUT", message: "請求逾時，請稍後再試", cause: error });
      }
      if (signal?.aborted) {
        throw error;
      }
      throw new ApiError({ code: "NETWORK_ERROR", message: "網路錯誤，請檢查連線", cause: error });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const envelope = await parseJsonBody(response);
      const errorBody = envelope?.error || {};
      const code = errorBody.code || `HTTP_${response.status}`;
      const apiError = new ApiError({
        status: response.status,
        code,
        message: ERROR_CODE_MESSAGES[code] || errorBody.message || response.statusText || "請求失敗",
        details: errorBody.details,
        requestId: envelope?.meta?.requestId || response.headers.get("x-request-id")
      });

      if (response.status === 401) {
        this.onUnauthorized();
      }

      throw apiError;
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get("content-type") || "application/octet-stream"
    };
  }
}

function buildUrl(baseUrl, path, params) {
  const url = new URL(path, baseUrl);

  if (url.origin !== new URL(baseUrl).origin) {
    throw new Error(`拒絕跨 origin 請求：${path} 解析成 ${url.origin}，非 baseUrl origin`);
  }

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

async function parseJsonBody(response) {
  try {
    return await response.json();
  } catch {
    // 冇 body（例如 204）或者根本唔係 JSON（例如反向 proxy 直接回嘅 502 HTML）。
    return null;
  }
}

function parseRetryAfter(headerValue) {
  if (!headerValue) {
    return null;
  }

  const seconds = Number(headerValue);
  return Number.isFinite(seconds) ? seconds : null;
}

function defaultGetToken() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  return localStorage.getItem(authConfig.tokenStorageKey);
}

export const httpClient = new HttpClient();
