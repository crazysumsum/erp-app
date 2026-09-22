import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerSettings.js", () => ({ default: { get: vi.fn(), update: vi.fn() } }));
vi.mock("@/services/customerCatalog.js", () => ({ default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() } }));
vi.mock("@/services/customerApproval.js", () => ({ default: { queue: vi.fn(), get: vi.fn(), eligibleApprovers: vi.fn(), approve: vi.fn(), reject: vi.fn(), reassign: vi.fn() } }));
vi.mock("@/services/customer.js", () => ({ default: { withdrawApproval: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import customerApprovalService from "@/services/customerApproval.js";
import customerCatalogService from "@/services/customerCatalog.js";
import customerSettingsService from "@/services/customerSettings.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import CustomerApprovalsPage, { page as approvalsPage } from "@/pages/customers/CustomerApprovalsPage.vue";
import CustomerSettingsPage, { page as settingsPage } from "@/pages/customers/CustomerSettingsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const requester = { id: 1, username: "maker", displayName: "Maker" };
const approver = { id: 2, username: "checker", displayName: "Checker" };
const row = { id: 11, customerId: 7, customerCode: "CUS-007", legalName: "Evergreen", customerStatus: "pending_approval", status: "pending", requester, assignedApprover: approver, requestNote: "請覆核", requestedAt: 1700000000000, decidedAt: null, version: 1 };
const snapshot = { customerCode: "CUS-007", legalName: "Evergreen", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, identifiers: [], creditStatus: "normal" };
const detail = (overrides = {}) => ({ ...row, decidedBy: null, decisionReason: "", customerVersion: 5, currentCustomerVersion: 5, stale: false, submitted: snapshot, current: snapshot, changedFields: [], ...overrides });

function button(body, label) { return body.findAll("button").find((candidate) => candidate.text().includes(label)); }

async function mountApprovals(actor = approver, permissions = ["customer.view", "customer.approval"]) {
  customerApprovalService.queue.mockResolvedValue({ rows: [row], rowsNumber: 1 });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: approvalsPage.path, component: CustomerApprovalsPage }] });
  await router.push(approvalsPage.path); await router.isReady();
  useSessionStore().user = { ...actor, permissions, roles: [] };
  const wrapper = mount(CustomerApprovalsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("Customer TASK-018 pages", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); customerCatalogService.list.mockResolvedValue({ items: [] }); });

  it("uses the approved routes and permission gates", () => {
    expect(approvalsPage.path).toBe("/customer-approvals");
    expect(approvalsPage.requires.permissions).toEqual(["customer.view", "customer.approval"]);
    expect(settingsPage.path).toBe("/customer-settings");
    expect(settingsPage.requires.permissions).toEqual(["customer.view", "customer.settings"]);
  });

  it("shows a stale diff, blocks approve and still allows reject", async () => {
    customerApprovalService.get.mockResolvedValue(detail({ stale: true, current: { ...snapshot, legalName: "Evergreen Trading", identifierCount: 2 }, submitted: { ...snapshot, identifierCount: 1 }, changedFields: ["legalName", "identifierCount"] }));
    customerApprovalService.eligibleApprovers.mockResolvedValue({ items: [] });
    const { body } = await mountApprovals();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("不能批准");
    expect(body.find('[data-field="legalName"]').text()).toContain("已變更");
    expect(body.find('[data-field="identifierCount"]').text()).toContain("2");
    expect(body.text()).toContain("提交時間");
    expect(button(body, "批准").attributes("disabled")).toBeDefined();
    expect(button(body, "拒絕").attributes("disabled")).toBeUndefined();
  });

  it("shows withdraw only when the requester still has customer.mgmt", async () => {
    customerApprovalService.get.mockResolvedValue(detail()); customerApprovalService.eligibleApprovers.mockResolvedValue({ items: [] });
    const denied = await mountApprovals(requester);
    await denied.body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click"); await flushPromises();
    expect(button(denied.body, "撤回")).toBeUndefined(); denied.wrapper.unmount(); document.body.innerHTML = "";
    const allowed = await mountApprovals(requester, ["customer.view", "customer.approval", "customer.mgmt"]);
    await allowed.body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click"); await flushPromises();
    expect(button(allowed.body, "撤回")).toBeDefined();
  });

  it("keeps the detail usable when eligible approvers cannot be loaded", async () => {
    customerApprovalService.get.mockResolvedValue(detail());
    customerApprovalService.eligibleApprovers.mockRejectedValue(new Error("網路錯誤"));
    const { body } = await mountApprovals();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    expect(body.text()).toContain("CUS-007");
    expect(button(body, "批准")).toBeDefined();
    expect(notifyError).toHaveBeenCalledWith("網路錯誤");
  });

  it("settings states prospective scope and sends reason, password and version", async () => {
    customerSettingsService.get.mockResolvedValue({ requireActivationApproval: false, version: 4, updatedAt: 1, updatedBy: 1 });
    customerSettingsService.update.mockResolvedValue({ requireActivationApproval: true, version: 5, updatedAt: 2, updatedBy: 1 });
    promptPassword.mockResolvedValue({ reason: "公司要求覆核", password: "pw" });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: settingsPage.path, component: CustomerSettingsPage }] });
    await router.push(settingsPage.path); await router.isReady();
    const wrapper = mount(CustomerSettingsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain("只影響之後提交");
    await wrapper.find(".q-toggle").trigger("click");
    await flushPromises();
    expect(customerSettingsService.update).toHaveBeenCalledWith({ requireActivationApproval: true, version: 4, reason: "公司要求覆核", password: "pw" });
    expect(customerCatalogService.list.mock.calls.map(([catalog]) => catalog)).toEqual(["categories", "industries", "territories"]);
  });
});
