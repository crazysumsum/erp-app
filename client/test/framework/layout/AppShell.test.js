import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import AppShell from "@/framework/layout/AppShell.vue";

/**
 * Phase 4 嘅 AppShell 淨係一個佔位嘅 `<router-view />`——真正嘅版面（QLayout
 * + QDrawer + QToolbar）係 Phase 5 嘅工作。呢度只需要證明佢會將父路由嘅
 * child route 渲染出嚟，等 buildRoutes.js 嘅 nesting 有嘢好掛。
 */
describe("AppShell", () => {
  it("渲染子路由嘅元件", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: AppShell, children: [{ path: "", component: { template: "<div class='child'>ok</div>" } }] }]
    });
    router.push("/");
    await router.isReady();

    const wrapper = mount({ template: "<router-view />" }, { global: { plugins: [router] } });

    expect(wrapper.find(".child").exists()).toBe(true);
  });
});
