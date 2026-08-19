import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";
import App from "@/App.vue";

/**
 * Phase 1 的煙霧測試：證明工具鏈是通的——Vue SFC 編譯得起來、Quasar 的元件在
 * 測試環境裡註冊得到、`@/` 與 `@config/` 兩個 alias 解析得到。
 *
 * Phase 3 加咗路由之後，App.vue 本身淨係得 `<router-view />`，實際畫面內容
 * （原本嘅系統狀態卡片，連同 Quasar 元件有冇解析成功嘅斷言）搬去
 * pages/HomePage.vue，見 test/pages/home.test.js。呢度只需要證明 router-view
 * 會渲染出當前路由嘅元件、Quasar plugin 唔會令 mount 失敗。
 */
describe("client toolchain", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("mounts the app with vue-router registered and renders the routed component", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "probe", component: { template: "<div class='probe'>ok</div>" } }]
    });
    router.push("/");
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [Quasar, router] } });

    expect(wrapper.find(".probe").exists()).toBe(true);
  });
});
