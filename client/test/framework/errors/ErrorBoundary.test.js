import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "@/framework/errors/ErrorBoundary.vue";

const ThrowingChild = {
  setup() {
    throw new Error("頁面壞咗");
  },
  template: "<div />"
};

const OkChild = { template: "<div class='ok'>正常內容</div>" };

async function mountBoundary(routes) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(routes[0].path);
  await router.isReady();

  const wrapper = mount(
    { components: { ErrorBoundary }, template: "<ErrorBoundary><router-view /></ErrorBoundary>" },
    { global: { plugins: [Quasar, router] } }
  );

  return { wrapper, router };
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Vue 就算俾 onErrorCaptured 攔截咗，都仲會將錯誤送去 console.error，
    // 測試唔想睇住呢啲雜訊。
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("子元件正常就直接渲染", async () => {
    const { wrapper } = await mountBoundary([{ path: "/", component: OkChild }]);

    expect(wrapper.find(".ok").exists()).toBe(true);
  });

  it("子元件拋錯會顯示錯誤區塊，唔係白畫面", async () => {
    const { wrapper } = await mountBoundary([{ path: "/", component: ThrowingChild }]);

    expect(wrapper.text()).toContain("頁面壞咗");
    expect(wrapper.find(".q-banner").exists()).toBe(true);
  });

  it("轉去第二頁會清返 error，唔會繼續顯示舊嗰個錯誤畫面", async () => {
    const { wrapper, router } = await mountBoundary([
      { path: "/broken", component: ThrowingChild },
      { path: "/ok", component: OkChild }
    ]);
    expect(wrapper.find(".q-banner").exists()).toBe(true);

    await router.push("/ok");

    expect(wrapper.find(".q-banner").exists()).toBe(false);
    expect(wrapper.find(".ok").exists()).toBe(true);
  });
});
