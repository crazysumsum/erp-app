import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QSelect, Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: { create: vi.fn(), checkDuplicates: vi.fn() }, service: { name: "customer" } }));
vi.mock("@/services/businessMaster.js", () => ({ default: { currencyList: vi.fn() }, service: { name: "businessMaster" } }));
vi.mock("@/services/customerApproval.js", () => ({ default: { eligibleApprovers: vi.fn() }, service: { name: "customerApproval" } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import businessMasterService from "@/services/businessMaster.js";
import customerApprovalService from "@/services/customerApproval.js";
import customerService from "@/services/customer.js";
import CustomerCreatePage, { page } from "@/pages/customers/CustomerCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

const Host = { render: () => h(RouterView) };
let wrapper;
async function mountPage() {
  businessMasterService.currencyList.mockResolvedValue({ rows: [{ code: "HKD", name: "Hong Kong Dollar" }], rowsNumber: 1 });
  customerService.checkDuplicates.mockResolvedValue({ code: [], legalName: [], tradingName: [] });
  customerApprovalService.eligibleApprovers.mockResolvedValue({ items: [{ id: 2, username: "checker", displayName: "Checker" }] });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: CustomerCreatePage }, { path: "/customers", component: { template: "<div>customers</div>" } }] });
  await router.push(page.path); await router.isReady();
  useSessionStore().user = { id: 1, permissions: ["customer.mgmt"], roles: [] };
  wrapper = mount(Host, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { router, body: new DOMWrapper(document.body) };
}
function input(body, label) { return body.findAll(".q-field").find((field) => field.text().includes(label)).find("input, textarea"); }
async function fillRequired(body) {
  await input(body, "客戶代碼 *").setValue(" CUS-041 ");
  await input(body, "法定名稱 *").setValue(" Evergreen Customer ");
  const currency = wrapper.findAllComponents(QSelect).find((select) => select.props("label") === "預設貨幣（選填）");
  currency.vm.$emit("update:modelValue", "HKD"); await flushPromises();
}
describe("pages/customers/CustomerCreatePage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });
  afterEach(() => { wrapper?.unmount(); wrapper = null; });
  it("requires customer.mgmt and saves a minimal Draft", async () => {
    expect(page.requires.permissions).toEqual(["customer.mgmt"]);
    customerService.create.mockResolvedValue({ customer: { id: 41, code: "CUS-041", status: "draft" } });
    const { body } = await mountPage(); await fillRequired(body);
    await body.find('button[aria-label="儲存 Draft"]').trigger("click"); await flushPromises();
    expect(customerService.create).toHaveBeenCalledWith(expect.objectContaining({ customerCode: "CUS-041", legalName: "Evergreen Customer", defaultCurrencyCode: "HKD", activate: false }));
    expect(body.text()).toContain("CUS-041"); expect(body.text()).toContain("草稿");
  });
  it("asks for an approver only after the server requires activation approval", async () => {
    customerService.create.mockRejectedValueOnce(Object.assign(new Error("需要審批人"), { code: "APPROVER_REQUIRED" })).mockResolvedValueOnce({ customer: { id: 41, code: "CUS-041", status: "pending_approval" } });
    const { body } = await mountPage(); await fillRequired(body);
    await body.find('button[aria-label="啟用或提交審批"]').trigger("click"); await flushPromises();
    expect(customerApprovalService.eligibleApprovers).toHaveBeenCalledWith({ excludeUserId: 1 });
    const approver = wrapper.findAllComponents(QSelect).find((select) => select.props("label") === "審批人 *");
    approver.vm.$emit("update:modelValue", 2); await flushPromises();
    await body.find('button[aria-label="確認提交審批"]').trigger("click"); await flushPromises();
    expect(customerService.create).toHaveBeenLastCalledWith(expect.objectContaining({ activate: true, approverUserId: 2 }));
  });
});
