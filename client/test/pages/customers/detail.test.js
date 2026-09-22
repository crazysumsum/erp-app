import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: { getById: vi.fn(), update: vi.fn() }, service: { name: "customer" } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import customerService from "@/services/customer.js";
import CustomerDetailPage, { page } from "@/pages/customers/CustomerDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const CUSTOMER = { id: 7, code: "CUS-007", legalName: "Evergreen Customer", displayName: "Evergreen", tradingName: "Evergreen", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, generalPhone: "", generalEmail: "", website: "", notes: "", status: "draft", version: 2, addresses: [], contacts: [], identifiers: [], credit: { configured: false, status: "not_configured" } };
const Host = { render: () => h(RouterView) };
async function mountPage() {
  customerService.getById.mockResolvedValue(CUSTOMER);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: CustomerDetailPage }, { path: "/customers", component: { template: "<div>customers</div>" } }] });
  await router.push("/customers/7"); await router.isReady();
  useSessionStore().user = { id: 1, permissions: ["customer.view", "customer.mgmt"], roles: [] };
  const wrapper = mount(Host, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises(); return { wrapper, body: new DOMWrapper(document.body) };
}
function input(body, label) { return body.findAll(".q-field").find((field) => field.text().includes(label)).find("input, textarea"); }
describe("pages/customers/CustomerDetailPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });
  it("renders root detail, Draft status and accessible basic edit", async () => {
    expect(page.requires.permissions).toEqual(["customer.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("CUS-007"); expect(body.text()).toContain("草稿");
    await body.find('button[aria-label="編輯一般資料"]').trigger("click"); await flushPromises();
    expect(body.find('button[aria-label="儲存一般資料"]').exists()).toBe(true);
  });
  it("keeps the edit visible when the server reports a version conflict", async () => {
    customerService.update.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" }));
    const { body } = await mountPage();
    await body.find('button[aria-label="編輯一般資料"]').trigger("click");
    await input(body, "修改原因 *").setValue("修正客戶名稱");
    await body.find('button[aria-label="儲存一般資料"]').trigger("click"); await flushPromises();
    expect(body.text()).toContain("已被其他人修改");
    expect(body.findAll("button").some((button) => button.text() === "載入最新資料")).toBe(true);
    await body.findAll("button").find((button) => button.text() === "載入最新資料").trigger("click"); await flushPromises();
    expect(customerService.getById).toHaveBeenCalledTimes(2);
  });
  it("uses the customer in the successful command response", async () => {
    customerService.update.mockResolvedValueOnce({ customer: { ...CUSTOMER, legalName: "Evergreen Customer Limited", version: 3 } });
    const { body } = await mountPage();
    await body.find('button[aria-label="編輯一般資料"]').trigger("click");
    await input(body, "法定名稱 *").setValue("Evergreen Customer Limited");
    await input(body, "修改原因 *").setValue("更正法定名稱");
    await body.find('button[aria-label="儲存一般資料"]').trigger("click"); await flushPromises();
    expect(body.text()).toContain("Evergreen Customer Limited");
    expect(body.text()).toContain("版本 3");
  });
});
