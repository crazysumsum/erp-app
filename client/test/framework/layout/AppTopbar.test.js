import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppTopbar from "@/framework/layout/AppTopbar.vue";
import { useSessionStore } from "@/stores/session.js";

async function mountTopbar() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } }
    ]
  });
  await router.push("/");
  await router.isReady();

  const wrapper = mount(AppTopbar, { global: { plugins: [Quasar, router] } });
  return { wrapper, router };
}

describe("AppTopbar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("顯示當前登入用戶嘅 displayName", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };

    const { wrapper } = await mountTopbar();

    expect(wrapper.text()).toContain("Sam Wong");
  });

  it("撳選單按鈕會 emit toggle-drawer", async () => {
    const { wrapper } = await mountTopbar();

    await wrapper.find('button[aria-label="開關側邊欄"]').trigger("click");

    expect(wrapper.emitted("toggle-drawer")).toHaveLength(1);
  });

  it("撳登出按鈕會叫 session.logout() 再轉去登入頁", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };
    session.logout = vi.fn().mockResolvedValue();

    const { wrapper, router } = await mountTopbar();
    await wrapper.find('button[aria-label="登出"]').trigger("click");
    await flushPromises();
    await router.isReady();

    expect(session.logout).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("後端登出請求失敗都照樣轉去登入頁（本地 session 已經清咗）", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };
    session.logout = vi.fn().mockRejectedValue(new Error("network"));

    const { wrapper, router } = await mountTopbar();
    await wrapper.find('button[aria-label="登出"]').trigger("click");
    await flushPromises();
    await router.isReady();

    expect(router.currentRoute.value.name).toBe("login");
  });
});

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
