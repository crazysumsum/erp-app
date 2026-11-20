import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { listInvoices: vi.fn(), listReceipts: vi.fn(), getReceipt: vi.fn(), createReceipt: vi.fn(), confirmReceipt: vi.fn(), cancelReceipt: vi.fn(),
  voidReceipt: vi.fn(), allocateReceipt: vi.fn(), unapplyAllocation: vi.fn(), getAging: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import ar from "@/services/ar.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import List, { page as listPage } from "@/pages/ar/ArReceiptsPage.vue";
import Create, { page as createPage } from "@/pages/ar/ArReceiptCreatePage.vue";
import Detail, { page as detailPage } from "@/pages/ar/ArReceiptDetailPage.vue";
import Aging, { page as agingPage } from "@/pages/ar/ArAgingPage.vue";
import { useSessionStore } from "@/stores/session.js";

const invoice = (id, outstanding, extra = {}) => ({ id, number: `INV-2026-00000${id}`, status: "CONFIRMED", version: 2, customerId: 3, customerCode: "C3", customerName: "客戶3", currencyCode: "HKD",
  currencyDecimalPlaces: 2, invoiceDate: "2026-11-01", dueDate: "2026-12-01", totalAmount: "100.0000", allocatedAmount: "0.0000", outstandingAmount: outstanding, createdAt: 1, updatedAt: 1, allowedActions: [], ...extra });
const receiptRow = { id: 5, number: "RCT-2026-000005", status: "CONFIRMED", version: 4, customerId: 3, customerCode: "C3", customerName: "客戶3", currencyCode: "HKD", currencyDecimalPlaces: 2,
  receiptDate: "2026-11-19", amount: "150.0000", allocatedAmount: "0.0000", availableAmount: "150.0000", paymentMethod: "CHEQUE", reference: "CHQ-1", createdAt: 1795000000000,
  updatedAt: 1795000000000, allowedActions: ["allocate", "void"] };
const allocation = { id: 31, invoiceId: 1, invoiceNumber: "INV-2026-000001", invoiceDate: "2026-11-01", dueDate: "2026-12-01", invoiceTotalAmount: "100.0000", invoiceOutstandingAmount: "0.0000",
  amount: "100.0000", status: "ACTIVE", createdByLabel: "會計", createdAt: 1795000000000, unappliedByLabel: null, unappliedAt: null, allowedActions: ["unapply"] };
const detail = { ...receiptRow, notes: null, voidReason: null, createdByLabel: "會計", confirmedByLabel: "會計", confirmedAt: 1795000000000, voidedByLabel: null, voidedAt: null, allocations: [] };
const VIEW = ["ar.view"], MANAGE = ["ar.view", "ar.receipt.mgmt"];
const button = (label) => wrapper.findAll("button,a").find((node) => node.text() === label);
const input = (label) => wrapper.find(`input[aria-label="${label}"]`);
let wrapper;

async function open(path, permissions = VIEW) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...listPage, component: List }, { ...createPage, component: Create }, { ...detailPage, component: Detail },
    { ...agingPage, component: Aging }, { path: "/ar/invoices/:id", component: { render: () => h("p", "invoice") } }] });
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
  ar.listReceipts.mockResolvedValue({ rows: [receiptRow], rowsNumber: 1 });
  ar.getReceipt.mockResolvedValue(detail);
  ar.listInvoices.mockResolvedValue({ rows: [invoice(1, "100.0000"), invoice(2, "80.0050")], rowsNumber: 2 });
  confirm.mockResolvedValue(true);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; });

describe("AR 收款列表及登記", () => {
  it("列表要 ar.view；顯示可核銷額同方式；登記按鈕要 ar.receipt.mgmt", async () => {
    expect([listPage, detailPage, agingPage].map((value) => value.requires.permissions)).toEqual([VIEW, VIEW, VIEW]);
    expect(createPage.requires.permissions).toEqual(MANAGE);
    await open("/ar/receipts?status=CONFIRMED&receiptDateFrom=2026-11-01&evil=1");
    expect(ar.listReceipts.mock.calls[0][0]).toMatchObject({ status: "CONFIRMED", receiptDateFrom: "2026-11-01", page: 1 });
    expect(ar.listReceipts.mock.calls[0][0]).not.toHaveProperty("evil");
    expect(wrapper.text()).toContain("HKD 150.00");
    expect(wrapper.text()).toContain("支票");
    expect(button("查看").attributes("href")).toBe("/ar/receipts/5");
    expect(button("登記收款")).toBeUndefined();
    wrapper.unmount();
    await open("/ar/receipts", MANAGE);
    expect(button("登記收款").attributes("href")).toBe("/ar/receipts/new");
  });
  it("登記：客戶及幣別由有未收發票嘅客戶揀；金額超出幣別小數位唔准送；成功去詳情", async () => {
    ar.createReceipt.mockResolvedValue({ id: 6, number: null, status: "DRAFT", version: 1, replayed: false });
    const router = await open("/ar/receipts/new", MANAGE);
    expect(ar.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ outstandingOnly: true }));
    await wrapper.findComponent({ name: "QSelect" }).vm.$emit("update:modelValue", "3:HKD");
    await input("金額").setValue("10.005");
    await flushPromises();
    expect(wrapper.text()).toContain("最多 2 位小數");
    expect(button("登記收款草稿").attributes("disabled")).toBeDefined();
    await input("金額").setValue("10.05");
    await input("參考號").setValue("  TT-1  ");
    await button("登記收款草稿").trigger("click");
    await flushPromises();
    expect(ar.createReceipt.mock.calls[0][0]).toEqual({ customerId: 3, currencyCode: "HKD", receiptDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u), amount: "10.05",
      paymentMethod: "BANK_TRANSFER", reference: "TT-1", eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    expect(router.currentRoute.value.path).toBe("/ar/receipts/6");
  });
  it("登記被拒：顯示 server 訊息，保留輸入；結果未確定就鎖住並用同一 eventId 重試", async () => {
    ar.createReceipt.mockRejectedValueOnce(Object.assign(new Error("業務日期不可在未來"), { code: "AR_DATE_IN_FUTURE", status: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
      .mockResolvedValueOnce({ id: 6, number: null, status: "DRAFT", version: 1, replayed: false });
    await open("/ar/receipts/new", MANAGE);
    await wrapper.findComponent({ name: "QSelect" }).vm.$emit("update:modelValue", "3:HKD");
    await input("金額").setValue("10");
    await button("登記收款草稿").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("業務日期不可在未來");
    expect(input("金額").element.value).toBe("10");
    await button("登記收款草稿").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="ar-receipt-create-uncertain"]').exists()).toBe(true);
    expect(input("金額").attributes("disabled")).toBeDefined();
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [, second, third] = ar.createReceipt.mock.calls.map(([body]) => body);
    expect(third).toEqual(second);
  });
});

describe("AR 收款詳情及核銷", () => {
  it("只有 ar.view：唔見命令、核銷區同解除", async () => {
    ar.getReceipt.mockResolvedValue({ ...detail, allocations: [allocation] });
    await open("/ar/receipts/5");
    expect(button("作廢收款")).toBeUndefined();
    expect(wrapper.find('[data-testid="ar-allocate-panel"]').exists()).toBe(false);
    expect(button("解除")).toBeUndefined();
    expect(ar.listInvoices).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("HKD 100.00");
  });
  it("核銷：只列同客戶同幣別未收發票；填入按可核銷額同幣別小數位；送 version 同 allocations", async () => {
    ar.allocateReceipt.mockResolvedValue({ id: 5, number: "RCT-2026-000005", status: "CONFIRMED", version: 5, allocatedAmount: "150.0000", availableAmount: "0.0000", allocationIds: [31, 32], replayed: false });
    await open("/ar/receipts/5", MANAGE);
    expect(ar.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ customerId: 3, currencyCode: "HKD", outstandingOnly: true }));
    await button("填入").trigger("click");
    await wrapper.findAll("button").filter((node) => node.text() === "填入")[1].trigger("click");
    await flushPromises();
    expect(input("INV-2026-000001 核銷金額").element.value).toBe("100.00");
    // 餘下 50；發票 2 未收 80.005，取較細者 50 再向下取到 2 位
    expect(input("INV-2026-000002 核銷金額").element.value).toBe("50.00");
    expect(wrapper.text()).toContain("合計 HKD 150.00");
    await button("核銷").trigger("click");
    await flushPromises();
    expect(ar.allocateReceipt.mock.calls[0][0]).toBe("5");
    expect(ar.allocateReceipt.mock.calls[0][1]).toEqual({ version: 4, allocations: [{ invoiceId: 1, amount: "100.00" }, { invoiceId: 2, amount: "50.00" }], eventId: expect.any(String) });
    expect(notifySuccess).toHaveBeenCalledWith("已核銷；可核銷額尚餘 HKD 0.00。");
    expect(ar.getReceipt).toHaveBeenCalledTimes(2);
  });
  it("填入：發票未收額有幣別以下嘅尾數時向下取到幣別小數位", async () => {
    await open("/ar/receipts/5", MANAGE);
    await wrapper.findAll("button").filter((node) => node.text() === "填入")[1].trigger("click");
    await flushPromises();
    expect(input("INV-2026-000002 核銷金額").element.value).toBe("80.00");
    expect(button("核銷").attributes("disabled")).toBeUndefined();
  });
  it("核銷前驗證：超過發票未收額、超過可核銷額、超精度都唔准送", async () => {
    await open("/ar/receipts/5", MANAGE);
    await input("INV-2026-000001 核銷金額").setValue("100.01");
    await flushPromises();
    expect(wrapper.text()).toContain("超過發票未收額");
    expect(button("核銷").attributes("disabled")).toBeDefined();
    await input("INV-2026-000001 核銷金額").setValue("100");
    await input("INV-2026-000002 核銷金額").setValue("60");
    await flushPromises();
    expect(wrapper.text()).toContain("合計超過可核銷額");
    expect(button("核銷").attributes("disabled")).toBeDefined();
    await input("INV-2026-000002 核銷金額").setValue("0.005");
    await flushPromises();
    expect(wrapper.text()).toContain("最多 2 位小數");
    expect(ar.allocateReceipt).not.toHaveBeenCalled();
  });
  it("server 拒絕某一項：訊息指出發票編號並重新讀取", async () => {
    ar.allocateReceipt.mockRejectedValue(Object.assign(new Error("核銷金額超過發票的未收額"), { code: "AR_ALLOCATION_EXCEEDS_OUTSTANDING", status: 409, details: { field: "allocations.1.amount" } }));
    await open("/ar/receipts/5", MANAGE);
    await input("INV-2026-000001 核銷金額").setValue("10");
    await input("INV-2026-000002 核銷金額").setValue("20");
    await button("核銷").trigger("click");
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith("核銷金額超過發票的未收額（INV-2026-000002）");
    expect(ar.getReceipt).toHaveBeenCalledTimes(2);
  });
  it("解除核銷要確認，送收款 version；結果未確定用同一 eventId 重試", async () => {
    ar.getReceipt.mockResolvedValue({ ...detail, allocatedAmount: "100.0000", availableAmount: "50.0000", allowedActions: ["allocate"], allocations: [allocation] });
    ar.unapplyAllocation.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
      .mockResolvedValueOnce({ id: 5, number: "RCT-2026-000005", status: "CONFIRMED", version: 5, allocatedAmount: "0.0000", availableAmount: "150.0000", allocationId: 31, replayed: false });
    await open("/ar/receipts/5", MANAGE);
    expect(button("作廢收款")).toBeUndefined();
    await button("解除").trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="ar-receipt-uncertain"]').text()).toContain("解除核銷");
    expect(button("解除").attributes("disabled")).toBeDefined();
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const calls = ar.unapplyAllocation.mock.calls;
    expect(calls.map(([id, allocationId]) => [id, allocationId])).toEqual([["5", 31], ["5", 31]]);
    expect(calls[1][2]).toEqual(calls[0][2]);
    expect(calls[0][2]).toMatchObject({ version: 4 });
    expect(wrapper.find('[data-testid="ar-receipt-uncertain"]').exists()).toBe(false);
  });
  it("作廢要原因；仍有核銷嘅拒絕會重新讀取", async () => {
    promptReason.mockResolvedValue("客戶支票退票");
    ar.voidReceipt.mockRejectedValue(Object.assign(new Error("收款仍有核銷，請先解除核銷再作廢"), { code: "AR_RECEIPT_HAS_ALLOCATIONS", status: 409 }));
    await open("/ar/receipts/5", MANAGE);
    await button("作廢收款").trigger("click");
    await flushPromises();
    expect(ar.voidReceipt.mock.calls[0][1]).toMatchObject({ version: 4, reason: "客戶支票退票" });
    expect(notifyError).toHaveBeenCalledWith("收款仍有核銷，請先解除核銷再作廢");
    expect(ar.getReceipt).toHaveBeenCalledTimes(2);
  });
  it("草稿確認：先問確認再送 version", async () => {
    ar.getReceipt.mockResolvedValue({ ...detail, number: null, status: "DRAFT", version: 1, allowedActions: ["confirm", "cancel"] });
    ar.confirmReceipt.mockResolvedValue({ id: 5, number: "RCT-2026-000005", status: "CONFIRMED", version: 2, replayed: false });
    await open("/ar/receipts/5", MANAGE);
    expect(wrapper.find('[data-testid="ar-allocate-panel"]').exists()).toBe(false);
    await button("確認收款").trigger("click");
    await flushPromises();
    expect(ar.confirmReceipt.mock.calls[0][1]).toMatchObject({ version: 1 });
    expect(notifySuccess).toHaveBeenCalledWith("已確認，收款編號 RCT-2026-000005。");
  });
});

describe("AR 帳齡表", () => {
  it("每個客戶每個幣別一列；每個幣別分開合計，冇跨幣別總計；filter 寫入 URL", async () => {
    ar.getAging.mockResolvedValue({ asOfDate: "2026-11-20", items: [
      { customerId: 3, customerCode: "C3", customerName: "客戶3", currencyCode: "HKD", currencyDecimalPlaces: 2, invoiceCount: 2, notDue: "10.0000", days1To30: "5.5000", days31To60: "0.0000", days61To90: "0.0000", over90: "0.0000", total: "15.5000" },
      { customerId: 3, customerCode: "C3", customerName: "客戶3", currencyCode: "JPY", currencyDecimalPlaces: 0, invoiceCount: 1, notDue: "0.0000", days1To30: "0.0000", days31To60: "0.0000", days61To90: "0.0000", over90: "900.0000", total: "900.0000" }],
    totals: [
      { currencyCode: "HKD", invoiceCount: 2, notDue: "10.0000", days1To30: "5.5000", days31To60: "0.0000", days61To90: "0.0000", over90: "0.0000", total: "15.5000" },
      { currencyCode: "JPY", invoiceCount: 1, notDue: "0.0000", days1To30: "0.0000", days31To60: "0.0000", days61To90: "0.0000", over90: "900.0000", total: "900.0000" }] });
    const router = await open("/ar/aging?currencyCode=HKD&evil=1");
    expect(ar.getAging).toHaveBeenCalledWith(expect.objectContaining({ currencyCode: "HKD" }));
    expect(ar.getAging.mock.calls[0][0]).not.toHaveProperty("evil");
    expect(wrapper.findAll('[data-testid="ar-aging-row"]')).toHaveLength(2);
    const totals = wrapper.findAll('[data-testid="ar-aging-total"]').map((node) => node.text());
    expect(totals).toHaveLength(2);
    expect(totals[0]).toContain("HKD 合計");
    expect(totals[0]).toContain("15.50");
    expect(totals[1]).toContain("900");
    expect(wrapper.text()).not.toContain("915");
    await input("客戶 ID").setValue("3");
    await button("查詢").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ customerId: "3", currencyCode: "HKD" });
  });
  it("冇未收：顯示空狀態；讀取失敗可重試", async () => {
    ar.getAging.mockRejectedValueOnce(new Error("應收資料暫時不可用")).mockResolvedValueOnce({ asOfDate: "2026-11-20", items: [], totals: [] });
    await open("/ar/aging");
    expect(wrapper.text()).toContain("應收資料暫時不可用");
    await button("重試").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("沒有未收的應收款");
  });
});
