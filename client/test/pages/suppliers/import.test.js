import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplierImport.js", () => ({
  default: {
    listJobs: vi.fn(), getJob: vi.fn(), downloadTemplate: vi.fn(), uploadJob: vi.fn(), confirmJob: vi.fn(),
    cancelJob: vi.fn(), downloadResult: vi.fn()
  },
  service: { name: "supplierImport" }
}));
vi.mock("@/services/supplierApproval.js", () => ({
  default: { activationPolicy: vi.fn(), eligibleApprovers: vi.fn() },
  service: { name: "supplierApproval" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import SupplierImportsPage, { page } from "@/pages/suppliers/SupplierImportsPage.vue";
import supplierApprovalService from "@/services/supplierApproval.js";
import supplierImportService from "@/services/supplierImport.js";
import { useSessionStore } from "@/stores/session.js";

/** TASK-046：匯入頁面嘅行為（service 用替身）。真瀏覽器流程喺 e2e/supplier-management/supplier-imports.spec.js。 */
const JOB = Object.freeze({
  id: 7, mode: "upsert", status: "ready_with_errors", totalCount: 3, validCount: 2, warningCount: 0, invalidCount: 1,
  appliedCount: 0, failedCount: 0, skippedCount: 0, lastErrorCode: "", errorSummary: "", filesPurged: false,
  confirmedAt: null, completedAt: null, version: 3, createdAt: 100, updatedAt: 100
});

async function mountPage(query = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SupplierImportsPage }] });
  await router.push({ path: page.path, query });
  await router.isReady();
  const wrapper = mount(SupplierImportsPage, { attachTo: document.body, global: { plugins: [Quasar, router] } });
  await flushPromises();
  return { wrapper, router };
}

function detail(job, rows = []) {
  supplierImportService.getJob.mockResolvedValue({ job: { ...JOB, ...job }, rows, rowsNumber: rows.length });
}

const text = () => document.body.textContent;

describe("supplier import page (T46)", () => {
  let wrapper;
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    useSessionStore().user = { id: 1, permissions: ["supplier.mgmt"], roles: [] };
    supplierImportService.listJobs.mockResolvedValue({ rows: [JOB], rowsNumber: 1 });
    supplierApprovalService.activationPolicy.mockResolvedValue({ requireActivationApproval: false });
    supplierApprovalService.eligibleApprovers.mockResolvedValue({ items: [{ id: 5, username: "boss", displayName: "Boss" }] });
    detail({});
  });
  afterEach(() => { wrapper?.unmount(); wrapper = null; });

  it("is gated by supplier.mgmt at /suppliers/imports and lists the uploader's jobs", async () => {
    ({ wrapper } = await mountPage());
    expect([page.path, page.requires.permissions]).toEqual(["/suppliers/imports", ["supplier.mgmt"]]);
    expect(text()).toContain("下載範本");
    expect(text()).toContain("上載 CSV");
    expect(text()).toContain("待確認（有錯誤列）");
  });

  it("reopens the job named in the URL after a refresh, and records the open job in the URL", async () => {
    let router;
    ({ wrapper, router } = await mountPage({ job: "7" }));
    expect(supplierImportService.getJob).toHaveBeenCalledWith(7, expect.objectContaining({ page: 1 }));
    expect(text()).toContain("匯入工作 #7");
    expect(router.currentRoute.value.query.job).toBe("7");
    expect(supplierImportService.confirmJob).not.toHaveBeenCalled();
  });

  it("confirms as draft with the password and no approver when approval is off", async () => {
    promptPassword.mockResolvedValue("pw");
    supplierImportService.confirmJob.mockResolvedValue({});
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(text()).toContain("審批設定以確認當刻為準");
    expect(text()).toContain("錯誤列不寫入");
    document.body.querySelector("[data-testid=confirm-step] button.q-btn--unelevated").click();
    await flushPromises();
    expect(supplierImportService.confirmJob).toHaveBeenCalledWith(7, { version: 3, activationMode: "draft", approverUserId: null, password: "pw" });
  });

  it("with approval on, activating needs an approver chosen from the eligible list, excluding the user", async () => {
    supplierApprovalService.activationPolicy.mockResolvedValue({ requireActivationApproval: true });
    promptPassword.mockResolvedValue("pw");
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(supplierApprovalService.eligibleApprovers).toHaveBeenCalledWith({ excludeUserId: 1 });
    const vm = wrapper.findComponent(SupplierImportsPage).vm;
    vm.$.setupState.activationMode = "activate";
    await flushPromises();
    expect(text()).toContain("會以待審批狀態送交所選審批人");
    document.body.querySelector("[data-testid=confirm-step] button.q-btn--unelevated").click();
    await flushPromises();
    expect(notifyError).toHaveBeenCalledWith("目前設定要求審批，請選擇審批人");
    expect(promptPassword).not.toHaveBeenCalled();
    vm.$.setupState.approverUserId = 5;
    await flushPromises();
    document.body.querySelector("[data-testid=confirm-step] button.q-btn--unelevated").click();
    await flushPromises();
    expect(supplierImportService.confirmJob).toHaveBeenCalledWith(7, { version: 3, activationMode: "activate", approverUserId: 5, password: "pw" });
  });

  it("shows a stopped job, retryable rows and the result download; an expired result says the summary stays", async () => {
    detail({ status: "failed", confirmedAt: 200, appliedCount: 1, failedCount: 1, lastErrorCode: "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED",
      errorSummary: "確認人的供應商管理權限已失效" }, [
      { rowNumber: 1, operation: "create", status: "applied", errors: [], warnings: [] },
      { rowNumber: 2, operation: "create", status: "failed", errors: [{ code: "SUPPLIER_IMPORT_ROW_BUSY", message: "資料暫時被其他操作佔用" }], warnings: [] }
    ]);
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(text()).toContain("確認人的供應商管理權限已失效，工作已停止");
    expect(text()).toContain("可重新匯入");
    expect(text()).toContain("下載結果");
    expect(text()).not.toContain("確認匯入");
    wrapper.unmount();

    detail({ status: "completed", confirmedAt: 200, filesPurged: true });
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(text()).toContain("結果已過保留期限（摘要仍可查閱）");
    expect(text()).not.toContain("下載結果");
  });

  it("a job that never ran offers no result", async () => {
    detail({ status: "cancelled", filesPurged: true });
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(text()).not.toContain("下載結果");
    expect(text()).not.toContain("結果已過保留期限");
  });

  it("filters rows by status and row number", async () => {
    ({ wrapper } = await mountPage({ job: "7" }));
    const vm = wrapper.findComponent(SupplierImportsPage).vm;
    vm.$.setupState.rowStatus = "invalid";
    vm.$.setupState.rowNumber = 3;
    vm.$.setupState.reloadRows();
    await flushPromises();
    expect(supplierImportService.getJob).toHaveBeenLastCalledWith(7, expect.objectContaining({ rowStatus: "invalid", rowNumber: 3 }));
  });
});
