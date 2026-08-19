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
