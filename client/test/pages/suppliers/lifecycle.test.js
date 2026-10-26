import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: {
    activate: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), block: vi.fn(), unblock: vi.fn(),
    archive: vi.fn(), restore: vi.fn(), deleteSupplier: vi.fn()
  },
  service: { name: "supplier" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/services/supplierApproval.js", () => ({
  default: { activationPolicy: vi.fn(), eligibleApprovers: vi.fn() },
  service: { name: "supplierApproval" }
}));

import SupplierStatusActions from "@/components/suppliers/SupplierStatusActions.vue";
import supplierService from "@/services/supplier.js";
import supplierApprovalService from "@/services/supplierApproval.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { QSelect } from "quasar";

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
  // DEF-042：「啟用」對話框入面嘅審批 panel 會讀政策同 session；預設政策關閉。
  beforeEach(() => {
    setActivePinia(createPinia());
    supplierApprovalService.activationPolicy.mockResolvedValue({ requireActivationApproval: false });
    supplierApprovalService.eligibleApprovers.mockResolvedValue({ items: [] });
  });

  it("TC-124 (UI-004): shows only state-valid actions allowed by management and approval permissions", async () => {
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

  it("TC-124 (UI-004): requires reason and password for Block and explains the approved-device requirement", async () => {
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

  it("TC-124 (UI-004): keeps a lifecycle dialog open and requests refresh after VERSION_CONFLICT", async () => {
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

  it("with approval on, activating a Draft from the detail submits it to a chosen approver (DEF-042, HD-138 A)", async () => {
    supplierApprovalService.activationPolicy.mockResolvedValue({ requireActivationApproval: true });
    supplierApprovalService.eligibleApprovers.mockResolvedValue({ items: [{ id: 41, username: "approver-a", displayName: "Approver A" }] });
    supplierService.activate.mockResolvedValue({ ...ACTIVE, status: "pending_approval", version: 3 });
    const { wrapper, body } = mountActions({ supplier: { ...ACTIVE, status: "draft" }, canApprove: false });
    await body.findAll("button").find((button) => button.text() === "啟用").trigger("click");
    await flushPromises();
    const dialog = body.find(".q-dialog");
    expect(dialog.text()).toContain("提交審批供應商");
    expect(dialog.text()).toContain("完成後狀態：待審批");
    const confirm = body.findAll("button").find((button) => button.text() === "確認提交審批");
    expect(confirm.attributes("disabled")).toBeDefined();
    wrapper.findAllComponents(QSelect).find((select) => select.props("label") === "審批人").vm.$emit("update:modelValue", 41);
    await flushPromises();
    await field(body, "給審批人的備註（選填）").setValue("please check");
    await flushPromises();
    expect(body.findAll("button").find((button) => button.text() === "確認提交審批").attributes("disabled")).toBeUndefined();
    await body.find("form").trigger("submit");
    await flushPromises();
    expect(supplierService.activate).toHaveBeenCalledWith(7, { version: 2, approverUserId: 41, requestNote: "please check" });
    expect(notifySuccess).toHaveBeenCalledWith("供應商 SUP-007 已提交審批");
    expect(wrapper.emitted("updated")).toBeTruthy();
  });

  it("with approval off, activating a Draft sends no approver (DEF-042)", async () => {
    supplierService.activate.mockResolvedValue({ ...ACTIVE, status: "active", version: 3 });
    const { body } = mountActions({ supplier: { ...ACTIVE, status: "draft" }, canApprove: false });
    await body.findAll("button").find((button) => button.text() === "啟用").trigger("click");
    await flushPromises();
    expect(body.find(".q-dialog").text()).toContain("完成後狀態：啟用");
    expect(body.find(".q-dialog").text()).not.toContain("審批人");
    await body.find("form").trigger("submit");
    await flushPromises();
    expect(supplierService.activate).toHaveBeenCalledWith(7, { version: 2 });
  });

  it("TC-124 (UI-004): Draft activation needs confirmation but no password", async () => {
    supplierService.activate.mockResolvedValue({ ...ACTIVE, status: "active", version: 3 });
    const { body } = mountActions({ supplier: { ...ACTIVE, status: "draft" }, canApprove: false });
    await body.findAll("button").find((button) => button.text() === "啟用").trigger("click");
    expect(body.text()).toContain("確認啟用");
    expect(body.text()).not.toContain("目前密碼 *");
  });

  it.each([
    ["封存", "已封存", ACTIVE, false],
    ["永久刪除", "永久刪除", { ...ACTIVE, status: "draft" }, true]
  ])("TC-124 (UI-004): the %s dialog names the Supplier, the end state, the kept history and its password rule", async (label, target, supplier, device) => {
    const { body } = mountActions({ supplier, canApprove: false });
    await body.findAll("button").find((button) => button.text() === label).trigger("click");
    const dialog = body.find(".q-dialog");
    expect(dialog.text()).toContain("SUP-007 — Evergreen");
    expect(dialog.text()).toContain(`完成後狀態：${target}`);
    expect(dialog.text()).toContain("現有交易及稽核歷史會保留");
    expect(dialog.text()).toContain("永久刪除只允許從未引用的 Draft");
    expect(dialog.text().includes("已核准裝置")).toBe(device);
    expect(field(body, "原因 *").exists()).toBe(true);
    expect(field(body, "目前密碼 *").exists()).toBe(true);
    expect(body.findAll("button").find((button) => button.text().includes(`確認${label}`)).attributes("disabled")).toBeDefined();
  });
});
