import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { createIdentifier: vi.fn(), updateIdentifier: vi.fn(), deleteIdentifier: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import supplierService from "@/services/supplier.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SupplierIdentifierPanel from "@/components/suppliers/SupplierIdentifierPanel.vue";

const IDENTIFIERS = [{
  id: 31, supplierId: 7, identifierType: "business_registration", issuerCountryCode: "HK",
  identifierValue: "AB-123", notes: "", canDelete: true, version: 1, updatedAt: 100
}, {
  id: 32, supplierId: 7, identifierType: "tax", issuerCountryCode: "HK",
  identifierValue: "T-456", notes: "", canDelete: false, version: 2, updatedAt: 90
}];

function mountPanel({ canManage = true, identifiers = IDENTIFIERS } = {}) {
  const wrapper = mount(SupplierIdentifierPanel, {
    props: { supplierId: 7, supplierCode: "SUP-007", identifiers, canManage },
    global: { plugins: [Quasar] }, attachTo: document.body
  });
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("SupplierIdentifierPanel", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("renders type/country/value, hides writes from viewers and hides delete for referenced rows", () => {
    let result = mountPanel({ canManage: false });
    expect(result.body.text()).toContain("商業登記");
    expect(result.body.text()).toContain("HK — AB-123");
    expect(result.body.findAll(".q-btn").some((button) => button.text().includes("新增識別資料"))).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";
    result = mountPanel();
    expect(result.body.find('[aria-label="刪除識別資料 AB-123"]').exists()).toBe(true);
    expect(result.body.find('[aria-label="刪除識別資料 T-456"]').exists()).toBe(false);
  });

  it("creates an Identifier and emits refresh with a Supplier-identifying success message", async () => {
    supplierService.createIdentifier.mockResolvedValue({ ...IDENTIFIERS[0], id: 33 });
    const { wrapper, body } = mountPanel({ identifiers: [] });
    await body.findAll(".q-btn").find((button) => button.text().includes("新增識別資料")).trigger("click");
    await flushPromises();
    await body.findAll(".q-field").find((field) => field.text().includes("發證國家")).find("input").setValue("hk");
    await body.findAll(".q-field").find((field) => field.text().includes("識別值")).find("input").setValue("AB-123");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(supplierService.createIdentifier).toHaveBeenCalledWith(7, expect.objectContaining({
      identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: "AB-123"
    }));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("SUP-007"));
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("requires a reason for updates and preserves the draft on unique/version conflicts", async () => {
    supplierService.updateIdentifier.mockRejectedValue(Object.assign(new Error("這項供應商識別資料已被使用"), { code: "SUPPLIER_IDENTIFIER_TAKEN" }));
    const { body } = mountPanel();
    await body.find('[aria-label="編輯識別資料 AB-123"]').trigger("click");
    await flushPromises();
    const value = body.findAll(".q-field").find((field) => field.text().includes("識別值")).find("input");
    await value.setValue("CD-999");
    const save = body.findAll(".q-btn").find((button) => button.text() === "儲存");
    expect(save.attributes("disabled")).toBeDefined();
    await body.findAll(".q-field").find((field) => field.text().includes("修改原因")).find("textarea").setValue("證號修正");
    await save.trigger("click");
    await flushPromises();
    expect(body.find('[role="alert"]').text()).toContain("已被使用");
    expect(value.element.value).toBe("CD-999");
  });

  it("collects a reason before confirmed deletion", async () => {
    supplierService.deleteIdentifier.mockResolvedValue({ id: 31, deleted: true });
    const { wrapper, body } = mountPanel();
    await body.find('[aria-label="刪除識別資料 AB-123"]').trigger("click");
    await flushPromises();
    const confirmDelete = body.findAll(".q-btn").find((button) => button.text() === "確認刪除");
    expect(confirmDelete.attributes("disabled")).toBeDefined();
    await body.findAll(".q-field").find((field) => field.text().includes("刪除原因")).find("textarea").setValue("輸入錯誤");
    await confirmDelete.trigger("click");
    await flushPromises();
    expect(supplierService.deleteIdentifier).toHaveBeenCalledWith(7, 31, { version: 1, reason: "輸入錯誤" });
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });
});
