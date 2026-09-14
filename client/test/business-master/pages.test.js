import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/businessMaster.js", () => ({
  default: {
    currencyList: vi.fn(),
    createCurrency: vi.fn(),
    updateCurrency: vi.fn(),
    previewCurrencyImpact: vi.fn(),
    activateCurrency: vi.fn(),
    deactivateCurrency: vi.fn(),
    changeCurrencyPrecision: vi.fn(),
    paymentTermList: vi.fn(),
    createPaymentTerm: vi.fn(),
    updatePaymentTerm: vi.fn(),
    previewPaymentTermImpact: vi.fn(),
    activatePaymentTerm: vi.fn(),
    deactivatePaymentTerm: vi.fn(),
    changePaymentTermRule: vi.fn(),
    calculatePaymentTerm: vi.fn(),
    auditList: vi.fn()
  },
  service: { name: "businessMaster" }
}));

import businessMasterService from "@/services/businessMaster.js";
import CurrenciesPage, { page as currenciesPage } from "@/pages/business-master/CurrenciesPage.vue";
import PaymentTermsPage, { page as paymentTermsPage } from "@/pages/business-master/PaymentTermsPage.vue";
import BusinessMasterAuditPage, { page as auditPage } from "@/pages/business-master/BusinessMasterAuditPage.vue";
import ImpactConfirmationDialog from "@/components/business-master/ImpactConfirmationDialog.vue";
import { previewDueDate } from "@/components/business-master/presentation.js";
import { useSessionStore } from "@/stores/session.js";

const CURRENCY = {
  code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2,
  status: "ACTIVE", version: 1, createdAt: 1, updatedAt: 1
};
const TERM = {
  id: 1, code: "NET30", name: "30 日", description: "發票後 30 日",
  calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 1,
  createdAt: 1, updatedAt: 1
};

async function mountPage(component, path, permissions = ["business_master.view", "business_master.mgmt"]) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: path.split("?")[0], component }] });
  await router.push(path);
  await router.isReady();
  useSessionStore().user = { id: 1, username: "sam", permissions, roles: [] };
  const wrapper = mount(component, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body), router };
}

describe("TC-016 Business Master pages", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    businessMasterService.currencyList.mockResolvedValue({ rows: [CURRENCY], rowsNumber: 1 });
    businessMasterService.paymentTermList.mockResolvedValue({ rows: [TERM], rowsNumber: 1 });
  });

  it("兩頁掛在 system menu，查閱與管理權限分離", () => {
    expect(currenciesPage).toMatchObject({
      path: "/system/business-master/currencies",
      requires: { permissions: ["business_master.view"] },
      menu: { group: "system" }
    });
    expect(paymentTermsPage).toMatchObject({
      path: "/system/business-master/payment-terms",
      requires: { permissions: ["business_master.view"] },
      menu: { group: "system" }
    });
    expect(currenciesPage.menu.order).not.toBe(paymentTermsPage.menu.order);
  });

  it("Currency server table 顯示 code、精度及文字狀態，view-only 不顯示管理動作", async () => {
    const { wrapper } = await mountPage(CurrenciesPage, currenciesPage.path, ["business_master.view"]);

    expect(businessMasterService.currencyList).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    expect(wrapper.text()).toContain("HKD");
    expect(wrapper.text()).toContain("2 位");
    expect(wrapper.text()).toContain("啟用");
    expect(wrapper.text()).not.toContain("新增貨幣");
  });

  it("Payment Term 顯示規則；due date preview 不受本機時區影響", async () => {
    const { wrapper } = await mountPage(PaymentTermsPage, paymentTermsPage.path);

    expect(wrapper.text()).toContain("NET30");
    expect(wrapper.text()).toContain("淨 30 日");
    expect(previewDueDate("2024-02-28", "NET_DAYS", 1)).toEqual({ dueDate: "2024-02-29", requiresManualDueDate: false });
    expect(previewDueDate("2025-01-01", "NET_DAYS", 0)).toEqual({ dueDate: "2025-01-01", requiresManualDueDate: false });
    expect(previewDueDate("2025-01-01", "NET_DAYS", 3650)).toEqual({ dueDate: "2034-12-30", requiresManualDueDate: false });
    expect(previewDueDate("2025-01-01", "NET_DAYS", null)).toBeNull();
    expect(previewDueDate("2025-01-01", "NET_DAYS", -1)).toBeNull();
    expect(previewDueDate("2025-01-01", "NET_DAYS", 3651)).toBeNull();
    expect(previewDueDate("9999-12-31", "NET_DAYS", 1)).toBeNull();
    expect(previewDueDate("2025-02-10", "END_OF_MONTH", null)).toEqual({ dueDate: "2025-02-28", requiresManualDueDate: false });
    expect(previewDueDate("2025-02-10", "MANUAL", null)).toEqual({ dueDate: null, requiresManualDueDate: true });
  });

  it("高影響對話框顯示每個 consumer 計數，unknown 時禁止確認", async () => {
    const wrapper = mount(ImpactConfirmationDialog, {
      global: { plugins: [Quasar] },
      props: {
        modelValue: true,
        entityLabel: "HKD — Hong Kong Dollar",
        operationLabel: "停用貨幣",
        changes: [{ label: "狀態", before: "啟用", after: "已停用" }],
        preview: {
          results: [{ checkerId: "sales", status: "UNKNOWN", activeDefaultCount: 2, openUseCount: 3, historicalCount: 4 }]
        }
      },
      attachTo: document.body
    });
    await flushPromises();
    const body = new DOMWrapper(document.body);

    expect(body.text()).toContain("HKD — Hong Kong Dollar");
    expect(body.text()).toContain("sales");
    expect(body.text()).toContain("2");
    expect(body.text()).toContain("影響尚未能確定");
    expect(body.find('button[aria-label="確認執行停用貨幣"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("高影響摘要缺少 required consumer 時 fail closed", async () => {
    const wrapper = mount(ImpactConfirmationDialog, {
      global: { plugins: [Quasar] },
      props: {
        modelValue: true,
        entityLabel: "HKD — Hong Kong Dollar",
        operationLabel: "停用貨幣",
        preview: { results: [] }
      },
      attachTo: document.body
    });
    await flushPromises();
    const body = new DOMWrapper(document.body);

    expect(body.text()).toContain("影響尚未能確定");
    expect(body.find('button[aria-label="確認執行停用貨幣"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("模組稽核頁不出現在 menu，並沿用 URL entity filter", async () => {
    businessMasterService.auditList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(auditPage.menu).toBeUndefined();
    expect(auditPage.requires).toEqual({ permissions: ["business_master.view"] });

    await mountPage(
      BusinessMasterAuditPage,
      "/system/business-master/audit?entityType=CURRENCY&entityKey=HKD",
      ["business_master.view"]
    );

    expect(businessMasterService.auditList).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "CURRENCY", entityKey: "HKD", page: 1
    }));
  });

  it("稽核頁忽略無效日期 query，不因 URL 被竄改而崩潰", async () => {
    businessMasterService.auditList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await mountPage(
      BusinessMasterAuditPage,
      "/system/business-master/audit?from=not-a-timestamp&to=Infinity",
      ["business_master.view"]
    );

    expect(businessMasterService.auditList).toHaveBeenCalledWith(expect.objectContaining({
      from: undefined,
      to: undefined
    }));
  });
});
