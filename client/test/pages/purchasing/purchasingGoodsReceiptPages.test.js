import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn().mockResolvedValue(true), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/services/purchasing.js", () => ({ default: Object.fromEntries(["getGoodsReceipt", "getPurchaseOrder", "lookupReceivingWarehouses", "lookupReceivingBins",
  "updateGoodsReceipt", "confirmGoodsReceipt", "listGoodsReceipts"].map((name) => [name, vi.fn()])) }));
import purchasing from "@/services/purchasing.js";
import { useSessionStore } from "@/stores/session.js";
import EditPage from "@/pages/purchasing/GoodsReceiptEditPage.vue";

const draft = { id: 8, number: "GR-202611-000008", status: "DRAFT", version: 2, purchaseOrderId: 5, businessReceiptDate: "2026-11-20", supplierDeliveryNote: "", notes: "",
  supplierExceptionReason: "", allowedActions: ["update", "cancel", "confirm"], lines: [{ purchaseOrderLineId: 11, overReceiptReason: "", skuExceptionReason: "",
    details: [{ inputUomId: 2, receivedQuantity: "1.000000", warehouseId: 3, binId: 31, lotNumber: "", expiryDate: null, manufactureDate: null, stockStatus: "AVAILABLE", expiryOverrideReason: "" }] }] };
const purchaseOrder = { id: 5, number: "PO-202611-000005", supplierName: "供應商", status: "CONFIRMED", defaultReceivingWarehouseId: 3, lines: [{ id: 11, lineNumber: 1, skuCode: "A", skuName: "貨品",
  trackingPolicy: "none", baseUomId: 1, baseUomCode: "EA", purchaseUomId: 2, purchaseUomCode: "BOX", uomToBaseFactor: 12, orderedBaseQuantity: "24", netReceivedBaseQuantity: "0",
  outstandingBaseQuantity: "24", closedRemainingBaseQuantity: "0" }] };

let wrapper, router;
async function mountEdit() {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/purchasing/goods-receipts/:id/edit", component: EditPage },
    { path: "/purchasing/goods-receipts/:id", component: { render: () => h("div", "detail") } }] });
  await router.push("/purchasing/goods-receipts/8/edit"); await router.isReady();
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
}
const button = (label) => wrapper.findAll("button").find((b) => b.text().includes(label));

describe("收貨單編輯頁（TASK-031；TL 558fb167 R1）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useSessionStore().user = { id: 7, permissions: ["purchasing.view", "receiving.operation"], roles: [] };
    vi.clearAllMocks();
    purchasing.getGoodsReceipt.mockResolvedValue(structuredClone(draft));
    purchasing.getPurchaseOrder.mockResolvedValue(purchaseOrder);
    purchasing.lookupReceivingWarehouses.mockResolvedValue([{ id: 3, code: "W3", name: "主倉" }]);
    purchasing.lookupReceivingBins.mockResolvedValue([{ id: 31, code: "A1" }]);
  });
  afterEach(() => wrapper?.unmount());

  it("確認結果不明：表單全部鎖定，只可以喺 banner 以原內容重試；重試送出嘅 body（連 eventId）同第一次一樣", async () => {
    purchasing.confirmGoodsReceipt.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
      .mockResolvedValueOnce({ id: 8, number: draft.number, status: "CONFIRMED", version: 3 });
    await mountEdit();
    await button("確認收貨並入庫").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(wrapper.find("[data-testid=gr-uncertain]").exists()).toBe(true);
    const fieldset = wrapper.find("fieldset");
    expect(fieldset.attributes("disabled")).toBeDefined();
    expect(fieldset.attributes("inert")).toBeDefined();
    await button("以原內容重試確認").trigger("click"); await flushPromises();
    expect(purchasing.confirmGoodsReceipt).toHaveBeenCalledTimes(2);
    const [[firstId, first], [secondId, second]] = purchasing.confirmGoodsReceipt.mock.calls;
    expect([secondId, second]).toEqual([firstId, first]);
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(router.currentRoute.value.path).toBe("/purchasing/goods-receipts/8");
  });

  it("儲存結果不明亦一樣鎖定，重試送原內容；明確拒絕就唔鎖", async () => {
    purchasing.updateGoodsReceipt.mockRejectedValueOnce(Object.assign(new Error("網絡錯誤"), { code: "NETWORK_ERROR" }))
      .mockResolvedValueOnce({ id: 8, number: draft.number, status: "DRAFT", version: 3 });
    await mountEdit();
    await button("儲存草稿").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(wrapper.find("fieldset").attributes("disabled")).toBeDefined();
    await button("以原內容重試儲存").trigger("click"); await flushPromises();
    const [[, first], [, second]] = purchasing.updateGoodsReceipt.mock.calls;
    expect(second).toEqual(first);
    expect(wrapper.find("[data-testid=gr-uncertain]").exists()).toBe(false);

    purchasing.updateGoodsReceipt.mockRejectedValueOnce(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT", status: 409 }));
    await button("儲存草稿").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(wrapper.find("[data-testid=gr-uncertain]").exists()).toBe(false);
    expect(wrapper.find("fieldset").attributes("disabled")).toBeUndefined();
  });
});
