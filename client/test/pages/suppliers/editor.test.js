import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { getById: vi.fn(), completeness: vi.fn(), update: vi.fn(), changeCode: vi.fn() },
  service: { name: "supplier" }
}));
vi.mock("@/services/businessMaster.js", () => ({
  default: { currencyList: vi.fn(), paymentTermList: vi.fn() },
  service: { name: "businessMaster" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import businessMasterService from "@/services/businessMaster.js";
import supplierService from "@/services/supplier.js";
import SupplierDetailPage, { page } from "@/pages/suppliers/SupplierDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const DETAIL = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "draft", version: 2,
  website: "", generalPhone: "2123 4567", generalEmail: "orders@example.test", notes: "",
  createdAt: 100, updatedAt: 200, addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
};

let currentWrapper;

async function mountPage() {
  supplierService.getById.mockResolvedValue(DETAIL);
  supplierService.completeness.mockResolvedValue({
    supplierId: 7,
    issues: [],
    warnings: [{ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" }]
  });
  businessMasterService.currencyList.mockResolvedValue({ rows: [
    { code: "HKD", name: "Hong Kong Dollar", version: 3 },
    { code: "USD", name: "US Dollar", version: 4 }
  ], rowsNumber: 2 });
  businessMasterService.paymentTermList.mockResolvedValue({ rows: [
    { id: 9, code: "NET30", name: "Net 30", version: 2 }
  ], rowsNumber: 1 });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, component: SupplierDetailPage },
      { path: "/suppliers", component: { template: "<div>supplier list</div>" } }
    ]
  });
  await router.push("/suppliers/7");
  await router.isReady();
  useSessionStore().user = { id: 1, permissions: ["supplier.view", "supplier.mgmt"], roles: [] };
  currentWrapper = mount({ render: () => h(RouterView) }, {
    global: { plugins: [Quasar, router] }, attachTo: document.body
  });
  await flushPromises();
  return { router, body: new DOMWrapper(document.body) };
}

function field(body, label) {
  return body.findAll(".q-field").find((candidate) => candidate.text().includes(label)).find("input, textarea");
}

describe("Supplier general editor", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });
  afterEach(() => { currentWrapper?.unmount(); currentWrapper = null; });

  it("updates editable root fields while keeping Supplier Code outside the normal payload", async () => {
    supplierService.update.mockImplementation(async (_id, payload) => ({ ...DETAIL, ...payload, version: 3 }));
    const { body } = await mountPage();
    expect(body.text()).toContain("資料完整度提示（不影響啟用）");
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Updated Supplier");
    await field(body, "備註（選填）").setValue("Updated note");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(supplierService.update).toHaveBeenCalledWith(7, expect.objectContaining({
      supplierName: "Updated Supplier", notes: "Updated note", version: 2
    }));
    expect(supplierService.update.mock.calls[0][1]).not.toHaveProperty("supplierCode");
    expect(body.text()).toContain("版本 3");
  });

  it("keeps the user's draft visible when a stale update reloads the latest Supplier", async () => {
    supplierService.update.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" }));
    const { body } = await mountPage();
    supplierService.getById.mockResolvedValue({ ...DETAIL, supplierName: "Other User Value", version: 3 });
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("My Preserved Draft");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("輸入仍然保留");
    expect(field(body, "Supplier Name *").element.value).toBe("My Preserved Draft");
    expect(body.text()).toContain("最新版本 3");
  });

  it("uses a separate password-and-reason flow for controlled Supplier Code correction", async () => {
    supplierService.changeCode.mockResolvedValue({ ...DETAIL, supplierCode: "SUP-NEW", version: 3 });
    const { body } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("受控修正 Supplier Code")).trigger("click");
    await field(body, "新 Supplier Code *").setValue("SUP-NEW");
    await field(body, "修正原因 *").setValue("Correct onboarding typo");
    await field(body, "目前密碼 *").setValue("secret");
    await body.findAll("button").find((button) => button.text().includes("確認修正")).trigger("click");
    await flushPromises();
    expect(supplierService.changeCode).toHaveBeenCalledWith(7, {
      supplierCode: "SUP-NEW", reason: "Correct onboarding typo", password: "secret", version: 2
    });
    expect(body.text()).toContain("SUP-NEW");
  });

  it("prompts before leaving a dirty general editor", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { body, router } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Dirty Supplier");
    await router.push("/suppliers");
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未儲存"));
    confirm.mockRestore();
  });
});
