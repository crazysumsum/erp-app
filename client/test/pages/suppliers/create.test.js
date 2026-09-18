import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QSelect, Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { create: vi.fn(), checkDuplicates: vi.fn() },
  service: { name: "supplier" }
}));
vi.mock("@/services/businessMaster.js", () => ({
  default: { currencyList: vi.fn(), paymentTermList: vi.fn() },
  service: { name: "businessMaster" }
}));
vi.mock("@/services/supplierApproval.js", () => ({
  default: { activationPolicy: vi.fn(), eligibleApprovers: vi.fn() },
  service: { name: "supplierApproval" }
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn()
}));

import businessMasterService from "@/services/businessMaster.js";
import supplierApprovalService from "@/services/supplierApproval.js";
import supplierService from "@/services/supplier.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SupplierCreatePage, { page } from "@/pages/suppliers/SupplierCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

const RouterViewHost = { render: () => h(RouterView) };
let currentWrapper;

async function mountPage({ requireActivationApproval = false, approvers = [] } = {}) {
  supplierApprovalService.activationPolicy.mockResolvedValue({ requireActivationApproval });
  supplierApprovalService.eligibleApprovers.mockResolvedValue({ items: approvers });
  businessMasterService.currencyList.mockResolvedValue({
    rows: [{ code: "HKD", name: "Hong Kong Dollar", version: 3 }],
    rowsNumber: 1
  });
  businessMasterService.paymentTermList.mockResolvedValue({ rows: [], rowsNumber: 0 });
  supplierService.checkDuplicates.mockResolvedValue({ duplicateCandidates: [] });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, name: page.name, component: SupplierCreatePage },
      { path: "/suppliers", component: { template: "<div>suppliers</div>" } }
    ]
  });
  await router.push(page.path);
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, permissions: ["supplier.mgmt"], roles: [] };
  currentWrapper = mount(RouterViewHost, {
    global: { plugins: [Quasar, router] },
    attachTo: document.body
  });
  await flushPromises();
  return { wrapper: currentWrapper, router, body: new DOMWrapper(document.body) };
}

function input(body, label) {
  return body.findAll(".q-field").find((field) => field.text().includes(label)).find("input, textarea");
}

async function fillRequired(wrapper, body) {
  await input(body, "Supplier Code *").setValue(" SUP-041 ");
  await input(body, "Supplier Name *").setValue(" Evergreen Trading ");
  const currency = wrapper.findAllComponents(QSelect).find((select) => select.props("label") === "Default Currency *");
  currency.vm.$emit("update:modelValue", "HKD");
  await flushPromises();
}

describe("pages/suppliers/SupplierCreatePage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  afterEach(() => {
    currentWrapper?.unmount();
    currentWrapper = null;
  });

  it("requires supplier.mgmt even when opened by direct URL", () => {
    expect(page.requires).toEqual({ permissions: ["supplier.mgmt"] });
    expect(page.menu).toBeUndefined();
  });

  it("saves a draft with only Code, Name and an active Currency", async () => {
    supplierService.create.mockResolvedValue({
      id: 41, supplierCode: "SUP-041", status: "draft", warnings: [{ message: "尚未設定地址" }]
    });
    const { wrapper, body } = await mountPage();
    await fillRequired(wrapper, body);

    await wrapper.find('button[aria-label="儲存 Draft"]').trigger("click");
    await flushPromises();

    expect(supplierService.create).toHaveBeenCalledWith(expect.objectContaining({
      supplierCode: "SUP-041",
      supplierName: "Evergreen Trading",
      defaultCurrencyCode: "HKD",
      defaultCurrencyVersion: 3,
      activate: false
    }));
    expect(body.text()).toContain("SUP-041");
    expect(body.text()).toContain("草稿");
    expect(body.text()).toContain("下一步");
    expect(body.text()).toContain("尚未設定地址");
    expect(notifySuccess).toHaveBeenCalled();
  });

  it("requires explicit confirmation before creating a possible duplicate", async () => {
    supplierService.create.mockResolvedValue({ id: 41, supplierCode: "SUP-041", status: "active", warnings: [] });
    const { wrapper, body } = await mountPage();
    supplierService.checkDuplicates.mockResolvedValue({
      duplicateCandidates: [{ supplierId: 9, supplierCode: "SUP-009", supplierName: "Evergreen Trade", score: 0.91 }]
    });
    await fillRequired(wrapper, body);

    await wrapper.find('button[aria-label="直接啟用"]').trigger("click");
    await flushPromises();
    expect(supplierService.create).not.toHaveBeenCalled();
    expect(body.text()).toContain("SUP-009");

    await wrapper.find('button[aria-label="確認重複提示並繼續"]').trigger("click");
    await flushPromises();
    expect(supplierService.create).toHaveBeenCalledWith(expect.objectContaining({ activate: true }));
  });

  it("prompts before leaving a dirty form", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { body, router } = await mountPage();
    await input(body, "Supplier Name *").setValue("Evergreen Trading");

    await router.push("/suppliers");
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未儲存"));
    confirm.mockRestore();
  });

  // ---- T30 AC 1: the approver selector ------------------------------------

  it("does not offer an approver, or send one, when the policy is off", async () => {
    // 設計 §6.2：政策關閉時帶 approverUserId 會 400 APPROVER_NOT_REQUIRED。
    supplierService.create.mockResolvedValue({ id: 41, supplierCode: "SUP-041", status: "active" });
    const { wrapper, body } = await mountPage({ requireActivationApproval: false });
    await fillRequired(wrapper, body);

    expect(body.text()).not.toContain("啟用審批");
    expect(supplierApprovalService.eligibleApprovers).not.toHaveBeenCalled();

    await body.findAll("button").find((candidate) => candidate.text().includes("直接啟用")).trigger("click");
    await flushPromises();

    const [payload] = supplierService.create.mock.calls[0];
    expect(payload.activate).toBe(true);
    expect("approverUserId" in payload).toBe(false);
  });

  it("offers an approver selector that excludes the actor when the policy is on", async () => {
    // AC-009：唔可以揀自己。伺服器一樣會拒絕，但唔應該俾使用者揀完先話佢知。
    const { body } = await mountPage({
      requireActivationApproval: true,
      approvers: [{ id: 2, username: "checker", displayName: "Checker" }]
    });
    expect(body.text()).toContain("啟用審批");
    expect(supplierApprovalService.eligibleApprovers).toHaveBeenCalledWith(
      expect.objectContaining({ excludeUserId: 1 })
    );
    // 政策開啟時，啟用掣講嘅係提交審批，唔係直接啟用。
    expect(body.text()).toContain("提交審批");
    expect(body.text()).not.toContain("直接啟用");
  });

  it("sends the chosen approver, and refuses to submit without one", async () => {
    supplierService.create.mockResolvedValue({ id: 41, supplierCode: "SUP-041", status: "pending_approval" });
    const { wrapper, body } = await mountPage({
      requireActivationApproval: true,
      approvers: [{ id: 2, username: "checker", displayName: "Checker" }]
    });
    await fillRequired(wrapper, body);

    await body.findAll("button").find((candidate) => candidate.text().includes("提交審批")).trigger("click");
    await flushPromises();
    expect(supplierService.create).not.toHaveBeenCalled();
    expect(body.text()).toContain("請先選擇審批人");

    const approver = wrapper.findAllComponents(QSelect).find((select) => select.props("label") === "審批人");
    approver.vm.$emit("update:modelValue", 2);
    await flushPromises();

    await body.findAll("button").find((candidate) => candidate.text().includes("提交審批")).trigger("click");
    await flushPromises();

    const [payload] = supplierService.create.mock.calls[0];
    expect(payload).toMatchObject({ activate: true, approverUserId: 2 });
  });
});
