import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { createInvoice: vi.fn(), listInvoicedShipments: vi.fn() } }));
vi.mock("@/services/shipment.js", () => ({ default: { listShipments: vi.fn() } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import ar from "@/services/ar.js";
import shipment from "@/services/shipment.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import Create, { page as createPage } from "@/pages/ar/ArInvoiceCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

const ship = (id, customerId = "3", number = `SH-${id}`) => ({ id, number, status: "SHIPPED", customer: { id: customerId, code: `C${customerId}`, name: `客戶${customerId}` },
  salesOrder: { id: "70", number: "SO-70" }, shipmentDate: "2026-11-18", lineCount: 2 });
const PERMS = ["ar.view", "ar.invoice.mgmt", "fulfillment.view"];
let wrapper;
const button = (label) => wrapper.findAll("button,a").find((node) => node.text() === label);
const rows = () => wrapper.findAll('[data-testid="ar-create-shipment"]');
const check = async (index) => { await rows()[index].find('[role="checkbox"]').trigger("click"); await flushPromises(); };

async function open() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...createPage, component: Create }, { path: "/ar/invoices/:id", component: { render: () => h("p", "detail") } }] });
  await router.push("/ar/invoices/new");
  await router.isReady();
  useSessionStore().user = { id: 1, permissions: PERMS, roles: [] };
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  await button("搜尋已出貨").trigger("click");
  await flushPromises();
  return router;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  shipment.listShipments.mockResolvedValue({ items: [ship("11"), ship("12"), ship("13", "4"), ship("14")], total: 4, page: 1, pageSize: 100, hasMore: false });
  ar.listInvoicedShipments.mockResolvedValue([{ shipmentId: 14, invoiceId: 2, invoiceNumber: "INV-2026-000002", invoiceStatus: "CONFIRMED" }]);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; });

describe("AR 由出貨開立發票", () => {
  it("要 ar.view、ar.invoice.mgmt 同 fulfillment.view；只搜 SHIPPED，再問邊啲已開票", async () => {
    expect(createPage.requires.permissions).toEqual(PERMS);
    await open();
    expect(shipment.listShipments).toHaveBeenCalledWith(expect.objectContaining({ status: "SHIPPED", pageSize: 100 }));
    expect(ar.listInvoicedShipments).toHaveBeenCalledWith(["11", "12", "13", "14"], expect.anything());
    expect(rows()[3].text()).toContain("已在發票 INV-2026-000002");
    expect(button("建立發票草稿").attributes("disabled")).toBeDefined();
  });
  it("揀咗一個客戶，其他客戶嘅出貨唔可以揀；送整數 shipmentIds 同發票日期，成功去詳情", async () => {
    ar.createInvoice.mockResolvedValue({ id: 9, number: null, status: "DRAFT", version: 1, totalAmount: "10.0000", replayed: false });
    const router = await open();
    await check(0);
    await check(1);
    expect(rows()[2].text()).toContain("不同客戶");
    await check(2);
    expect(wrapper.text()).toContain("已選 2 張（C3 客戶3）");
    await button("建立發票草稿").trigger("click");
    await flushPromises();
    const body = ar.createInvoice.mock.calls[0][0];
    expect(body).toEqual({ shipmentIds: [11, 12], invoiceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u), eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    expect(notifySuccess).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/ar/invoices/9");
  });
  it("到期日要原因：顯示 server 訊息，保留選擇，補原因後用新 eventId 再送", async () => {
    ar.createInvoice.mockRejectedValueOnce(Object.assign(new Error("應收資料不正確，請檢查輸入"), { code: "AR_INPUT_INVALID", status: 400, details: { field: "dueDateReason" } }))
      .mockResolvedValueOnce({ id: 9, number: null, status: "DRAFT", version: 1, totalAmount: "10.0000", replayed: false });
    await open();
    await check(0);
    await wrapper.find('input[aria-label="到期日（留空按付款條款）"]').setValue("2026-12-31");
    await button("建立發票草稿").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("應收資料不正確，請檢查輸入");
    expect(wrapper.text()).toContain("已選 1 張");
    await wrapper.find('input[aria-label="到期日原因（與條款不同時必填）"]').setValue("  客戶要求延期  ");
    await button("建立發票草稿").trigger("click");
    await flushPromises();
    const [first, second] = ar.createInvoice.mock.calls.map(([body]) => body);
    expect(second).toMatchObject({ shipmentIds: [11], dueDate: "2026-12-31", dueDateReason: "客戶要求延期" });
    expect(second.eventId).not.toBe(first.eventId);
  });
  it("所選出貨已開票：顯示訊息並重新查詢標記", async () => {
    ar.createInvoice.mockRejectedValueOnce(Object.assign(new Error("所選出貨已在另一張未作廢的發票上"), { code: "AR_SHIPMENT_ALREADY_INVOICED", status: 409 }));
    await open();
    await check(0);
    ar.listInvoicedShipments.mockResolvedValue([{ shipmentId: 11, invoiceId: 3, invoiceNumber: null, invoiceStatus: "DRAFT" }]);
    await button("建立發票草稿").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("所選出貨已在另一張未作廢的發票上");
    expect(shipment.listShipments).toHaveBeenCalledTimes(2);
    expect(rows()[0].text()).toContain("已在發票 草稿（未編號）");
    expect(wrapper.text()).toContain("已選 0 張");
  });
  it("結果未確定：鎖住選擇，重試用同一個 eventId 同內容", async () => {
    ar.createInvoice.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
      .mockResolvedValueOnce({ id: 9, number: null, status: "DRAFT", version: 1, totalAmount: "10.0000", replayed: false });
    await open();
    await check(0);
    await button("建立發票草稿").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="ar-create-uncertain"]').exists()).toBe(true);
    expect(button("搜尋已出貨").attributes("disabled")).toBeDefined();
    await check(1);
    expect(wrapper.text()).toContain("已選 1 張");
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = ar.createInvoice.mock.calls.map(([body]) => body);
    expect(second).toEqual(first);
  });
  it("讀取出貨失敗：顯示錯誤同重試；空結果有提示", async () => {
    shipment.listShipments.mockRejectedValueOnce(new Error("履約服務暫時不可用"));
    await open();
    expect(wrapper.text()).toContain("履約服務暫時不可用");
    shipment.listShipments.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 100, hasMore: false });
    ar.listInvoicedShipments.mockResolvedValueOnce([]);
    await button("重試").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("沒有符合條件的已出貨出貨單");
  });
});
