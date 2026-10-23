import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";

vi.mock("@/services/supplier.js", () => ({
  default: { list: vi.fn(), exportCsv: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/services/businessMaster.js", () => ({ default: { currencyList: vi.fn(), paymentTermList: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import supplierService from "@/services/supplier.js";
import businessMasterService from "@/services/businessMaster.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import SuppliersPage, { page } from "@/pages/suppliers/SuppliersPage.vue";
import { useSessionStore } from "@/stores/session.js";

// 頁面要用香港時間計日界；本機時區如果剛好係香港就分唔出，所以固定用 UTC 跑（Node 改 TZ 即時生效）。
process.env.TZ = "UTC";

const ROW = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, primaryContactName: "Amy Chan",
  status: "active", version: 2, updatedAt: 1700000000000
};

async function mountPage({ permissions = ["supplier.view", "supplier.mgmt"], initialRoute = "/suppliers", rows = [ROW] } = {}) {
  supplierService.list.mockResolvedValue({ rows, rowsNumber: rows.length });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, component: SuppliersPage },
      { path: "/suppliers/:id", component: { template: "<div>detail</div>" } },
      { path: "/suppliers/new", component: { template: "<div>create</div>" } }
    ]
  });
  await router.push(initialRoute);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount(SuppliersPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/suppliers/SuppliersPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("TC-121 (UI-001): is the permission-filtered Supplier menu entry and renders explicit status text", async () => {
    expect(page.menu.group).toBe("suppliers");
    expect(page.requires.permissions).toEqual(["supplier.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("SUP-007");
    expect(body.text()).toContain("Amy Chan");
    expect(body.text()).toContain("啟用");
    expect(body.find('a[href="/suppliers/7"]').exists()).toBe(true);
  });

  it("TC-013 (LIST-006): tells a loading, an empty and a failed list apart, and retries a failed read", async () => {
    let resolve;
    supplierService.list.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    let result = await mountPage();
    expect(result.body.find('[aria-busy="true"]').exists()).toBe(true);
    expect(result.body.text()).toContain("載入中…");
    expect(result.body.text()).not.toContain("冇資料");
    resolve({ rows: [], rowsNumber: 0 });
    await flushPromises();
    expect(result.body.find('[aria-busy="true"]').exists()).toBe(false);
    expect(result.body.text()).toContain("冇資料");
    expect(result.body.find(".q-banner").exists()).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";

    supplierService.list.mockRejectedValueOnce(new Error("暫時未能讀取供應商"));
    result = await mountPage();
    expect(result.body.find(".q-banner").text()).toContain("暫時未能讀取供應商");
    expect(result.body.text()).not.toContain("冇資料");
    await result.body.find('button[aria-label="重試"]').trigger("click");
    await flushPromises();
    expect(result.body.find(".q-banner").exists()).toBe(false);
    expect(result.body.text()).toContain("SUP-007");
  });

  it("names the payment term by code and name, marks an inactive one, and never shows its ID (DEF-040)", async () => {
    const { body } = await mountPage({ rows: [
      { ...ROW, id: 7, supplierCode: "SUP-007", defaultPaymentTermId: 31, defaultPaymentTerm: { id: 31, code: "NET30", name: "Net 30", status: "ACTIVE" } },
      { ...ROW, id: 8, supplierCode: "SUP-008", defaultPaymentTermId: 32, defaultPaymentTerm: { id: 32, code: "OLD60", name: "Old 60", status: "INACTIVE" } },
      { ...ROW, id: 9, supplierCode: "SUP-009", defaultPaymentTermId: null, defaultPaymentTerm: null }
    ] });
    const rowText = (code) => body.findAll("tbody tr").find((row) => row.text().includes(code)).text();
    expect(rowText("SUP-007")).toContain("NET30 — Net 30");
    expect(rowText("SUP-007")).not.toContain("已停用");
    expect(rowText("SUP-008")).toContain("OLD60 — Old 60（已停用）");
    expect(rowText("SUP-009")).toContain("未設定");
    expect(rowText("SUP-007")).not.toMatch(/\b31\b/u);
  });

  it("shows create only to supplier.mgmt users", async () => {
    let result = await mountPage({ permissions: ["supplier.view"] });
    expect(result.body.find('a[href="/suppliers/new"]').exists()).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";
    result = await mountPage();
    expect(result.body.find('a[href="/suppliers/new"]').exists()).toBe(true);
  });

  it("offers export only to supplier.mgmt users", async () => {
    let result = await mountPage({ permissions: ["supplier.view"] });
    expect(result.body.findAll("button").some((button) => button.text().includes("匯出 CSV"))).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";
    result = await mountPage();
    expect(result.body.findAll("button").some((button) => button.text().includes("匯出 CSV"))).toBe(true);
  });

  it("exports the current search, status and sort after a password, under the server's file name", async () => {
    const clicks = [];
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record() { clicks.push(this.download); });
    promptPassword.mockResolvedValue("pw");
    supplierService.exportCsv.mockResolvedValue({ blob: new Blob(["x"]), fileName: "suppliers-20261006T070809Z.csv" });
    const { body } = await mountPage({ initialRoute: "/suppliers?q=evergreen&status=active&sortBy=supplierName&descending=false" });

    await body.findAll("button").find((button) => button.text().includes("匯出 CSV")).trigger("click");
    await flushPromises();

    expect(supplierService.exportCsv).toHaveBeenCalledWith(expect.objectContaining({
      filter: "evergreen", status: "active", sortBy: "supplierName", descending: false, password: "pw"
    }));
    expect(clicks).toEqual(["suppliers-20261006T070809Z.csv"]);
    click.mockRestore();
  });

  it("does nothing when the password prompt is cancelled, and shows the server's message on failure", async () => {
    promptPassword.mockResolvedValue(null);
    const { body } = await mountPage();
    const button = body.findAll("button").find((candidate) => candidate.text().includes("匯出 CSV"));
    await button.trigger("click");
    await flushPromises();
    expect(supplierService.exportCsv).not.toHaveBeenCalled();

    promptPassword.mockResolvedValue("pw");
    supplierService.exportCsv.mockRejectedValue(Object.assign(new Error("一次最多匯出 10000 個供應商，請收窄篩選條件"), { status: 422 }));
    await button.trigger("click");
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith("一次最多匯出 10000 個供應商，請收窄篩選條件");
  });

  it("TC-015 (LIST-008): restores filters and paging from URL and keeps the query shareable", async () => {
    const { router } = await mountPage({ initialRoute: "/suppliers?page=2&q=evergreen&status=active&sortBy=supplierName&descending=false" });
    expect(supplierService.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, filter: "evergreen", status: "active", sortBy: "supplierName", descending: false
    }));
    expect(router.currentRoute.value.query.q).toBe("evergreen");
  });

  it("TC-015 (LIST-008): restores the HD-107 filters from the URL and sends them to the list and the export as Hong Kong day bounds", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    promptPassword.mockResolvedValue("pw");
    supplierService.exportCsv.mockResolvedValue({ blob: new Blob(["x"]), fileName: "s.csv" });
    businessMasterService.currencyList.mockResolvedValue({ rows: [], rowsNumber: 0 });
    businessMasterService.paymentTermList.mockResolvedValue({ rows: [], rowsNumber: 0 });
    const { body, router } = await mountPage({ permissions: ["supplier.view", "supplier.mgmt", "business_master.view"], initialRoute: "/suppliers?currencyCode=USD&paymentTermId=3&missingPrimaryContact=true"
      + "&missingAddress=true&missingBank=true&includeArchived=true&createdFrom=2026-10-01&createdTo=2026-10-02&updatedTo=2026-10-15" });
    const expected = {
      currencyCode: "USD", paymentTermId: 3, missingPrimaryContact: true, missingAddress: true, missingBank: true, includeArchived: true,
      createdFrom: Date.parse("2026-09-30T16:00:00Z"), createdTo: Date.parse("2026-10-02T15:59:59.999Z"),
      updatedFrom: undefined, updatedTo: Date.parse("2026-10-15T15:59:59.999Z")
    };
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining(expected));
    expect(router.currentRoute.value.query).toMatchObject({ currencyCode: "USD", paymentTermId: "3", missingBank: "true", createdFrom: "2026-10-01" });
    expect(router.currentRoute.value.query.updatedFrom).toBeUndefined();

    await body.findAll("button").find((button) => button.text().includes("匯出 CSV")).trigger("click");
    await flushPromises();
    expect(supplierService.exportCsv).toHaveBeenCalledWith(expect.objectContaining(expected));
    click.mockRestore();
  });

  it("TC-015 (LIST-008): ignores malformed filter values in the URL", async () => {
    await mountPage({ initialRoute: "/suppliers?currencyCode=usd&paymentTermId=-1&missingBank=1&createdFrom=yesterday" });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({
      currencyCode: null, paymentTermId: null, missingBank: false, createdFrom: undefined
    }));
  });

  it("reloads and updates the URL when a missing-data filter is ticked", async () => {
    const { body, router } = await mountPage();
    supplierService.list.mockClear();
    await body.findAll(".q-checkbox").find((box) => box.text().includes("缺有效銀行資料")).trigger("click");
    await flushPromises();
    expect(supplierService.list).toHaveBeenCalledWith(expect.objectContaining({ missingBank: true }));
    expect(router.currentRoute.value.query.missingBank).toBe("true");
  });

  it("TC-127 (UI-007): flags a date range that ends before it starts", async () => {
    const { body } = await mountPage({ initialRoute: "/suppliers?updatedFrom=2026-10-15&updatedTo=2026-10-01" });
    expect(body.text()).toContain("結束日期不可早於開始日期");
  });

  it("offers currency and payment-term filters only with business_master.view, including inactive masters", async () => {
    businessMasterService.currencyList.mockResolvedValue({ rows: [{ code: "USD", name: "US Dollar" }], rowsNumber: 1 });
    businessMasterService.paymentTermList.mockResolvedValue({ rows: [{ id: 3, code: "N30", name: "Net 30" }], rowsNumber: 1 });
    let result = await mountPage();
    expect(businessMasterService.currencyList).not.toHaveBeenCalled();
    expect(result.body.findAll(".q-field").some((field) => field.text().includes("貨幣"))).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";

    result = await mountPage({ permissions: ["supplier.view", "business_master.view"] });
    expect(businessMasterService.currencyList).toHaveBeenCalledWith({ page: 1, rowsPerPage: 100, sortBy: "code" });
    expect(businessMasterService.paymentTermList).toHaveBeenCalledWith({ page: 1, rowsPerPage: 100, sortBy: "code" });
    expect(result.body.findAll(".q-field").some((field) => field.text().includes("貨幣"))).toBe(true);
    expect(result.body.findAll(".q-field").some((field) => field.text().includes("付款條件"))).toBe(true);
  });

  it("goes back to page 1 when a filter changes (REV-095 M-1)", async () => {
    const { body, router } = await mountPage({ initialRoute: "/suppliers?page=3&sortBy=supplierName&descending=false" });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    await body.findAll(".q-checkbox").find((box) => box.text().includes("缺採購地址")).trigger("click");
    await flushPromises();
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1, missingAddress: true, sortBy: "supplierName", descending: false
    }));
    expect(router.currentRoute.value.query.page).toBe("1");
  });

  it("ignores currency and payment term from the URL without business_master.view (REV-095 M-2)", async () => {
    const { router } = await mountPage({ permissions: ["supplier.view"], initialRoute: "/suppliers?currencyCode=USD&paymentTermId=3" });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({ currencyCode: null, paymentTermId: null }));
    expect(router.currentRoute.value.query.currencyCode).toBeUndefined();
    expect(router.currentRoute.value.query.paymentTermId).toBeUndefined();
  });

  it.each([
    ["createdFrom=2026-13-01"], ["createdFrom=2026-02-31"], ["createdFrom=0000-01-01"], ["createdFrom=1970-01-01"]
  ])("drops a date that has the right shape but is not a usable day: %s (REV-095 L-1)", async (query) => {
    await mountPage({ initialRoute: `/suppliers?${query}` });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({ createdFrom: undefined }));
  });

  it("drops a payment term id that is not a whole number (REV-095 L-1)", async () => {
    businessMasterService.currencyList.mockResolvedValue({ rows: [], rowsNumber: 0 });
    businessMasterService.paymentTermList.mockResolvedValue({ rows: [], rowsNumber: 0 });
    await mountPage({ permissions: ["supplier.view", "business_master.view"], initialRoute: "/suppliers?paymentTermId=3.5&currencyCode=USD" });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({ paymentTermId: null, currencyCode: "USD" }));
  });

  it("keeps a real leap day", async () => {
    await mountPage({ initialRoute: "/suppliers?createdFrom=2028-02-29" });
    expect(supplierService.list).toHaveBeenLastCalledWith(expect.objectContaining({ createdFrom: Date.parse("2028-02-28T16:00:00Z") }));
  });

  it("renders markup in Supplier fields as text, never as elements (AUTH-009 client side)", async () => {
    const { body, wrapper } = await mountPage();
    supplierService.list.mockResolvedValue({ rows: [{ ...ROW, supplierName: "<script>window.__xss = 1</script>",
      displayName: "<img src=x onerror=\"window.__xss = 2\">", primaryContactName: "<b>bold</b>" }], rowsNumber: 1 });
    await body.findAll(".q-checkbox").find((box) => box.text().includes("包括已封存")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("<script>window.__xss = 1</script>");
    expect(body.text()).toContain("<b>bold</b>");
    expect(wrapper.element.querySelector("script, img[onerror], b")).toBeNull();
  });

  it("TC-127 (UI-007): shows updated times in Hong Kong time whatever the browser's zone, across a year boundary (AUD-008 UI)", async () => {
    supplierService.list.mockResolvedValue({ rows: [{ ...ROW, updatedAt: Date.parse("2025-12-31T16:30:00Z") }], rowsNumber: 1 });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SuppliersPage }] });
    await router.push("/suppliers");
    await router.isReady();
    useSessionStore().user = { id: 1, permissions: ["supplier.view"], roles: [] };
    mount(SuppliersPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();
    // 測試以 UTC 跑：UTC 仲係 2025-12-31 16:30，香港已經係 2026-01-01 00:30。
    const text = new DOMWrapper(document.body).text();
    expect(text).toMatch(/2026/u);
    expect(text).toMatch(/12:30|00:30|0:30/u);
    expect(text).not.toMatch(/2025/u);
  });
});

