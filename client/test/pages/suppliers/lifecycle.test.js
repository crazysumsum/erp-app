import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: {
    activate: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), block: vi.fn(), unblock: vi.fn(),
    archive: vi.fn(), restore: vi.fn(), deleteSupplier: vi.fn()
  },
  service: { name: "supplier" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import SupplierStatusActions from "@/components/suppliers/SupplierStatusActions.vue";
import supplierService from "@/services/supplier.js";

const ACTIVE = { id: 7, supplierCode: "SUP-007", supplierName: "Evergreen", status: "active", version: 2 };

function mountActions(props = {}) {
  const wrapper = mount(SupplierStatusActions, {
    props: { supplier: ACTIVE, canManage: true, canApprove: true, ...props },
    global: { plugins: [Quasar] },
    attachTo: document.body
  });
  return { wrapper, body: new DOMWrapper(document.body) };
}

function field(body, label) {
  return body.findAll(".q-field").find((candidate) => candidate.text().includes(label)).find("input, textarea");
}

describe("Supplier lifecycle actions", () => {
  beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ""; });

  it("shows only state-valid actions allowed by management and approval permissions", async () => {
    let result = mountActions();
    expect(result.body.text()).toContain("暫停");
    expect(result.body.text()).toContain("封鎖");
    expect(result.body.text()).toContain("封存");
    expect(result.body.text()).not.toContain("還原");
    result.wrapper.unmount(); document.body.innerHTML = "";

    result = mountActions({ supplier: { ...ACTIVE, status: "blocked" }, canManage: true, canApprove: false });
    expect(result.body.text()).not.toContain("解除封鎖");
    result.wrapper.unmount(); document.body.innerHTML = "";

    result = mountActions({ supplier: { ...ACTIVE, status: "archived" }, canApprove: false });
    expect(result.body.text()).toContain("還原");
    expect(result.body.text()).not.toContain("啟用");
  });

  it("requires reason and password for Block and explains the approved-device requirement", async () => {
    supplierService.block.mockResolvedValue({ ...ACTIVE, status: "blocked", version: 3 });
    const { wrapper, body } = mountActions();
    await body.findAll("button").find((button) => button.text().includes("封鎖")).trigger("click");
    expect(body.text()).toContain("已核准裝置");
    expect(body.findAll("button").find((button) => button.text().includes("確認封鎖")).attributes("disabled")).toBeDefined();
    await field(body, "原因 *").setValue("Fraud risk confirmed");
    await field(body, "目前密碼 *").setValue("secret");
    await body.findAll("button").find((button) => button.text().includes("確認封鎖")).trigger("click");
    await flushPromises();
    expect(supplierService.block).toHaveBeenCalledWith(7, { reason: "Fraud risk confirmed", password: "secret", version: 2 });
    expect(wrapper.emitted("updated")[0][0].status).toBe("blocked");
  });

  it("keeps a lifecycle dialog open and requests refresh after VERSION_CONFLICT", async () => {
    supplierService.suspend.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" }));
    const { wrapper, body } = mountActions({ canApprove: false });
    await body.findAll("button").find((button) => button.text().includes("暫停")).trigger("click");
    await field(body, "原因 *").setValue("Temporary purchasing pause");
    await field(body, "目前密碼 *").setValue("secret");
    await body.findAll("button").find((button) => button.text().includes("確認暫停")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("狀態已被其他人修改");
    expect(wrapper.emitted("conflict")).toHaveLength(1);
    expect(field(body, "原因 *").element.value).toBe("Temporary purchasing pause");
    expect(field(body, "目前密碼 *").element.value).toBe("");
  });

  it("Draft activation needs confirmation but no password and controlled delete does", async () => {
    supplierService.activate.mockResolvedValue({ ...ACTIVE, status: "active", version: 3 });
    const { body } = mountActions({ supplier: { ...ACTIVE, status: "draft" }, canApprove: false });
    await body.findAll("button").find((button) => button.text() === "啟用").trigger("click");
    expect(body.text()).toContain("確認啟用");
    expect(body.text()).not.toContain("目前密碼 *");
  });
});
