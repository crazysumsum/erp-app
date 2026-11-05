import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/purchasing.js", () => ({ default: { listPurchaseOrders: vi.fn(), getPurchaseOrder: vi.fn(), copyPurchaseOrder: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import purchasing from "@/services/purchasing.js";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import List, { page as listPage } from "@/pages/purchasing/PurchaseOrdersPage.vue";
import Detail, { page as detailPage } from "@/pages/purchasing/PurchaseOrderDetailPage.vue";
import PurchaseOrderProgress from "@/components/purchasing/PurchaseOrderProgress.vue";
import { useSessionStore } from "@/stores/session.js";

const HUGE = "9007199254740993";
const row = { id: 8, number: "PO-202611-000008", status: "DRAFT", version: 2, supplierId: 3, supplierCode: "S3", supplierName: "快照供應商", currencyCode: "HKD", orderDate: "2026-11-01", expectedDeliveryDate: null, buyerId: 5, buyerLabel: "採購員甲", supplierReference: "REF", totalAmount: "12.3400", hasOutstanding: false, createdAt: 1793000000000, updatedAt: 1793000000000, allowedActions: ["edit", "submit", "copy"], lineCount: 1, orderedBaseQuantity: "10", netReceivedBaseQuantity: "4", outstandingBaseQuantity: "6", closedRemainingBaseQuantity: "0", risks: [] };
const line = { id: 11, lineNumber: 1, skuId: 7, skuCode: "SKU7", skuName: "快照貨品", trackingPolicy: "NONE", inventoryTracked: true, minimumReceiptLifeDays: null, baseUomId: 1, baseUomCode: "EA", purchaseSkuUomId: 2, purchaseUomCode: "BOX", uomToBaseFactor: 10, supplierItemCode: "", orderedQuantity: "1.000000", orderedBaseQuantity: "10", unitPrice: "12.3400", lineAmount: "12.3400", zeroPriceReason: "", expectedDeliveryDate: null, lineNote: "明細備註", grossReceivedBaseQuantity: "5", reversedBaseQuantity: "1", netReceivedBaseQuantity: "4", outstandingBaseQuantity: "6", overReceivedBaseQuantity: "0", closedRemainingBaseQuantity: "0", closeReason: "", version: 1 };
const detail = { ...row, orderingAddressId: 4, orderingAddress: { addressLine1: "快照地址", addressLine2: null, addressLine3: null, city: "HK", stateRegion: null, postalCode: null, countryCode: "HK", phone: "secret-phone" }, currencyName: "港幣", currencyDecimalPlaces: 2, paymentTermId: 1, paymentTerm: { code: "N30", name: "30 天", calculationType: "NET", dueDays: 30 }, defaultReceivingWarehouseId: 6, defaultWarehouseCode: "W6", notes: "<script>unsafe()</script>", subtotalAmount: "12.3400", hasConfirmedReceipt: false, createdByLabel: "建立者", updatedByLabel: "更新者", confirmedAt: null, closedAt: null, cancelledAt: null, lines: [line], currentMasterDifferences: { supplier: null, lines: [] } };
const VIEW = ["purchasing.view"], MANAGE = ["purchasing.view", "purchasing.mgmt"];
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
  purchasing.listPurchaseOrders.mockResolvedValue({ rows: [row], rowsNumber: 1 });
  purchasing.getPurchaseOrder.mockResolvedValue(detail);
  confirm.mockResolvedValue(true);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; });

describe("TASK-019 PO 列表", () => {
  it("只要 purchasing.view；無 mgmt 唔見新增同編輯，預設按更新時間倒序", async () => {
    expect(listPage.requires.permissions).toEqual(VIEW);
    expect(detailPage.requires.permissions).toEqual(VIEW);
    await open("/purchasing/purchase-orders");
    expect(wrapper.text()).toContain(row.number);
    expect(wrapper.text()).toContain("S3 — 快照供應商");
    expect(wrapper.text()).toContain("草稿");
    expect(wrapper.text()).not.toContain("新增採購單");
    expect(button("編輯")).toBeUndefined();
    expect(button("查看").attributes("href")).toBe("/purchasing/purchase-orders/8");
    expect(purchasing.listPurchaseOrders).toHaveBeenCalledWith(expect.objectContaining({ page: 1, rowsPerPage: 20, sortBy: "updatedAt", descending: true }));
  });
  it("mgmt 見新增；編輯跟 server 嘅 allowedActions", async () => {
    purchasing.listPurchaseOrders.mockResolvedValue({ rows: [row, { ...row, id: 9, number: "PO-202611-000009", status: "CONFIRMED", allowedActions: ["copy"] }], rowsNumber: 2 });
    await open("/purchasing/purchase-orders", MANAGE);
    expect(button("新增採購單").attributes("href")).toBe("/purchasing/purchase-orders/new");
    expect(wrapper.findAll("a").filter((node) => node.text() === "編輯").map((node) => node.attributes("href"))).toEqual(["/purchasing/purchase-orders/8/edit"]);
    expect(wrapper.findAll("a").filter((node) => node.text() === "查看")).toHaveLength(2);
  });
  it("URL 還原全部 filter、頁碼同排序；未知 key 唔會送去 server", async () => {
    const query = "q=abc&status=CONFIRMED&supplierId=3&buyerId=5&currencyCode=HKD&hasOutstanding=true&orderDateFrom=2026-01-01&orderDateTo=2026-02-01&expectedDeliveryDateFrom=2026-03-01&expectedDeliveryDateTo=2026-04-01";
    const router = await open(`/purchasing/purchase-orders?${query}&page=3&sortBy=totalAmount&descending=false&evil=1`);
    const call = purchasing.listPurchaseOrders.mock.calls[0][0];
    expect(call).toMatchObject({ filter: "abc", status: "CONFIRMED", supplierId: "3", buyerId: "5", currencyCode: "HKD", hasOutstanding: "true", orderDateFrom: "2026-01-01", orderDateTo: "2026-02-01", expectedDeliveryDateFrom: "2026-03-01", expectedDeliveryDateTo: "2026-04-01", page: 3, sortBy: "totalAmount", descending: false });
    expect(call).not.toHaveProperty("evil");
    expect(router.currentRoute.value.query).toMatchObject({ q: "abc", page: "3", sortBy: "totalAmount", descending: "false" });
    expect(wrapper.find('input[aria-label="編號／供應商／SKU／供應商參考"]').element.value).toBe("abc");
  });
  it("排序欄同頁碼唔合法就用預設", async () => {
    await open("/purchasing/purchase-orders?sortBy=password&page=-1");
    expect(purchasing.listPurchaseOrders).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1, sortBy: "updatedAt" }));
  });
  it("搜尋寫入 URL 並回到第 1 頁；清除篩選清走", async () => {
    const router = await open("/purchasing/purchase-orders?page=2");
    await wrapper.find('input[aria-label="編號／供應商／SKU／供應商參考"]').setValue("新");
    await button("搜尋").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ q: "新", page: "1" });
    expect(purchasing.listPurchaseOrders).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "新", page: 1 }));
    await button("清除篩選").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBeUndefined();
  });
  it("供應商 ID 只接受安全正整數", async () => {
    const router = await open("/purchasing/purchase-orders");
    const input = wrapper.find('input[aria-label="供應商 ID"]');
    for (const value of ["0", "-1", "1.5", "9007199254740992", "abc"]) {
      await input.setValue(value);
      await input.trigger("keydown", { key: "Enter", keyCode: 13 });
      await flushPromises();
      await button("搜尋").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.query.supplierId).toBeUndefined();
    }
    await input.setValue("123");
    await input.trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    await button("搜尋").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.supplierId).toBe("123");
  });
  it("舊 filter 嘅回應遲到，唔會蓋住新結果", async () => {
    let resolve;
    purchasing.listPurchaseOrders.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const router = await open("/purchasing/purchase-orders");
    purchasing.listPurchaseOrders.mockResolvedValue({ rows: [], rowsNumber: 0 });
    await router.replace({ query: { q: "missing" } });
    await flushPromises();
    resolve({ rows: [row], rowsNumber: 1 });
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe("missing");
    expect(wrapper.text()).toContain("沒有符合條件的採購單");
  });
  it("風險有文字；進度同未收顯示 server 嘅準確數字", async () => {
    purchasing.listPurchaseOrders.mockResolvedValue({ rows: [{ ...row, status: "PARTIALLY_RECEIVED", orderedBaseQuantity: HUGE, netReceivedBaseQuantity: "1", outstandingBaseQuantity: HUGE, risks: ["OVERDUE", "OVER_RECEIVED", "ZERO_PRICE", "INACTIVE_MASTER"] }], rowsNumber: 1 });
    await open("/purchasing/purchase-orders");
    const text = wrapper.text();
    for (const label of ["部分收貨", "逾期", "超收", "零價", "主資料非 Active"]) expect(text).toContain(label);
    expect(text).toContain(`1／${HUGE}`);
    expect(text).toContain(`未收 ${HUGE}`);
  });
  it("讀取失敗顯示重試，重試成功；空結果有提示", async () => {
    purchasing.listPurchaseOrders.mockRejectedValueOnce(new Error("列表失敗"));
    await open("/purchasing/purchase-orders");
    expect(wrapper.text()).toContain("列表失敗");
    expect(wrapper.text()).not.toContain("沒有符合條件");
    await wrapper.find('button[aria-label="重試"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(row.number);
    wrapper.unmount();
    purchasing.listPurchaseOrders.mockResolvedValue({ rows: [], rowsNumber: 0 });
    await open("/purchasing/purchase-orders?q=none");
    expect(wrapper.text()).toContain("沒有符合條件的採購單");
  });
  it.each([["4", "10", 0.4], ["1", "3", 0.33], ["25", "10", 1], [HUGE, HUGE, 1], ["0", HUGE, 0], ["9007199254740992", HUGE, 0.99]])("進度條 %s／%s 係 %s，超收唔超過 100%%", (received, ordered, value) => {
    const progress = mount(PurchaseOrderProgress, { props: { received, ordered }, global: { plugins: [Quasar] } });
    expect(progress.findComponent({ name: "QLinearProgress" }).props("value")).toBe(value);
    expect(progress.text()).toContain(`${received}／${ordered}`);
  });
});

describe("TASK-019 PO 詳情", () => {
  it("只有 view：就算 server 有 action 都唔出寫入按鈕", async () => {
    await open("/purchasing/purchase-orders/8");
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledWith("8", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(wrapper.find("h1").text()).toBe(row.number);
    expect(button("編輯草稿")).toBeUndefined();
    expect(button("複製")).toBeUndefined();
    expect(button("返回採購單列表").attributes("href")).toBe("/purchasing/purchase-orders");
  });
  it("mgmt：按鈕跟 server；非 Draft 冇編輯", async () => {
    await open("/purchasing/purchase-orders/8", MANAGE);
    expect(button("編輯草稿").attributes("href")).toBe("/purchasing/purchase-orders/8/edit");
    expect(button("複製")).toBeDefined();
    wrapper.unmount();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, status: "CONFIRMED", allowedActions: ["copy"] });
    await open("/purchasing/purchase-orders/8", MANAGE);
    expect(wrapper.text()).toContain("已確認");
    expect(button("編輯草稿")).toBeUndefined();
    expect(button("複製")).toBeDefined();
    wrapper.unmount();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, allowedActions: [] });
    await open("/purchasing/purchase-orders/8", MANAGE);
    expect(button("複製")).toBeUndefined();
  });
  it.each([["DRAFT", true], ["CONFIRMED", true], ["CLOSED", true], ["PENDING_APPROVAL", false], ["CANCELLED", false]])("%s 列印入口：%s（Viewer 都有）", async (status, shown) => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, status });
    await open("/purchasing/purchase-orders/8");
    expect(button("列印")?.attributes("href")).toBe(shown ? "/purchasing/purchase-orders/8/print" : undefined);
  });
  it("快照同目前主資料分開；冇分別就冇目前主資料區", async () => {
    await open("/purchasing/purchase-orders/8");
    expect(wrapper.text()).toContain("S3 — 快照供應商");
    expect(wrapper.text()).toContain("快照地址");
    expect(wrapper.text()).toContain("N30 — 30 天");
    expect(wrapper.text()).not.toContain("secret-phone");
    expect(wrapper.find('[data-testid="po-current-master"]').exists()).toBe(false);
    wrapper.unmount();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, currentMasterDifferences: { supplier: { supplierCode: "S3", supplierName: "目前供應商", status: "suspended" }, lines: [{ lineId: 11, skuId: 7, skuCode: "SKU7", skuName: "目前貨品", skuStatus: "inactive", itemStatus: "active" }] } });
    await open("/purchasing/purchase-orders/8");
    const section = wrapper.find('[data-testid="po-current-master"]').text();
    expect(section).toContain("目前供應商（suspended）");
    expect(section).toContain("目前貨品（SKU inactive；Item active）");
    expect(section).not.toContain("快照供應商");
    expect(wrapper.text()).toContain("S3 — 快照供應商");
    expect(wrapper.text()).toContain("SKU7 — 快照貨品");
  });
  it("每行分開顯示全部 Base 數量；零價同超收有文字；備註唔當 HTML", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, lines: [{ ...line, orderedBaseQuantity: HUGE, grossReceivedBaseQuantity: "21", reversedBaseQuantity: "22", netReceivedBaseQuantity: "23", outstandingBaseQuantity: "24", overReceivedBaseQuantity: "25", closedRemainingBaseQuantity: "26", unitPrice: "0.0000", zeroPriceReason: "贈品" }] });
    await open("/purchasing/purchase-orders/8");
    const text = wrapper.text();
    for (const shown of [`Ordered ${HUGE} EA`, "Gross Received 21 EA", "Reversed 22 EA", "Net Received 23 EA", "Outstanding 24 EA", "Over-received 25 EA", "Closed Remaining 26 EA", "1.000000 BOX", "零價：贈品", "超收", detail.notes]) expect(text).toContain(shown);
    expect(wrapper.find("dl script").exists()).toBe(false);
  });
  it("多行進度用 BigInt 加總，超過 2^53 都準", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, lines: [{ ...line, orderedBaseQuantity: HUGE, netReceivedBaseQuantity: "1" }, { ...line, id: 12, lineNumber: 2, orderedBaseQuantity: "2", netReceivedBaseQuantity: "2" }] });
    await open("/purchasing/purchase-orders/8");
    expect(wrapper.text()).toContain("3／9007199254740995");
  });
  it.each(["abc", "0", "1.5", "..%2Fusers"])("唔合法嘅 id %s 唔會打 API", async (id) => {
    await open(`/purchasing/purchase-orders/${id}`);
    expect(purchasing.getPurchaseOrder).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("找不到此採購單");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
  it("讀取失敗可重試，唔會出舊資料", async () => {
    purchasing.getPurchaseOrder.mockRejectedValueOnce(new Error("載入失敗")).mockResolvedValue(detail);
    await open("/purchasing/purchase-orders/8");
    expect(wrapper.find('[role="alert"]').text()).toContain("載入失敗");
    await button("重試").trigger("click");
    await flushPromises();
    expect(wrapper.find("h1").text()).toBe(row.number);
  });
  it("轉 PO 時舊回應遲到唔會蓋住新 PO", async () => {
    let resolve;
    purchasing.getPurchaseOrder.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const router = await open("/purchasing/purchase-orders/8");
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, id: 9, number: "PO-202611-000009" });
    await router.push("/purchasing/purchase-orders/9");
    await flushPromises();
    resolve(detail);
    await flushPromises();
    expect(wrapper.find("h1").text()).toBe("PO-202611-000009");
  });
  it("複製要先確認；取消就唔發", async () => {
    confirm.mockResolvedValue(false);
    await open("/purchasing/purchase-orders/8", MANAGE);
    await button("複製").trigger("click");
    await flushPromises();
    expect(purchasing.copyPurchaseOrder).not.toHaveBeenCalled();
  });
  it("複製成功去新 PO，並顯示每個 warning", async () => {
    purchasing.copyPurchaseOrder.mockResolvedValue({ id: 20, number: "PO-202611-000020", status: "DRAFT", version: 1, replayed: false, warnings: [{ code: "COPY_FIELD_CHANGED", field: "paymentTermId" }, { code: "COPY_FIELD_CHANGED", field: "expectedDeliveryDate", lineNumber: 2 }, { code: "COPY_LINE_DROPPED", lineNumber: 3 }] });
    const router = await open("/purchasing/purchase-orders/8", MANAGE);
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, id: 20, number: "PO-202611-000020" });
    await button("複製").trigger("click");
    await flushPromises();
    expect(purchasing.copyPurchaseOrder).toHaveBeenCalledWith(8, { eventId: expect.any(String) });
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/20");
    expect(wrapper.find("h1").text()).toBe("PO-202611-000020");
    expect(notifySuccess.mock.calls[0][0]).toContain("PO-202611-000020");
    expect(notifyWarning.mock.calls.map(([message]) => message)).toEqual(["付款條款已不適用，已清除或改用目前值。", "第 2 行預計交貨日已不適用，已清除或改用目前值。", "來源第 3 行已不可採購，未有複製。"]);
  });
  it("結果未確定：保留同一 eventId 重試，唔再問確認；期間唔可以開新複製", async () => {
    purchasing.copyPurchaseOrder.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    purchasing.copyPurchaseOrder.mockResolvedValueOnce({ id: 20, number: "PO-202611-000020", status: "DRAFT", version: 1, replayed: true, warnings: [] });
    const router = await open("/purchasing/purchase-orders/8", MANAGE);
    await button("複製").trigger("click");
    await flushPromises();
    expect(notifyError).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("複製結果尚未確認");
    expect(button("複製").attributes("disabled")).toBeDefined();
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.copyPurchaseOrder.mock.calls;
    expect(second[1].eventId).toBe(first[1].eventId);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/20");
  });
  it("結果未確定時轉去另一張 PO：banner 清走，唔會用舊 eventId 複製新 PO", async () => {
    purchasing.copyPurchaseOrder.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    purchasing.copyPurchaseOrder.mockResolvedValueOnce({ id: 20, number: "PO-202611-000020", status: "DRAFT", version: 1, replayed: false, warnings: [] });
    const router = await open("/purchasing/purchase-orders/8", MANAGE);
    await button("複製").trigger("click");
    await flushPromises();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...detail, id: 9, number: "PO-202611-000009" });
    await router.push("/purchasing/purchase-orders/9");
    await flushPromises();
    expect(wrapper.text()).not.toContain("複製結果尚未確認");
    await button("複製").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.copyPurchaseOrder.mock.calls;
    expect(second[0]).toBe(9);
    expect(second[1].eventId).not.toBe(first[1].eventId);
  });
  it("明確拒絕：留喺原頁，下次係新 eventId", async () => {
    purchasing.copyPurchaseOrder.mockRejectedValueOnce(Object.assign(new Error("供應商不可採購"), { code: "SUPPLIER_NOT_PURCHASABLE", status: 409 }));
    purchasing.copyPurchaseOrder.mockResolvedValueOnce({ id: 20, number: "PO-202611-000020", status: "DRAFT", version: 1, replayed: false, warnings: [] });
    const router = await open("/purchasing/purchase-orders/8", MANAGE);
    await button("複製").trigger("click");
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith("供應商不可採購");
    expect(wrapper.text()).not.toContain("複製結果尚未確認");
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8");
    await button("複製").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.copyPurchaseOrder.mock.calls;
    expect(second[1].eventId).not.toBe(first[1].eventId);
  });
});
