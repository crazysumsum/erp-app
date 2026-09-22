import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { getById: vi.fn(), completeness: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/services/supplierBank.js", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), deactivate: vi.fn(), reveal: vi.fn() },
  service: { name: "supplierBank" }
}));

import supplierService from "@/services/supplier.js";
import supplierBankService from "@/services/supplierBank.js";
import SupplierDetailPage, { page } from "@/pages/suppliers/SupplierDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const DETAIL = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "suspended", version: 2,
  website: "", generalPhone: "2123 4567", generalEmail: "orders@example.test", notes: "",
  createdAt: 100, updatedAt: 200, addresses: [], contacts: [], identifiers: [],
  // 呢個欄位伺服器永遠唔會填 —— toSupplierDetailResponse 個 `bankAccounts` 有一個
  // default `[]` 而冇任何 caller 傳嘢俾佢。留返喺度係因為 response schema 要求佢
  // 存在，但任何斷言都唔可以靠佢：真嘅遮罩清單由 SupplierBankPanel 自己叫
  // GET /suppliers/:id/bank-accounts 攞。
  bankAccounts: [],
  warnings: [{ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" }]
};

async function mountPage({ permissions = ["supplier.view"], detail = DETAIL } = {}) {
  if (detail instanceof Error) supplierService.getById.mockRejectedValue(detail);
  else supplierService.getById.mockResolvedValue(detail);
  supplierService.completeness.mockResolvedValue({ supplierId: 7, issues: [], warnings: detail?.warnings ?? [] });
  supplierBankService.list.mockResolvedValue([
    { id: 4, bankName: "Test Bank", accountHolderName: "Evergreen Trading", maskedAccountNumber: "•••• 6789",
      status: "active", isDefault: true, version: 1 }
  ]);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SupplierDetailPage }] });
  await router.push("/suppliers/7"); await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("pages/suppliers/SupplierDetailPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("requires supplier.view and shows status, completeness and masked bank data", async () => {
    expect(page.requires.permissions).toEqual(["supplier.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("SUP-007");
    expect(body.text()).toContain("已暫停");
    expect(body.text()).toContain("不可用於新採購");
    expect(body.text()).toContain("尚未設定採購用途地址");
    await body.findAll(".q-tab").find((item) => item.text().includes("銀行資料")).trigger("click");
    await flushPromises();
    expect(supplierBankService.list).toHaveBeenCalledWith(7);
    expect(body.text()).toContain("•••• 6789");
    expect(body.text()).not.toContain("accountNumber");
    // 開個 tab 唔等於攞明文：AC-023。
    expect(supplierBankService.reveal).not.toHaveBeenCalled();
  });

  it("distinguishes not-found and generic loading failures", async () => {
    const missing = Object.assign(new Error("找不到這個供應商"), { code: "SUPPLIER_NOT_FOUND" });
    const { body } = await mountPage({ detail: missing });
    expect(body.text()).toContain("找不到這個供應商");
    expect(body.text()).toContain("返回供應商列表");
  });
});
