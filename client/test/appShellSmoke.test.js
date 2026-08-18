import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App.vue";

/**
 * Phase 1 的煙霧測試：證明工具鏈是通的——Vue SFC 編譯得起來、Quasar 的元件在
 * 測試環境裡註冊得到、`@/` 與 `@config/` 兩個 alias 解析得到。
 *
 * 真正的元件測試從 Phase 2 的 HttpClient 開始。這裡刻意不去斷言畫面長什麼樣：
 * 這一頁是臨時的，Phase 5 會被 AppShell 換掉，對它的排版下斷言只會製造一份
 * 到時候要一起刪的測試。
 */
describe("client toolchain", () => {
  beforeEach(() => {
    // fetch 在 jsdom 裡存在但會真的發請求。測試不該依賴一個跑著的後端。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { status: "ok", database: "connected", timestamp: "2026-08-18T00:00:00+08:00" }
        })
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the app with Quasar registered", async () => {
    const wrapper = mount(App, { global: { plugins: [Quasar] } });
    await flushPromises();

    expect(wrapper.text()).toContain("系統狀態");
    // Quasar 的元件有被解析：沒註冊成功的話 <q-card> 會原樣留在 DOM 裡，
    // 而不是渲染成帶 q-card class 的 div。
    expect(wrapper.find(".q-card").exists()).toBe(true);
  });

  it("reads the API base URL from the shared config", async () => {
    mount(App, { global: { plugins: [Quasar] } });
    await flushPromises();

    // 這一句同時驗到 @config alias 解析得到，以及元件真的用了那份設定而不是
    // 自己寫死一個網址。
    const httpConfig = (await import("@config/http.js")).default;
    expect(fetch).toHaveBeenCalledWith(`${httpConfig.baseUrl}/api/v1/health`);
  });
});

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
