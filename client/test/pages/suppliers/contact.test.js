import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { createContact: vi.fn(), updateContact: vi.fn(), deactivateContact: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import supplierService from "@/services/supplier.js";
import { confirm } from "@/framework/ui/confirm.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SupplierContactPanel from "@/components/suppliers/SupplierContactPanel.vue";

const CONTACTS = [{
  id: 21, supplierId: 7, name: "Amy Chan", jobTitle: "Buyer", department: "Purchasing",
  email: "amy@example.com", phone: "+852 2123 4567", mobile: "", preferredLanguage: "zh-HK", notes: "",
  status: "active", purposes: [{ purposeCode: "orders", isPrimary: true }], version: 1, updatedAt: 100
}, {
  id: 22, supplierId: 7, name: "Former Buyer", jobTitle: "", department: "", email: "", phone: "", mobile: "",
  preferredLanguage: "", notes: "", status: "inactive", purposes: [{ purposeCode: "orders", isPrimary: false }],
  version: 2, updatedAt: 90
}];

function mountPanel({ canManage = true, contacts = CONTACTS } = {}) {
  const wrapper = mount(SupplierContactPanel, {
    props: { supplierId: 7, supplierCode: "SUP-007", contacts, canManage },
    global: { plugins: [Quasar] }, attachTo: document.body
  });
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("SupplierContactPanel", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("shows purpose/primary and contact details while hiding writes from view-only users", () => {
    const { body } = mountPanel({ canManage: false });
    expect(body.text()).toContain("訂單聯絡（主要）");
    expect(body.text()).toContain("amy@example.com");
    expect(body.text()).toContain("已停用");
    expect(body.findAll(".q-btn").some((button) => button.text().includes("新增聯絡人"))).toBe(false);
  });

  it("creates a Contact and emits refresh with a Supplier-identifying success message", async () => {
    supplierService.createContact.mockResolvedValue({ ...CONTACTS[0], id: 23, name: "Ben Lee" });
    const { wrapper, body } = mountPanel();
    await body.findAll(".q-btn").find((button) => button.text().includes("新增聯絡人")).trigger("click");
    await flushPromises();
    await body.findAll(".q-field").find((field) => field.text().includes("姓名")).find("input").setValue("Ben Lee");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(supplierService.createContact).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Ben Lee", purposes: [] }));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("SUP-007"));
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("keeps the edit dialog and draft open on VERSION_CONFLICT", async () => {
    supplierService.updateContact.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" }));
    const { body } = mountPanel();
    await body.find('[aria-label="編輯聯絡人 Amy Chan"]').trigger("click");
    await flushPromises();
    const name = body.findAll(".q-field").find((field) => field.text().includes("姓名")).find("input");
    await name.setValue("Amy Updated");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(body.text()).toContain("其他人修改");
    expect(name.element.value).toBe("Amy Updated");
  });

  it("surfaces server validation accessibly and deactivates only after confirmation", async () => {
    supplierService.createContact.mockRejectedValue(Object.assign(new Error("Email 格式不正確"), { code: "EMAIL_INVALID" }));
    confirm.mockResolvedValue(true);
    supplierService.deactivateContact.mockResolvedValue({ ...CONTACTS[0], status: "inactive", version: 2 });
    const { body } = mountPanel();
    await body.findAll(".q-btn").find((button) => button.text().includes("新增聯絡人")).trigger("click");
    await flushPromises();
    await body.findAll(".q-field").find((field) => field.text().includes("姓名")).find("input").setValue("Ben Lee");
    await body.findAll(".q-btn").find((button) => button.text() === "儲存").trigger("click");
    await flushPromises();
    expect(body.find('[role="alert"]').text()).toContain("Email 格式不正確");
    await body.findAll(".q-btn").find((button) => button.text() === "取消").trigger("click");
    await body.find('[aria-label="停用聯絡人 Amy Chan"]').trigger("click");
    await flushPromises();
    expect(supplierService.deactivateContact).toHaveBeenCalledWith(7, 21, { version: 1 });
    expect(body.find('[aria-label="編輯聯絡人 Former Buyer"]').exists()).toBe(false);
  });
});
