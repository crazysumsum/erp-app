import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: { activate: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), block: vi.fn(), unblock: vi.fn(), archive: vi.fn(), restore: vi.fn(), deleteCustomer: vi.fn() } }));
vi.mock("@/services/customerApproval.js", () => ({ default: { eligibleApprovers: vi.fn() } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
import customerService from "@/services/customer.js";
import customerApprovalService from "@/services/customerApproval.js";
import CustomerStatusActions from "@/components/customers/CustomerStatusActions.vue";

const customer = { id: 7, code: "CUS-007", legalName: "Evergreen", status: "active", version: 3 };
describe("CustomerStatusActions", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });
  it("shows only legal actions for the actor and state", () => {
    const wrapper = mount(CustomerStatusActions, { props: { customer, canManage: true, canApprove: false }, global: { plugins: [Quasar] } });
    expect(wrapper.text()).toContain("暫停"); expect(wrapper.text()).toContain("封存"); expect(wrapper.text()).not.toContain("封鎖");
  });
  it("keeps a conflict actionable and clears the password", async () => {
    customerService.suspend.mockRejectedValue(Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" }));
    const wrapper = mount(CustomerStatusActions, { props: { customer, canManage: true, canApprove: false }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await wrapper.findAll("button").find((button) => button.text() === "暫停").trigger("click"); await flushPromises();
    const inputs = body.findAll(".q-field"); await inputs.find((field) => field.text().includes("原因")).find("textarea").setValue("暫停進行覆核"); await inputs.find((field) => field.text().includes("目前密碼")).find("input").setValue("secret");
    await body.findAll("button").find((button) => button.text() === "確認暫停").trigger("click"); await flushPromises();
    expect(body.text()).toContain("載入最新資料"); expect(inputs.find((field) => field.text().includes("目前密碼")).find("input").element.value).toBe("");
    await body.findAll("button").find((button) => button.text() === "載入最新資料").trigger("click"); expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
  it("asks for another approver when activation policy requires one", async () => {
    customerService.activate
      .mockRejectedValueOnce(Object.assign(new Error("approver required"), { code: "APPROVER_REQUIRED" }))
      .mockResolvedValueOnce({ status: "pending_approval" });
    customerApprovalService.eligibleApprovers.mockResolvedValue({ items: [{ id: 9, username: "checker", displayName: "Checker" }] });
    const draft = { ...customer, status: "draft" };
    const wrapper = mount(CustomerStatusActions, { props: { customer: draft, canManage: true, username: "maker" }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body);

    await wrapper.findAll("button").find((button) => button.text() === "啟用").trigger("click");
    await body.findAll("button").find((button) => button.text() === "確認啟用").trigger("click");
    await flushPromises();

    expect(body.text()).toContain("審批人");
    expect(customerApprovalService.eligibleApprovers).toHaveBeenCalledWith({ excludeUserId: undefined });
    wrapper.findComponent({ name: "QSelect" }).vm.$emit("update:modelValue", 9);
    await flushPromises();
    await body.findAll("button").find((button) => button.text() === "確認提交審批").trigger("click");
    await flushPromises();

    expect(customerService.activate).toHaveBeenLastCalledWith(7, { version: 3, approverUserId: 9, requestNote: "" });
  });
  it("shows named downstream reference blockers", async () => {
    customerService.archive.mockRejectedValue(Object.assign(new Error("referenced"), { code: "CUSTOMER_REFERENCED", details: { providers: [{ id: "sales", status: "REFERENCE", referenceCount: 3 }] } }));
    const wrapper = mount(CustomerStatusActions, { props: { customer, canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body);
    await wrapper.findAll("button").find((button) => button.text() === "封存").trigger("click");
    await body.findAll(".q-field").find((field) => field.text().includes("原因")).find("textarea").setValue("封存進行覆核");
    await body.findAll(".q-field").find((field) => field.text().includes("目前密碼")).find("input").setValue("secret");
    await body.findAll("button").find((button) => button.text() === "確認封存").trigger("click");
    await flushPromises();
    expect(body.text()).toContain("sales：3");
  });
});
