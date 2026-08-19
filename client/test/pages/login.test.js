import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/LoginPage.vue";
import { useSessionStore } from "@/stores/session.js";

async function mountLoginPage({ redirect } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: LoginPage },
      { path: "/", name: "home", component: { template: "<div>home</div>" } },
      { path: "/orders", name: "orders", component: { template: "<div>orders</div>" } }
    ]
  });

  await router.push({ path: "/login", query: redirect ? { redirect } : {} });
  await router.isReady();

  const wrapper = mount(LoginPage, { global: { plugins: [Quasar, router] } });

  return { wrapper, router };
}

async function fillAndSubmit(wrapper, { username, password }) {
  const inputs = wrapper.findAll("input");
  await inputs[0].setValue(username);
  await inputs[1].setValue(password);
  await wrapper.find("form").trigger("submit.prevent");
  await flushPromises();
}

describe("pages/LoginPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("成功登入之後跳去 redirect 指定嘅路徑", async () => {
    const { wrapper, router } = await mountLoginPage({ redirect: "/orders" });
    const session = useSessionStore();
    session.login = vi.fn().mockResolvedValue({ id: 1 });

    await fillAndSubmit(wrapper, { username: "sam", password: "secret" });

    expect(session.login).toHaveBeenCalledWith("sam", "secret");
    expect(router.currentRoute.value.name).toBe("orders");
  });

  it("冇 redirect 就跳去 homePath", async () => {
    const { wrapper, router } = await mountLoginPage();
    const session = useSessionStore();
    session.login = vi.fn().mockResolvedValue({ id: 1 });

    await fillAndSubmit(wrapper, { username: "sam", password: "secret" });

    expect(router.currentRoute.value.name).toBe("home");
  });

  it("登入失敗顯示錯誤訊息，唔會導頁", async () => {
    const { wrapper, router } = await mountLoginPage();
    const session = useSessionStore();
    session.login = vi.fn().mockRejectedValue(new Error("Invalid username or password"));

    await fillAndSubmit(wrapper, { username: "sam", password: "wrong" });

    expect(wrapper.text()).toContain("Invalid username or password");
    expect(router.currentRoute.value.name).toBe("login");
  });
});
