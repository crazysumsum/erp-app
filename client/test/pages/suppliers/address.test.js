import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { createAddress: vi.fn(), updateAddress: vi.fn(), deactivateAddress: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import supplierService from "@/services/supplier.js";
import { confirm } from "@/framework/ui/confirm.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SupplierAddressPanel from "@/components/suppliers/SupplierAddressPanel.vue";

const ADDRESSES = [{
  id: 12, supplierId: 7, label: "總部", addressLine1: "1 Main Street", addressLine2: "", addressLine3: "",
  city: "Hong Kong", stateRegion: "", postalCode: "", countryCode: "HK", phone: "", notes: "", status: "active",
  purposes: [{ purposeCode: "ordering", isPrimary: true }], version: 1, updatedAt: 100
}, {
  id: 13, supplierId: 7, label: "舊址", addressLine1: "2 Old Road", addressLine2: "", addressLine3: "",
  city: "", stateRegion: "", postalCode: "", countryCode: null, phone: "", notes: "", status: "inactive",
  purposes: [{ purposeCode: "office", isPrimary: false }], version: 2, updatedAt: 90
}];

function mountPanel({ canManage = true, addresses = ADDRESSES } = {}) {
  const wrapper = mount(SupplierAddressPanel, {
    props: { supplierId: 7, supplierCode: "SUP-007", addresses, canManage },
    global: { plugins: [Quasar] }, attachTo: document.body
  });
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("SupplierAddressPanel", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("shows purpose/primary text and hides all writes from view-only users", () => {
    const { body } = mountPanel({ canManage: false });
    expect(body.text()).toContain("採購地址（主要）");
    expect(body.text()).toContain("已停用");
    expect(body.findAll(".q-btn").some((button) => button.text().includes("新增地址"))).toBe(false);
  });

  it("creates an Address and emits refresh with a Supplier-identifying success message", async () => {
    supplierService.createAddress.mockResolvedValue({ ...ADDRESSES[0], id: 14, label: "新倉" });
    const { wrapper, body } = mountPanel();
    await body.findAll(".q-btn").find((button) => button.text().includes("新增地址")).trigger("click");
    await flushPromises();
    await body.findAll(".q-field").find((field) => field.text().includes("地址標籤")).find("input").setValue("新倉");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(supplierService.createAddress).toHaveBeenCalledWith(7, expect.objectContaining({ label: "新倉", purposes: [] }));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("SUP-007"));
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("keeps the edit dialog and draft open on VERSION_CONFLICT", async () => {
    supplierService.updateAddress.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" }));
    const { body } = mountPanel();
    await body.findAll(".q-btn").find((button) => button.attributes("aria-label") === "編輯地址 總部").trigger("click");
    await flushPromises();
    const label = body.findAll(".q-field").find((field) => field.text().includes("地址標籤")).find("input");
    await label.setValue("我輸入的新名稱");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(body.text()).toContain("其他人修改");
    expect(label.element.value).toBe("我輸入的新名稱");
  });

  it("deactivates only after confirmation and inactive rows expose no write actions", async () => {
    confirm.mockResolvedValue(true);
    supplierService.deactivateAddress.mockResolvedValue({ ...ADDRESSES[0], status: "inactive", version: 2 });
    const { body } = mountPanel();
    expect(body.find('[aria-label="編輯地址 舊址"]').exists()).toBe(false);
    await body.find('[aria-label="停用地址 總部"]').trigger("click");
    await flushPromises();
    expect(supplierService.deactivateAddress).toHaveBeenCalledWith(7, 12, { version: 1 });
  });
});
