import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/user.js", () => ({
  default: { changeOwnPassword: vi.fn() },
  service: { name: "user" }
}));

import userService from "@/services/user.js";
import ChangePasswordPage from "@/pages/ChangePasswordPage.vue";
import { useSessionStore } from "@/stores/session.js";

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/password/change", name: "change-password", component: ChangePasswordPage },
      { path: "/login", name: "login", component: { template: "<div>login</div>" } },
      { path: "/", name: "home", component: { template: "<div>home</div>" } }
    ]
  });
  await router.push("/password/change");
  await router.isReady();

  const wrapper = mount(ChangePasswordPage, { global: { plugins: [Quasar, router] } });
  return { wrapper, router };
}

async function fillAndSubmit(wrapper, { password, newPassword, confirmPassword }) {
  const inputs = wrapper.findAll("input");
  await inputs[0].setValue(password);
  await inputs[1].setValue(newPassword);
  await inputs[2].setValue(confirmPassword);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

describe("pages/ChangePasswordPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userService.changeOwnPassword.mockReset();
  });

  it("成功改密碼之後清 session、導去登入頁，並顯示提示", async () => {
    userService.changeOwnPassword.mockResolvedValue({ changed: true });
    const { wrapper, router } = await mountPage();
    const session = useSessionStore();
    session.user = { id: 1, username: "amy", displayName: "Amy", mustChangePassword: false };
    // clear() 底層會真正碰 localStorage（tokenStorage.js）——同 AppTopbar 嘅
    // session.logout 一樣 mock 走，避免測試環境嘅 jsdom localStorage 細節
    // 滲入呢一頁淨係想釘住嘅行為（叫咗 clear、跟住導去登入頁）。
    session.clear = vi.fn();

    await fillAndSubmit(wrapper, {
      password: "OldPassw0rd",
      newPassword: "NewPassw0rd123",
      confirmPassword: "NewPassw0rd123"
    });
    await router.isReady();

    expect(userService.changeOwnPassword).toHaveBeenCalledWith({
      password: "OldPassw0rd",
      newPassword: "NewPassw0rd123"
    });
    expect(session.clear).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("新密碼同確認新密碼唔一致就唔會提交", async () => {
    userService.changeOwnPassword.mockResolvedValue({ changed: true });
    const { wrapper } = await mountPage();
    const session = useSessionStore();
    session.user = { id: 1, username: "amy", displayName: "Amy", mustChangePassword: false };

    await fillAndSubmit(wrapper, {
      password: "OldPassw0rd",
      newPassword: "NewPassw0rd123",
      confirmPassword: "唔一樣"
    });

    expect(userService.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("後端拒絕（例如 PASSWORD_TOO_WEAK）會顯示錯誤訊息，唔會導頁", async () => {
    userService.changeOwnPassword.mockRejectedValue(
      new Error("Password does not meet policy: 至少需要 12 個字元")
    );
    const { wrapper, router } = await mountPage();
    const session = useSessionStore();
    session.user = { id: 1, username: "amy", displayName: "Amy", mustChangePassword: false };

    await fillAndSubmit(wrapper, {
      password: "OldPassw0rd",
      newPassword: "short1A",
      confirmPassword: "short1A"
    });

    expect(wrapper.text()).toContain("至少需要 12 個字元");
    expect(router.currentRoute.value.name).toBe("change-password");
  });

  it("強制模式（mustChangePassword）換文案，冇取消按鈕", async () => {
    const { wrapper } = await mountPage();
    const session = useSessionStore();
    session.user = { id: 1, username: "amy", displayName: "Amy", mustChangePassword: true };
    await flushPromises();

    expect(wrapper.text()).toContain("首次登入必須修改密碼");
    expect(wrapper.findAll("button").some((btn) => btn.text() === "取消")).toBe(false);
  });

  it("非強制模式有取消按鈕", async () => {
    const { wrapper } = await mountPage();
    const session = useSessionStore();
    session.user = { id: 1, username: "amy", displayName: "Amy", mustChangePassword: false };
    await flushPromises();

    expect(wrapper.findAll("button").some((btn) => btn.text() === "取消")).toBe(true);
  });
});
