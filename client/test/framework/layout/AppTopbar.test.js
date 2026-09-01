import { DOMWrapper, mount } from "@vue/test-utils";
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
      { path: "/login", name: "login", component: { template: "<div />" } },
      { path: "/password/change", name: "change-password", component: { template: "<div />" } }
    ]
  });
  await router.push("/");
  await router.isReady();

  const wrapper = mount(AppTopbar, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  return { wrapper, router };
}

// q-btn-dropdown 嘅選單同 q-dialog 一樣用 <teleport> 掛去 document.body 底下
// 獨立嘅 portal，唔喺 wrapper 自己個 root element 度——所以要開咗個選單之後
// 用 DOMWrapper(document.body) 先搵到入面嘅 q-item。
async function openMenuAndClick(wrapper, itemLabel) {
  await wrapper.find(".q-btn-dropdown").trigger("click");
  await flushPromises();

  // .text() 埋埋個 icon 名（q-icon 用一個 aria-hidden 嘅 <span> 存放圖示
  // 名，textContent 一樣攞得到），所以用 includes 而唔係 exact match。
  const body = new DOMWrapper(document.body);
  const item = body.findAll(".q-item").find((el) => el.text().includes(itemLabel));
  await item.trigger("click");
  await flushPromises();
}

describe("AppTopbar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  it("下拉選單嘅標籤係當前登入用戶嘅 displayName", async () => {
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

  it("落拉選單揀「修改密碼」會轉去 change-password 頁", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };

    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "修改密碼");

    expect(router.currentRoute.value.name).toBe("change-password");
  });

  it("落拉選單揀「登出」會叫 session.logout() 再轉去登入頁", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };
    session.logout = vi.fn().mockResolvedValue();

    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "登出");

    expect(session.logout).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("後端登出請求失敗都照樣轉去登入頁（本地 session 已經清咗）", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", roles: [], permissions: [] };
    session.logout = vi.fn().mockRejectedValue(new Error("network"));

    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "登出");

    expect(router.currentRoute.value.name).toBe("login");
  });
});

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
