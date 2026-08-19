import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QDrawer, Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";
import AppShell from "@/framework/layout/AppShell.vue";

function fixturePages() {
  return [
    {
      page: {
        name: "orderList",
        path: "/orders",
        title: "訂單管理",
        menu: { group: "system", order: 10, icon: "receipt" }
      },
      component: {}
    }
  ];
}

async function mountAppShell({ pages = fixturePages() } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: AppShell,
        children: [{ path: "orders", name: "orderList", component: { template: "<div class='child'>訂單內容</div>" } }]
      }
    ]
  });
  await router.push("/orders");
  await router.isReady();

  const wrapper = mount(AppShell, {
    props: { pages },
    global: { plugins: [Quasar, router] }
  });

  return { wrapper, router };
}

describe("AppShell", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("渲染子路由嘅元件", async () => {
    const { wrapper } = await mountAppShell();

    expect(wrapper.find(".child").exists()).toBe(true);
  });

  it("Sidebar 顯示由 pages prop 算出嚟嘅菜單項目", async () => {
    const { wrapper } = await mountAppShell();

    expect(wrapper.text()).toContain("訂單管理");
  });

  it("撳 Topbar 嘅選單按鈕會切換 drawer 開關", async () => {
    const { wrapper } = await mountAppShell();
    const drawer = wrapper.findComponent(QDrawer);

    expect(drawer.props("modelValue")).toBe(true);

    await wrapper.find('button[aria-label="開關側邊欄"]').trigger("click");

    expect(drawer.props("modelValue")).toBe(false);
  });
});
