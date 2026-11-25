import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page, { page } from "@/pages/inventory/OpeningPage.vue";
import inventory from "@/services/inventory.js";
import { useSessionStore } from "@/stores/session.js";

vi.mock("@/services/inventory.js", () => ({ default: {
  getOpeningControl: vi.fn(), getOpening: vi.fn(), goLive: vi.fn()
} }));

const PRE = { status: "PRE_GO_LIVE", version: 7 };
const LIVE = { status: "LIVE", version: 8 };
let wrapper;

beforeEach(() => {
  vi.resetAllMocks();
  inventory.getOpeningControl.mockResolvedValue(PRE);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; });

async function open() {
  const pinia = createPinia(), session = useSessionStore(pinia);
  session.user = { id: 1, roles: [], permissions: ["inventory.view", "inventory.mgmt"] };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: Page }] });
  await router.push(page.path);
  await router.isReady();
  wrapper = mount(Page, { global: { plugins: [Quasar, router, pinia], stubs: {
    InventoryHighRiskDialog: { props: ["modelValue", "execute"],
      template: '<button v-if="modelValue" type="button" @click="execute(\'synthetic fixture\')">確認結案</button>' }
  } } });
  await flushPromises();
  return wrapper;
}

const button = label => wrapper.findAll("button").find(value => value.text() === label);
async function submit(version = "7") {
  await wrapper.get("#opening-go-live-version").setValue(version);
  await wrapper.get("#opening-go-live-reason").setValue("兩倉對帳已簽核");
  await wrapper.get('form[aria-labelledby="opening-go-live"]').trigger("submit");
  await button("確認結案").trigger("click");
  await flushPromises();
}

it("G3 direct navigation reads LIVE and hides both Opening writes", async () => {
  inventory.getOpeningControl.mockResolvedValue(LIVE);
  await open();
  expect(wrapper.text()).toContain("期初匯入已關閉");
  expect(wrapper.find("#opening-file").exists()).toBe(false);
  expect(wrapper.find("#opening-go-live-version").exists()).toBe(false);
  expect(wrapper.find("#opening-job-id").exists()).toBe(true);
});

it("G3 requires the signed version and uses its value for the one-way confirmation", async () => {
  inventory.goLive.mockResolvedValue({ ...LIVE, postedAt: 1, operationId: 42 });
  await open();
  expect(button("核對並結案").attributes("disabled")).toBeDefined();
  await submit();
  expect(inventory.goLive).toHaveBeenCalledOnce();
  expect(inventory.goLive).toHaveBeenCalledWith({
    expectedVersion: 7, reason: "兩倉對帳已簽核", eventId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
    password: "synthetic fixture"
  }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(wrapper.text()).toContain("期初匯入已關閉");
  expect(wrapper.find("#opening-file").exists()).toBe(false);
});

it("G3 version conflict requires another status read and an explicit reconciliation version", async () => {
  inventory.goLive.mockRejectedValue(Object.assign(new Error("版本已改"), { status: 409, code: "VERSION_CONFLICT" }));
  await open();
  await submit("6");
  expect(inventory.goLive.mock.calls[0][0].expectedVersion).toBe(6);
  expect(wrapper.text()).toContain("重新對帳");
  expect(wrapper.find("#opening-go-live-version").exists()).toBe(false);
  inventory.getOpeningControl.mockResolvedValue({ status: "PRE_GO_LIVE", version: 8 });
  await button("重新讀取結案狀態").trigger("click");
  await flushPromises();
  expect(wrapper.get("#opening-go-live-version").element.value).toBe("");
  expect(button("核對並結案").attributes("disabled")).toBeDefined();
  expect(inventory.goLive).toHaveBeenCalledOnce();
});
