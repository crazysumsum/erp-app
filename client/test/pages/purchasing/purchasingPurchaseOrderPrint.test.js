import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/purchasing.js", () => ({ default: { getPurchaseOrder: vi.fn() } }));
import purchasing from "@/services/purchasing.js";
import Print, { page } from "@/pages/purchasing/PurchaseOrderPrintPage.vue";
import source from "@/pages/purchasing/PurchaseOrderPrintPage.vue?raw";
import { useSessionStore } from "@/stores/session.js";

const line = { id: 11, lineNumber: 1, skuCode: "SKU7", skuName: "快照貨品", supplierItemCode: "V-7", purchaseUomCode: "BOX", orderedQuantity: "2.000000", unitPrice: "12.3400", lineAmount: "24.68", expectedDeliveryDate: "2026-12-01", lineNote: "明細備註" };
const po = { id: 8, number: "PO-202611-000008", status: "CONFIRMED", supplierCode: "S3", supplierName: "快照供應商", orderingAddress: { addressLine1: "快照地址", addressLine2: null, addressLine3: null, city: "HK", stateRegion: null, postalCode: null, countryCode: "HK", phone: "secret-phone" }, orderDate: "2026-11-01", expectedDeliveryDate: "2026-12-01", currencyCode: "HKD", currencyName: "港幣", paymentTerm: { code: "N30", name: "30 天" }, supplierReference: "REF", buyerLabel: "採購員甲", totalAmount: "24.68", notes: "<script>unsafe()</script>", lines: [line], currentMasterDifferences: { supplier: { supplierCode: "S3", supplierName: "目前供應商", status: "active" }, lines: [{ lineId: 11, skuId: 7, skuCode: "SKU7", skuName: "目前貨品", skuStatus: "active", itemStatus: "active" }] } };
const button = (label) => wrapper.findAll("button").find((node) => node.text() === label);
const sheet = () => wrapper.find('[data-testid="po-sheet"]');
let wrapper;

async function open(path = "/purchasing/purchase-orders/8/print", permissions = ["purchasing.view"]) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...page, component: Print }] });
  await router.push(path);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] } });
  await flushPromises();
}
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); purchasing.getPurchaseOrder.mockResolvedValue(po); });
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.restoreAllMocks(); });

describe("TASK-020 A4 列印", () => {
  it("purchasing.view 就可以印；內容用交易快照，唔用目前主資料", async () => {
    expect(page.requires.permissions).toEqual(["purchasing.view"]);
    await open();
    const text = sheet().text();
    for (const shown of ["F&M ERP", po.number, "S3 — 快照供應商", "快照地址, HK, HK", "2026-11-01", "2026-12-01", "HKD — 港幣", "N30 — 30 天", "REF", "SKU7 — 快照貨品", "V-7", "明細備註", "2.000000 BOX", "12.3400", "24.68", "總額：HKD 24.68"]) expect(text).toContain(shown);
    for (const hidden of ["目前供應商", "目前貨品", "secret-phone"]) expect(text).not.toContain(hidden);
  });
  it("語意 table，100 行都喺度；PO 編號喺重複嘅表頭入面", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...po, lines: Array.from({ length: 100 }, (_, index) => ({ ...line, id: index + 1, lineNumber: index + 1 })) });
    await open();
    const table = sheet().find("table");
    expect(table.find("caption").text()).toBe("採購明細（HKD）");
    expect(table.findAll("thead tr")).toHaveLength(2);
    expect(table.find("thead").text()).toContain(po.number);
    expect(table.findAll('thead th[scope="col"]').map((node) => node.text())).toEqual(["行", "SKU／名稱", "數量／單位", "單價", "金額", "交期"]);
    expect(table.findAll("tbody tr")).toHaveLength(100);
    expect(wrapper.findAll("h1")).toHaveLength(1);
  });
  it.each(["CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"])("%s 係正式版本，冇水印", async (status) => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...po, status });
    await open();
    expect(sheet().exists()).toBe(true);
    expect(wrapper.find(".po-watermark").exists()).toBe(false);
    expect(sheet().text()).not.toContain("草稿");
    expect(button("列印 A4")).toBeDefined();
  });
  it("Draft 有水印同文字，掣寫明係草稿", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...po, status: "DRAFT" });
    await open();
    expect(wrapper.find(".po-watermark").text()).toBe("草稿");
    expect(sheet().find("h3").text()).toContain("草稿，非正式文件");
    expect(button("列印草稿")).toBeDefined();
    expect(button("列印 A4")).toBeUndefined();
  });
  it.each(["PENDING_APPROVAL", "CANCELLED"])("%s 唔准印", async (status) => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...po, status });
    await open();
    expect(sheet().exists()).toBe(false);
    expect(wrapper.find('[role="status"]').text()).toContain("目前狀態不允許列印");
    expect(wrapper.findAll("button").filter((node) => node.text().includes("列印"))).toHaveLength(0);
  });
  it("撳掣用瀏覽器列印，唔打任何 API", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await open();
    await button("列印 A4").trigger("click");
    expect(print).toHaveBeenCalledTimes(1);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(1);
  });
  it("冇值就寫未設定；備註當文字", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...po, orderingAddress: null, paymentTerm: null, expectedDeliveryDate: null, supplierReference: "", buyerLabel: "" });
    await open();
    const terms = sheet().find("dl").findAll("dd").map((node) => node.text());
    expect(terms.filter((text) => text === "未設定")).toHaveLength(3);
    expect(sheet().text()).toContain(po.notes);
    expect(sheet().find("script").exists()).toBe(false);
  });
  it.each(["abc", "0", "..%2Fusers"])("唔合法嘅 id %s 唔會打 API", async (id) => {
    await open(`/purchasing/purchase-orders/${id}/print`);
    expect(purchasing.getPurchaseOrder).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').text()).toContain("找不到此採購單");
  });
  it("讀取失敗可重試，唔會出列印掣", async () => {
    purchasing.getPurchaseOrder.mockRejectedValueOnce(new Error("載入失敗"));
    await open();
    expect(wrapper.find('[role="alert"]').text()).toContain("載入失敗");
    expect(button("列印 A4")).toBeUndefined();
    await button("重試").trigger("click");
    await flushPromises();
    expect(sheet().exists()).toBe(true);
  });
  it("列印 CSS：A4、表頭每頁重現、行唔切開、藏起 app 外框", () => {
    for (const rule of ["@page { size: A4 portrait;", "thead { display: table-header-group; }", "tr { break-inside: avoid; }", ".po-print-actions { display: none; }", "body:has(.po-print) .q-header", "body:has(.po-print) .q-drawer"]) expect(source).toContain(rule);
  });
});
