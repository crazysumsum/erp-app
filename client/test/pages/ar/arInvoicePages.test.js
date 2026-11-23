import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { listInvoices: vi.fn(), getInvoice: vi.fn(), confirmInvoice: vi.fn(), cancelInvoice: vi.fn(), voidInvoice: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import ar from "@/services/ar.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import List, { page as listPage } from "@/pages/ar/ArInvoicesPage.vue";
import Detail, { page as detailPage } from "@/pages/ar/ArInvoiceDetailPage.vue";
import menuConfig from "@config/menu.js";
import { useSessionStore } from "@/stores/session.js";

const row = { id: 8, number: "INV-2026-000008", status: "CONFIRMED", version: 2, customerId: 3, customerCode: "C3", customerName: "快照客戶", currencyCode: "HKD", currencyDecimalPlaces: 2,
  invoiceDate: "2026-11-19", dueDate: "2026-12-19", totalAmount: "100.0100", allocatedAmount: "0.0000", outstandingAmount: "100.0100", createdAt: 1795000000000, updatedAt: 1795000000000, allowedActions: ["void"] };
const lines = [
  { id: 1, lineNo: 1, shipmentId: 51, shipmentLineId: 61, salesOrderId: 71, salesOrderLineId: 81, skuCode: "SKU1", skuName: "盒裝貨品", baseUomCode: "EA", salesUomCode: "BOX", toBaseFactor: 12, quantity: "24", unitPrice: "33.3350", lineAmount: "66.6700" },
  { id: 2, lineNo: 2, shipmentId: 51, shipmentLineId: 62, salesOrderId: 71, salesOrderLineId: 82, skuCode: "SKU2", skuName: "散裝貨品", baseUomCode: "EA", salesUomCode: "BOX", toBaseFactor: 12, quantity: "13", unitPrice: "31.9999", lineAmount: "33.3332" }
];
const detail = { ...row, paymentTermCode: "N30", paymentTermName: "30 天", dueDateOverridden: false, dueDateReason: null, notes: "<b>備註</b>", voidReason: null, createdByLabel: "建立者",
  confirmedByLabel: "確認者", confirmedAt: 1795000000000, voidedByLabel: null, voidedAt: null, lines, allocations: [] };
const draft = { ...detail, id: 9, number: null, status: "DRAFT", confirmedAt: null, allowedActions: ["confirm", "cancel"] };
const VIEW = ["ar.view"], MANAGE = ["ar.view", "ar.invoice.mgmt"];
const button = (label) => wrapper.findAll("button,a").find((node) => node.text() === label);
let wrapper;

async function open(path, permissions = VIEW) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...listPage, component: List }, { ...detailPage, component: Detail }] });
  await router.push(path);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return router;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  ar.listInvoices.mockResolvedValue({ rows: [row], rowsNumber: 1 });
  ar.getInvoice.mockResolvedValue(detail);
  confirm.mockResolvedValue(true);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; });

describe("AR 發票列表", () => {
  it("要 ar.view；掛喺應收管理菜單；顯示幣別小數位嘅金額同查看連結", async () => {
    expect(listPage.requires.permissions).toEqual(VIEW);
    expect(detailPage.requires.permissions).toEqual(VIEW);
    expect(menuConfig.groups.some((group) => group.name === listPage.menu.group)).toBe(true);
    await open("/ar/invoices");
    expect(wrapper.text()).toContain("INV-2026-000008");
    expect(wrapper.text()).toContain("C3 — 快照客戶");
    expect(wrapper.text()).toContain("HKD 100.01");
    expect(button("查看").attributes("href")).toBe("/ar/invoices/8");
    expect(ar.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ page: 1, rowsPerPage: 20 }));
  });
  it("開票按鈕要 ar.invoice.mgmt 同 fulfillment.view；只有 view 唔見", async () => {
    await open("/ar/invoices");
    expect(button("由出貨開立發票")).toBeUndefined();
    wrapper.unmount();
    await open("/ar/invoices", [...MANAGE]);
    expect(button("由出貨開立發票")).toBeUndefined();
    wrapper.unmount();
    await open("/ar/invoices", [...MANAGE, "fulfillment.view"]);
    expect(button("由出貨開立發票").attributes("href")).toBe("/ar/invoices/new");
  });
  it("URL 還原 filter 同頁碼；未知 key 唔送；搜尋寫入 URL", async () => {
    const router = await open("/ar/invoices?q=INV&status=DRAFT&currencyCode=HKD&invoiceDateFrom=2026-11-01&invoiceDateTo=2026-11-30&outstandingOnly=true&page=3&evil=1");
    const call = ar.listInvoices.mock.calls[0][0];
    expect(call).toMatchObject({ q: "INV", status: "DRAFT", currencyCode: "HKD", invoiceDateFrom: "2026-11-01", invoiceDateTo: "2026-11-30", outstandingOnly: "true", page: 3 });
    expect(call).not.toHaveProperty("evil");
    await wrapper.find('input[aria-label="發票編號／客戶"]').setValue("C3");
    await button("搜尋").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ q: "C3", page: "1" });
  });
  it("頁碼唔合法用第 1 頁；草稿冇編號有文字；空結果有提示", async () => {
    ar.listInvoices.mockResolvedValueOnce({ rows: [{ ...row, number: null, status: "DRAFT" }], rowsNumber: 1 });
    await open("/ar/invoices?page=-1");
    expect(ar.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    expect(wrapper.text()).toContain("（草稿未編號）");
    ar.listInvoices.mockResolvedValue({ rows: [], rowsNumber: 0 });
    wrapper.unmount();
    await open("/ar/invoices?status=VOID");
    expect(wrapper.text()).toContain("沒有符合條件的發票");
  });
});

describe("AR 發票詳情", () => {
  it("總額用 server 嘅 totalAmount，唔係各行相加；行金額照 4 位小數；數量按銷售單位換算", async () => {
    await open("/ar/invoices/8");
    expect(wrapper.text()).toContain("HKD 100.01");
    expect(wrapper.text()).not.toContain("100.0032");
    expect(wrapper.text()).toContain("66.67");
    expect(wrapper.text()).toContain("33.3332");
    expect(wrapper.text()).toContain("2 BOX × 33.3350");
    expect(wrapper.text()).toContain("13 EA（單價 31.9999 為每 BOX）");
    expect(wrapper.text()).toContain("<b>備註</b>");
    expect(wrapper.text()).toContain("未有核銷");
  });
  it("有 fulfillment.view 先將出貨單 ID 做成連結", async () => {
    await open("/ar/invoices/8");
    expect(wrapper.findAll("a").some((node) => node.attributes("href") === "/shipments/51")).toBe(false);
    wrapper.unmount();
    await open("/ar/invoices/8", [...VIEW, "fulfillment.view"]);
    expect(wrapper.findAll("a").filter((node) => node.attributes("href") === "/shipments/51")).toHaveLength(2);
  });
  it("只有 ar.view：server 有 action 都唔出命令按鈕", async () => {
    await open("/ar/invoices/8");
    expect(button("作廢發票")).toBeUndefined();
  });
  it("id 唔係正整數：唔發 HTTP，顯示找不到", async () => {
    await open("/ar/invoices/..%2Fx", MANAGE);
    expect(ar.getInvoice).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("找不到這張發票");
  });
  it("確認草稿：先問確認，送 version 同 eventId，成功後重新讀取", async () => {
    ar.getInvoice.mockResolvedValue(draft);
    ar.confirmInvoice.mockResolvedValue({ id: 9, number: "INV-2026-000009", status: "CONFIRMED", version: 2, replayed: false });
    await open("/ar/invoices/9", MANAGE);
    expect(button("取消草稿")).toBeDefined();
    await button("確認發票").trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    const [id, body] = ar.confirmInvoice.mock.calls[0];
    expect(id).toBe("9");
    expect(body).toEqual({ version: 2, eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    expect(notifySuccess).toHaveBeenCalledWith("已確認，發票編號 INV-2026-000009。");
    expect(ar.getInvoice).toHaveBeenCalledTimes(2);
  });
  it("取消確認對話框就唔發命令", async () => {
    ar.getInvoice.mockResolvedValue(draft);
    confirm.mockResolvedValue(false);
    await open("/ar/invoices/9", MANAGE);
    await button("取消草稿").trigger("click");
    await flushPromises();
    expect(ar.cancelInvoice).not.toHaveBeenCalled();
  });
  it("作廢要原因；取消原因對話框唔發；有原因就送 trim 過嘅原因", async () => {
    await open("/ar/invoices/8", MANAGE);
    promptReason.mockResolvedValueOnce(null);
    await button("作廢發票").trigger("click");
    await flushPromises();
    expect(ar.voidInvoice).not.toHaveBeenCalled();
    promptReason.mockResolvedValueOnce("  客戶取消訂單  ");
    ar.voidInvoice.mockResolvedValue({ id: 8, number: "INV-2026-000008", status: "VOID", version: 3, replayed: false });
    await button("作廢發票").trigger("click");
    await flushPromises();
    expect(ar.voidInvoice.mock.calls[0][1]).toMatchObject({ version: 2, reason: "客戶取消訂單" });
  });
  it("結果未確定：顯示 banner，重試用同一個 eventId；期間命令按鈕停用", async () => {
    ar.getInvoice.mockResolvedValue(draft);
    ar.confirmInvoice.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
      .mockResolvedValueOnce({ id: 9, number: "INV-2026-000009", status: "CONFIRMED", version: 2, replayed: false });
    await open("/ar/invoices/9", MANAGE);
    await button("確認發票").trigger("click");
    await flushPromises();
    expect(notifyError).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="ar-invoice-uncertain"]').exists()).toBe(true);
    expect(button("確認發票").attributes("disabled")).toBeDefined();
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = ar.confirmInvoice.mock.calls.map(([, body]) => body);
    expect(second).toEqual(first);
    expect(wrapper.find('[data-testid="ar-invoice-uncertain"]').exists()).toBe(false);
    expect(notifySuccess).toHaveBeenCalled();
  });
  it("版本衝突：顯示 server 訊息並重新讀取；下次係新 eventId", async () => {
    ar.getInvoice.mockResolvedValue(draft);
    ar.cancelInvoice.mockRejectedValueOnce(Object.assign(new Error("單據已被其他人修改，請重新載入後再操作"), { code: "VERSION_CONFLICT", status: 409 }))
      .mockResolvedValueOnce({ id: 9, number: null, status: "CANCELLED", version: 3, replayed: false });
    await open("/ar/invoices/9", MANAGE);
    await button("取消草稿").trigger("click");
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith("單據已被其他人修改，請重新載入後再操作");
    expect(ar.getInvoice).toHaveBeenCalledTimes(2);
    await button("取消草稿").trigger("click");
    await flushPromises();
    const [first, second] = ar.cancelInvoice.mock.calls.map(([, body]) => body.eventId);
    expect(second).not.toBe(first);
  });
});
