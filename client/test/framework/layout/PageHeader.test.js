import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import PageHeader from "@/framework/layout/PageHeader.vue";

async function mountPageHeader({ meta = {}, slots } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "current", component: PageHeader, meta }]
  });
  await router.push("/");
  await router.isReady();

  return mount(PageHeader, { global: { plugins: [router] }, slots });
}

describe("PageHeader", () => {
  it("由當前路由 meta.title 出標題", async () => {
    const wrapper = await mountPageHeader({ meta: { title: "訂單管理" } });

    expect(wrapper.text()).toContain("訂單管理");
  });

  it("meta.menuGroup 對得上 config 入面嘅 group 就顯示麵包屑", async () => {
    const wrapper = await mountPageHeader({ meta: { title: "訂單管理", menuGroup: "system" } });

    expect(wrapper.text()).toContain("系統管理");
  });

  it("冇 menuGroup 就唔顯示麵包屑", async () => {
    const wrapper = await mountPageHeader({ meta: { title: "首頁" } });

    expect(wrapper.text()).not.toContain("系統管理");
  });

  it("actions slot 俾頁面放操作按鈕", async () => {
    const wrapper = await mountPageHeader({
      meta: { title: "訂單管理" },
      slots: { actions: "<button>新增</button>" }
    });

    expect(wrapper.find("button").text()).toBe("新增");
  });
});
