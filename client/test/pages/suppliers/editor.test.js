import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QSelect, Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { getById: vi.fn(), completeness: vi.fn(), update: vi.fn(), changeCode: vi.fn(), currencyOptions: vi.fn(), paymentTermOptions: vi.fn() },
  service: { name: "supplier" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import supplierService from "@/services/supplier.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SupplierDetailPage, { page } from "@/pages/suppliers/SupplierDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const DETAIL = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "draft", version: 2,
  website: "", generalPhone: "2123 4567", generalEmail: "orders@example.test", notes: "",
  createdAt: 100, updatedAt: 200, addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
};

const WARNING = "此供應商正在審批中，修改 Code、名稱、顯示名稱、幣別、付款條件或識別資料會令原申請失效";
const NOTICE = "原審批申請已失效，供應商回到草稿，需要重新提交審批";

let currentWrapper;

async function mountPage(detail = DETAIL, { paymentTermOptions } = {}) {
  supplierService.getById.mockResolvedValue(detail);
  supplierService.completeness.mockResolvedValue({
    supplierId: 7,
    issues: [],
    warnings: [{ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" }]
  });
  supplierService.currencyOptions.mockResolvedValue([
    { code: "HKD", name: "Hong Kong Dollar", version: 3 },
    { code: "USD", name: "US Dollar", version: 4 }
  ]);
  supplierService.paymentTermOptions.mockResolvedValue([
    { id: 9, code: "NET30", name: "Net 30", version: 2 }
  ]);
  paymentTermOptions?.(supplierService.paymentTermOptions);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, component: SupplierDetailPage },
      { path: "/suppliers", component: { template: "<div>supplier list</div>" } }
    ]
  });
  await router.push("/suppliers/7");
  await router.isReady();
  useSessionStore().user = { id: 1, permissions: ["supplier.view", "supplier.mgmt"], roles: [] };
  currentWrapper = mount({ render: () => h(RouterView) }, {
    global: { plugins: [Quasar, router] }, attachTo: document.body
  });
  await flushPromises();
  return { router, body: new DOMWrapper(document.body) };
}

function field(body, label) {
  return body.findAll(".q-field").find((candidate) => candidate.text().includes(label)).find("input, textarea");
}

describe("Supplier general editor", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });
  afterEach(() => { currentWrapper?.unmount(); currentWrapper = null; });

  it("updates editable root fields while keeping Supplier Code outside the normal payload", async () => {
    supplierService.update.mockImplementation(async (_id, payload) => ({ ...DETAIL, ...payload, version: 3 }));
    const { body } = await mountPage();
    expect(body.text()).toContain("資料完整度提示（不影響啟用）");
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Updated Supplier");
    await field(body, "備註（選填）").setValue("Updated note");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(supplierService.update).toHaveBeenCalledWith(7, expect.objectContaining({
      supplierName: "Updated Supplier", notes: "Updated note", version: 2
    }));
    expect(supplierService.update.mock.calls[0][1]).not.toHaveProperty("supplierCode");
    expect(body.text()).toContain("版本 3");
  });

  it("offers the Active currencies and payment terms from the Supplier lookups, not Business Master (DEF-036)", async () => {
    const { body } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await flushPromises();
    expect(supplierService.currencyOptions).toHaveBeenCalled();
    expect(supplierService.paymentTermOptions).toHaveBeenCalled();
    const options = (label) => currentWrapper.findAllComponents(QSelect).find((select) => select.props("label") === label)
      .props("options").map(({ label: text, value }) => ({ text, value }));
    expect(options("Default Currency *")).toEqual([{ text: "HKD — Hong Kong Dollar", value: "HKD" }, { text: "USD — US Dollar", value: "USD" }]);
    expect(options("預設付款條件（選填）")).toEqual([{ text: "NET30 — Net 30", value: 9 }]);
  });

  it("marks the payment-term field when the stored term is no longer active, instead of a bare banner (DEF-041, HD-134 A)", async () => {
    supplierService.update.mockRejectedValue(Object.assign(new Error("付款條款目前不可用"), { code: "PAYMENT_TERM_NOT_ACTIVE", status: 409, details: { id: 5 } }));
    const { body } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Renamed Supplier");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    const term = body.findAll(".q-field").find((item) => item.text().includes("預設付款條件（選填）"));
    expect(term.classes()).toContain("q-field--error");
    expect(term.text()).toContain("付款條款已停用，請改選或清除");
    expect(body.text()).toContain("付款條款已停用，請改選或清除後再儲存。");
  });

  it("names the payment term by code and name, and keeps a deactivated one readable in the editor without offering it (DEF-038)", async () => {
    const { body } = await mountPage({ ...DETAIL, defaultPaymentTermId: 5, defaultPaymentTerm: { id: 5, code: "OLD45", name: "Old Net 45", status: "INACTIVE" } });
    const overview = body.findAll(".q-item").find((item) => item.text().includes("付款條件"));
    expect(overview.text()).toContain("OLD45 — Old Net 45（已停用）");
    expect(overview.text()).not.toMatch(/付款條件\s*5$/u);
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await flushPromises();
    const select = currentWrapper.findAllComponents(QSelect).find((item) => item.props("label") === "預設付款條件（選填）");
    expect(select.props("options").map(({ label, value, disable }) => ({ label, value, disable: Boolean(disable) }))).toEqual([
      { label: "NET30 — Net 30", value: 9, disable: false },
      { label: "OLD45 — Old Net 45（已停用）", value: 5, disable: true }
    ]);
    expect(body.findAll(".q-field").find((field) => field.text().includes("預設付款條件（選填）")).text()).toContain("OLD45 — Old Net 45（已停用）");
  });

  it("shows an Active payment term plainly, once, in the overview and the editor (REV-116 L-1)", async () => {
    const { body } = await mountPage({ ...DETAIL, defaultPaymentTermId: 9, defaultPaymentTerm: { id: 9, code: "NET30", name: "Net 30", status: "ACTIVE" } });
    const overview = body.findAll(".q-item").find((item) => item.text().includes("付款條件"));
    expect(overview.text()).toContain("NET30 — Net 30");
    expect(overview.text()).not.toContain("已停用");
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await flushPromises();
    const select = currentWrapper.findAllComponents(QSelect).find((item) => item.props("label") === "預設付款條件（選填）");
    expect(select.props("options").map(({ label, value, disable }) => ({ label, value, disable: Boolean(disable) })))
      .toEqual([{ label: "NET30 — Net 30", value: 9, disable: false }]);
  });

  it("does not call an Active term inactive while the options are loading or failed to load (REV-116 M-1)", async () => {
    const active = { ...DETAIL, defaultPaymentTermId: 9, defaultPaymentTerm: { id: 9, code: "NET30", name: "Net 30", status: "ACTIVE" } };
    const pending = await mountPage(active, { paymentTermOptions: (mock) => mock.mockImplementation(() => new Promise(() => {})) });
    await pending.body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await flushPromises();
    let select = currentWrapper.findAllComponents(QSelect).find((item) => item.props("label") === "預設付款條件（選填）");
    expect(select.props("options")).toEqual([{ label: "NET30 — Net 30", value: 9, disable: false }]);
    currentWrapper.unmount();
    document.body.innerHTML = "";
    const failed = await mountPage(active, { paymentTermOptions: (mock) => mock.mockRejectedValue(new Error("down")) });
    await failed.body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await flushPromises();
    select = currentWrapper.findAllComponents(QSelect).find((item) => item.props("label") === "預設付款條件（選填）");
    expect(select.props("options")).toEqual([{ label: "NET30 — Net 30", value: 9, disable: false }]);
  });

  it("shows — rather than the ID when a stored term cannot be named (REV-116 L-1)", async () => {
    const { body } = await mountPage({ ...DETAIL, defaultPaymentTermId: 9, defaultPaymentTerm: null });
    const overview = body.findAll(".q-item").find((item) => item.text().includes("付款條件"));
    expect(overview.text()).toContain("—");
    expect(overview.text()).not.toContain("9");
  });

  it("says 未設定 when there is no payment term (DEF-038)", async () => {
    const { body } = await mountPage({ ...DETAIL, defaultPaymentTermId: null, defaultPaymentTerm: null });
    expect(body.findAll(".q-item").find((item) => item.text().includes("付款條件")).text()).toContain("未設定");
  });

  it("TC-123 (UI-003): keeps the user's draft visible when a stale update reloads the latest Supplier", async () => {
    supplierService.update.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" }));
    const { body } = await mountPage();
    supplierService.getById.mockResolvedValue({ ...DETAIL, supplierName: "Other User Value", version: 3 });
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("My Preserved Draft");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("輸入仍然保留");
    expect(field(body, "Supplier Name *").element.value).toBe("My Preserved Draft");
    expect(body.text()).toContain("最新版本 3");
  });

  it("uses a separate password-and-reason flow for controlled Supplier Code correction", async () => {
    supplierService.changeCode.mockResolvedValue({ ...DETAIL, supplierCode: "SUP-NEW", version: 3 });
    const { body } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("受控修正 Supplier Code")).trigger("click");
    await field(body, "新 Supplier Code *").setValue("SUP-NEW");
    await field(body, "修正原因 *").setValue("Correct onboarding typo");
    await field(body, "目前密碼 *").setValue("secret");
    await body.findAll("button").find((button) => button.text().includes("確認修正")).trigger("click");
    await flushPromises();
    expect(supplierService.changeCode).toHaveBeenCalledWith(7, {
      supplierCode: "SUP-NEW", reason: "Correct onboarding typo", password: "secret", version: 2
    });
    expect(body.text()).toContain("SUP-NEW");
  });

  it("TC-029 (CORE-013): prompts before leaving a dirty general editor", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { body, router } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Dirty Supplier");
    await router.push("/suppliers");
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未儲存"));
    confirm.mockRestore();
  });

  it("TC-123 (UI-003): asks the browser to confirm closing the tab only while the general editor is dirty", async () => {
    const { body } = await mountPage();
    // jsdom 冇 BeforeUnloadEvent：普通 Event 嘅 returnValue = "" 會當取消，令冇 preventDefault() 都過關。
    // 遮住佢，淨係量 preventDefault()——瀏覽器係靠呢個彈確認。
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      Object.defineProperty(event, "returnValue", { value: undefined, writable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    await field(body, "Supplier Name *").setValue("Dirty Supplier");
    expect(unload()).toBe(true);
  });

  it("warns before editing a Pending Supplier and says the request was invalidated after the save (DEF-044, HD-139 A)", async () => {
    const pending = { ...DETAIL, status: "pending_approval" };
    supplierService.update.mockResolvedValue({ ...DETAIL, supplierName: "Renamed", status: "draft", version: 3, approvalInvalidated: true });
    supplierService.changeCode.mockResolvedValue({ ...pending, supplierCode: "SUP-NEW", status: "draft", version: 3, approvalInvalidated: true });
    const { body } = await mountPage(pending);
    expect(body.text()).not.toContain(WARNING);
    await body.findAll("button").find((button) => button.text().includes("受控修正 Supplier Code")).trigger("click");
    await flushPromises();
    expect(body.find(".q-dialog").text()).toContain(WARNING);
    await field(body, "新 Supplier Code *").setValue("SUP-NEW");
    await field(body, "修正原因 *").setValue("Correct onboarding typo");
    await field(body, "目前密碼 *").setValue("secret");
    await body.findAll("button").find((button) => button.text().includes("確認修正")).trigger("click");
    await flushPromises();
    expect(notifySuccess).toHaveBeenLastCalledWith(`Supplier Code 已修正為 SUP-NEW。${NOTICE}`);

    currentWrapper.unmount();
    document.body.innerHTML = "";
    const again = await mountPage(pending);
    await again.body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    expect(again.body.text()).toContain(WARNING);
    await field(again.body, "Supplier Name *").setValue("Renamed");
    await again.body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(notifySuccess).toHaveBeenLastCalledWith(`供應商 SUP-007 的一般資料已更新。${NOTICE}`);
  });

  it("keeps the plain messages, and shows no warning, when nothing was Pending (DEF-044)", async () => {
    supplierService.update.mockResolvedValue({ ...DETAIL, version: 3, approvalInvalidated: false });
    const { body } = await mountPage();
    await body.findAll("button").find((button) => button.text().includes("編輯一般資料")).trigger("click");
    expect(body.text()).not.toContain(WARNING);
    await field(body, "Supplier Name *").setValue("Renamed");
    await body.findAll("button").find((button) => button.text().includes("儲存一般資料")).trigger("click");
    await flushPromises();
    expect(notifySuccess).toHaveBeenLastCalledWith("供應商 SUP-007 的一般資料已更新");
  });
});
