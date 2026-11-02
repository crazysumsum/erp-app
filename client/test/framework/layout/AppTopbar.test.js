import { DOMWrapper, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import appConfig from "@config/app.js";
import AppTopbar from "@/framework/layout/AppTopbar.vue";
import { useSessionStore } from "@/stores/session.js";

async function mountTopbar() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } },
      { path: "/profile", name: "profile", component: { template: "<div />" } },
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

  it("左上角有公司「M」徽章同 appConfig.title，唔會再顯示舊嘅「ERP System」", async () => {
    const { wrapper } = await mountTopbar();

    expect(wrapper.find(".app-topbar__brand-monogram").text()).toBe("M");
    expect(wrapper.text()).toContain(appConfig.title);
    expect(wrapper.text()).not.toContain("ERP System");
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
  it("ST040-H01 長名稱完整保留於原生 label 與開關選單的 accessible name", async () => {
    const session = useSessionStore();
    const name = "Synthetic Stocktake browser with a deliberately long complete name";
    session.user = { id: 1, displayName: name, roles: [], permissions: [] };
    const { wrapper } = await mountTopbar();
    const button = wrapper.find(".q-btn-dropdown");
    expect(wrapper.findComponent({ name: "QBtnDropdown" }).props("label")).toBe(name);
    expect(button.find(".block").text()).toBe(name);
    expect(button.attributes("aria-label")).toContain(name);
    expect(button.attributes("aria-expanded")).toBe("false");
    await button.trigger("click");
    await flushPromises();
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(button.attributes("aria-label")).toContain(name);
    const controls = button.attributes("aria-controls");
    expect(controls).toBeTruthy(); expect(document.getElementById(controls)).not.toBeNull();
    await button.trigger("click"); await flushPromises();
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(button.attributes("aria-label")).toContain(name);
    expect(button.attributes("aria-controls")).toBeUndefined();
  });

  it("ST040-H02 Unicode 與字面 markup 保留為純文字，更新姓名不改 session", async () => {
    const session = useSessionStore();
    const name = "陳大文倉庫盤點操作員 <b>literal</b> 中文名稱";
    session.user = { id: 1, displayName: name, roles: [], permissions: [] };
    const { wrapper } = await mountTopbar();
    expect(wrapper.find(".q-btn-dropdown .block").text()).toBe(name);
    expect(wrapper.find(".q-btn-dropdown b").exists()).toBe(false);
    expect(session.user.displayName).toBe(name);
    session.user.displayName = "Sam";
    await flushPromises();
    expect(wrapper.find(".q-btn-dropdown .block").text()).toBe("Sam");
    expect(wrapper.find(".q-btn-dropdown").attributes("aria-label")).toContain("Sam");
    expect(session.user.displayName).toBe("Sam");
  });

  it("ST040-H03 長名稱仍可透過真實選單前往個人資料", async () => {
    useSessionStore().user = { id: 1, displayName: "Synthetic Stocktake browser", roles: [], permissions: [] };
    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "個人資料");
    expect(router.currentRoute.value.name).toBe("profile");
  });

  it("ST040-H04 長名稱仍可透過真實選單前往修改密碼", async () => {
    useSessionStore().user = { id: 1, displayName: "Synthetic Stocktake browser", roles: [], permissions: [] };
    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "修改密碼");
    expect(router.currentRoute.value.name).toBe("change-password");
  });

  it("ST040-H05 長名稱登出只呼叫一次既有 action 並前往登入", async () => {
    const session = useSessionStore();
    session.user = { id: 1, displayName: "Synthetic Stocktake browser", roles: [], permissions: [] };
    session.logout = vi.fn().mockResolvedValue();
    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "登出");
    expect(session.logout).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("ST040-H06 長名稱的登出 action 拒絕仍走原有登入導航", async () => {
    const session = useSessionStore();
    session.user = { id: 1, displayName: "Synthetic Stocktake browser", roles: [], permissions: [] };
    session.logout = vi.fn().mockRejectedValue(new Error("network"));
    const { wrapper, router } = await mountTopbar();
    await openMenuAndClick(wrapper, "登出");
    expect(session.logout).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe("login");
  });
});

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
