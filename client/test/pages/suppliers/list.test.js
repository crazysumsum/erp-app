import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const ROW = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, primaryContactName: "Amy Chan",
  status: "active", version: 2, updatedAt: 1700000000000
};

async function mountPage({ permissions = ["supplier.view", "supplier.mgmt"], initialRoute = "/suppliers" } = {}) {
  supplierService.list.mockResolvedValue({ rows: [ROW], rowsNumber: 1 });
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

  it("is the permission-filtered Supplier menu entry and renders explicit status text", async () => {
    expect(page.menu.group).toBe("suppliers");
    expect(page.requires.permissions).toEqual(["supplier.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("SUP-007");
    expect(body.text()).toContain("Amy Chan");
    expect(body.text()).toContain("啟用");
    expect(body.find('a[href="/suppliers/7"]').exists()).toBe(true);
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

  it("restores filters and paging from URL and keeps the query shareable", async () => {
    const { router } = await mountPage({ initialRoute: "/suppliers?page=2&q=evergreen&status=active&sortBy=supplierName&descending=false" });
    expect(supplierService.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, filter: "evergreen", status: "active", sortBy: "supplierName", descending: false
    }));
    expect(router.currentRoute.value.query.q).toBe("evergreen");
  });

  it("restores the HD-107 filters from the URL and sends them to the list and the export as Hong Kong day bounds", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    promptPassword.mockResolvedValue("pw");
    supplierService.exportCsv.mockResolvedValue({ blob: new Blob(["x"]), fileName: "s.csv" });
    const { body, router } = await mountPage({ initialRoute: "/suppliers?currencyCode=USD&paymentTermId=3&missingPrimaryContact=true"
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

  it("ignores malformed filter values in the URL", async () => {
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

  it("flags a date range that ends before it starts", async () => {
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
});
