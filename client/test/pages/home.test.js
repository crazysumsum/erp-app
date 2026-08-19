import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/pages/HomePage.vue";

/**
 * 原本喺 test/appShellSmoke.test.js 對 App.vue 落嘅斷言，Phase 3 加路由之後
 * 隨住畫面內容搬去 pages/HomePage.vue 一齊搬過嚟（見 App.vue 頂部註解）。
 */
describe("pages/HomePage.vue", () => {
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

  it("mounts with Quasar registered", async () => {
    const wrapper = mount(HomePage, { global: { plugins: [Quasar] } });
    await flushPromises();

    expect(wrapper.text()).toContain("系統狀態");
    // Quasar 的元件有被解析：沒註冊成功的話 <q-card> 會原樣留在 DOM 裡，
    // 而不是渲染成帶 q-card class 的 div。
    expect(wrapper.find(".q-card").exists()).toBe(true);
  });

  it("reads the API base URL from the shared config", async () => {
    mount(HomePage, { global: { plugins: [Quasar] } });
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
