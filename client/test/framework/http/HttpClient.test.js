import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/framework/http/ApiError.js";
import { HttpClient } from "@/framework/http/HttpClient.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body
  };
}

function blobResponse(blob, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    blob: async () => blob,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    }
  };
}

describe("HttpClient", () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  it("回傳信封入面嘅 data，唔攞成個信封", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 1 }, meta: { requestId: "r1" } })
    );
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    const result = await client.get("/api/v1/widgets/1");

    expect(result).toEqual({ id: 1 });
  });

  it("有 token 就帶 Authorization header", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    const client = new HttpClient({ fetchImpl, getToken: () => "abc123" });

    await client.get("/api/v1/me");

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer abc123");
  });

  it("冇 token 就唔帶 Authorization header", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await client.get("/api/v1/health");

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("idempotent: true 帶 Idempotency-Key header", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await client.post("/api/v1/orders", { body: { total: 10 }, idempotent: true });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });

  it("冇指定 idempotencyKey 時，每次呼叫都係新 key", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await client.post("/api/v1/orders", { body: { total: 10 }, idempotent: true });
    await client.post("/api/v1/orders", { body: { total: 10 }, idempotent: true });

    const [, firstInit] = fetchImpl.mock.calls[0];
    const [, secondInit] = fetchImpl.mock.calls[1];
    expect(firstInit.headers["Idempotency-Key"]).not.toBe(secondInit.headers["Idempotency-Key"]);
  });

  it("指定 idempotencyKey 時，重試會重用同一個 key", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    const client = new HttpClient({ fetchImpl, getToken: () => null });
    const idempotencyKey = "fixed-key-123";

    await client.post("/api/v1/orders", { body: { total: 10 }, idempotent: true, idempotencyKey });
    await client.post("/api/v1/orders", { body: { total: 10 }, idempotent: true, idempotencyKey });

    const [, firstInit] = fetchImpl.mock.calls[0];
    const [, secondInit] = fetchImpl.mock.calls[1];
    expect(firstInit.headers["Idempotency-Key"]).toBe(idempotencyKey);
    expect(secondInit.headers["Idempotency-Key"]).toBe(idempotencyKey);
  });

  it("query params 會被序列化到 URL", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: [], meta: {} }));
    const client = new HttpClient({ fetchImpl, baseUrl: "http://localhost:3000", getToken: () => null });

    await client.get("/api/v1/orders", { params: { page: 2, status: "open" } });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/v1/orders?page=2&status=open");
  });

  it("後端回 success:false 就拋 ApiError，帶埋 code/message/details/requestId", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "無效輸入", details: { field: "name" } },
          meta: { requestId: "req-1" }
        },
        { status: 422 }
      )
    );
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await expect(client.post("/api/v1/widgets", { body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "VALIDATION_ERROR",
      message: "無效輸入",
      details: { field: "name" },
      requestId: "req-1"
    });
  });

  it("401 會叫 onUnauthorized", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse({ success: false, error: { code: "UNAUTHENTICATED", message: "未登入" }, meta: {} }, { status: 401 })
    );
    const onUnauthorized = vi.fn();
    const client = new HttpClient({ fetchImpl, getToken: () => null, onUnauthorized });

    await expect(client.get("/api/v1/me")).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("429 會讀 Retry-After header", async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "TOO_MANY_REQUESTS", message: "太多請求" }, meta: {} },
        { status: 429, headers: { "retry-after": "5" } }
      )
    );
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await expect(client.get("/api/v1/widgets")).rejects.toMatchObject({ retryAfterSeconds: 5 });
  });

  it("5xx 冇合法 JSON body 都攞到 requestId（由 header 取）", async () => {
    fetchImpl.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: { get: (name) => (name.toLowerCase() === "x-request-id" ? "req-502" : null) },
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      }
    });
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await expect(client.get("/api/v1/widgets")).rejects.toMatchObject({
      status: 502,
      code: "HTTP_502",
      requestId: "req-502"
    });
  });

  it("逾時會拋 ApiError code TIMEOUT", async () => {
    fetchImpl.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new DOMException("Aborted", "AbortError");
          reject(error);
        });
      });
    });
    const client = new HttpClient({ fetchImpl, getToken: () => null, timeoutMs: 5 });

    await expect(client.get("/api/v1/slow")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("外部 signal 取消時原樣拋出 AbortError，唔包做 ApiError", async () => {
    const controller = new AbortController();
    fetchImpl.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    const pending = client.get("/api/v1/slow", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fetch 本身失敗（網路錯誤）拋 ApiError code NETWORK_ERROR", async () => {
    fetchImpl.mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new HttpClient({ fetchImpl, getToken: () => null });

    await expect(client.get("/api/v1/widgets")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  describe("FormData（multipart 上傳）", () => {
    it("body 係 FormData 就原樣傳俾 fetch，唔會 JSON.stringify 或者手動設 Content-Type", async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: { id: 1 }, meta: {} }));
      const client = new HttpClient({ fetchImpl, getToken: () => null });
      const formData = new FormData();
      formData.append("kind", "image");

      await client.post("/api/v1/items/1/media/upload", { body: formData });

      const [, init] = fetchImpl.mock.calls[0];
      expect(init.body).toBe(formData);
      // 冇設 Content-Type：留返俾瀏覽器自己生成正確嘅 boundary。人手設一個
      // 唔會同 fetch 實際產生嘅 body 對得上。
      expect(init.headers["Content-Type"]).toBeUndefined();
    });

    it("普通物件 body 一樣照舊 JSON.stringify＋設 Content-Type（FormData 支援唔影響現有行為）", async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
      const client = new HttpClient({ fetchImpl, getToken: () => null });

      await client.post("/api/v1/widgets", { body: { name: "x" } });

      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.body).toBe(JSON.stringify({ name: "x" }));
    });
  });

  describe("getBlob()（二進位下載）", () => {
    it("成功回應回 { blob, contentType }，唔套用 JSON envelope 解析", async () => {
      const fakeBlob = new Blob(["fake-image-bytes"], { type: "image/png" });
      fetchImpl.mockResolvedValue(blobResponse(fakeBlob, { headers: { "content-type": "image/png" } }));
      const client = new HttpClient({ fetchImpl, getToken: () => "tok" });

      const result = await client.getBlob("/api/v1/item-media/1/download");

      expect(result.blob).toBe(fakeBlob);
      expect(result.contentType).toBe("image/png");
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers.Authorization).toBe("Bearer tok");
      expect(init.method).toBe("GET");
    });

    it("失敗回應解返 JSON envelope 嘅 code／message，拋 ApiError", async () => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ success: false, error: { code: "MEDIA_NOT_FOUND", message: "找不到這個檔案" }, meta: {} }, { status: 404 })
      );
      const client = new HttpClient({ fetchImpl, getToken: () => null });

      await expect(client.getBlob("/api/v1/item-media/999/download")).rejects.toMatchObject({
        status: 404,
        code: "MEDIA_NOT_FOUND",
        message: "找不到這個檔案"
      });
    });

    it("401 會叫 onUnauthorized", async () => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ success: false, error: { code: "UNAUTHENTICATED", message: "未登入" }, meta: {} }, { status: 401 })
      );
      const onUnauthorized = vi.fn();
      const client = new HttpClient({ fetchImpl, getToken: () => null, onUnauthorized });

      await expect(client.getBlob("/api/v1/item-media/1/download")).rejects.toThrow(ApiError);
      expect(onUnauthorized).toHaveBeenCalledOnce();
    });
  });

  describe("設備簽章", () => {
    it("signed 嘅請求會簽 pathname 同真正送出嗰個 body 字串", async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
      const signRequest = vi.fn(async () => ({ "X-Device-Id": "abc" }));
      const client = new HttpClient({ fetchImpl, getToken: () => null, signRequest });

      await client.post("/api/v1/user/login", {
        body: { username: "sam" },
        params: { lang: "zh" },
        signed: true,
        includePublicKey: true
      });

      const [signed] = signRequest.mock.calls[0];
      expect(signed.method).toBe("POST");
      // 後端簽嘅係 req.path——唔含 origin 亦唔含 query string。呢兩邊唔一致
      // 嘅話，每一個帶 params 嘅簽名請求都會驗簽失敗。
      expect(signed.path).toBe("/api/v1/user/login");
      // 簽嘅要係真正送出去嗰個字串。重新 stringify 一次可能得出唔同嘅 bytes，
      // 令簽章時好時壞。
      const [, init] = fetchImpl.mock.calls[0];
      expect(signed.body).toBe(init.body);
      expect(signed.includePublicKey).toBe(true);
      expect(init.headers["X-Device-Id"]).toBe("abc");
    });

    it("冇 body 嗰陣簽 undefined，同後端對空 body 嘅處理一致", async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
      const signRequest = vi.fn(async () => ({}));
      const client = new HttpClient({ fetchImpl, getToken: () => null, signRequest });

      await client.post("/api/v1/user/token/refresh", { signed: true });

      expect(signRequest.mock.calls[0][0].body).toBeUndefined();
    });

    it("冇設定簽名器就即刻炸，唔會靜靜哋send一個冇簽章嘅請求", async () => {
      const client = new HttpClient({ fetchImpl, getToken: () => null });

      // 靜默唔簽會令請求一路去到後端先被拒，而錯誤係「簽章缺失」——查極都查唔到
      // 原因喺客戶端根本冇裝簽名器。
      await expect(client.post("/api/v1/user/login", { signed: true })).rejects.toThrow(
        /no signRequest was configured/
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("冇 signed 嘅請求唔會叫簽名器", async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
      const signRequest = vi.fn(async () => ({}));
      const client = new HttpClient({ fetchImpl, getToken: () => null, signRequest });

      await client.get("/api/v1/user/me");

      // 每個請求都簽會令 nonce 表嘅寫入量變成同請求量一樣，而簽章對呢啲請求
      // 冇任何作用——帶住 JWT 已經足夠。
      expect(signRequest).not.toHaveBeenCalled();
    });
  });
});

describe("HttpClient 預設值", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null, meta: {} }));
    globalThis.localStorage = {
      store: { "erp.token": "stored-token" },
      getItem(key) {
        return this.store[key] ?? null;
      }
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  });

  it("預設 getToken 由 localStorage 讀 config 指定嘅 key", async () => {
    const { HttpClient: FreshHttpClient } = await import("@/framework/http/HttpClient.js");
    const client = new FreshHttpClient();

    await client.get("/api/v1/me");

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer stored-token");
  });

});
