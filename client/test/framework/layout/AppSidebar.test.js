import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import AppSidebar from "@/framework/layout/AppSidebar.vue";

function menu() {
  return [
    {
      name: "system",
      label: "系統管理",
      icon: "settings",
      items: [
        { name: "orderList", path: "/orders", title: "訂單管理", icon: "receipt" },
        { name: "userList", path: "/users", title: "用戶管理", icon: "people" }
      ]
    }
  ];
}

async function mountSidebar({ currentRouteName = "orderList" } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/orders", name: "orderList", component: { template: "<div />" } },
      { path: "/users", name: "userList", component: { template: "<div />" } }
    ]
  });
  await router.push({ name: currentRouteName });
  await router.isReady();

  const wrapper = mount(AppSidebar, { props: { menu: menu() }, global: { plugins: [Quasar, router] } });
  return wrapper;
}

describe("AppSidebar", () => {
  it("列出每個 group 嘅項目", async () => {
    const wrapper = await mountSidebar();

    expect(wrapper.text()).toContain("系統管理");
    expect(wrapper.text()).toContain("訂單管理");
    expect(wrapper.text()).toContain("用戶管理");
  });

  it("當前路由對應嘅項目會 highlight", async () => {
    const wrapper = await mountSidebar({ currentRouteName: "orderList" });

    const activeItem = wrapper.findAll(".q-item--active");
    expect(activeItem).toHaveLength(1);
    expect(activeItem[0].text()).toContain("訂單管理");
  });
});
