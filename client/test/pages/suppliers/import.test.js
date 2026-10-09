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

  it("saves downloads under the server's file name, or the old default when the header is unreadable (T46 I-2)", async () => {
    const names = [];
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function record() { names.push(this.download); });
    supplierImportService.downloadTemplate.mockResolvedValueOnce({ blob: new Blob(["x"]), fileName: "供應商範本.csv" })
      .mockResolvedValueOnce({ blob: new Blob(["x"]), fileName: null });
    ({ wrapper } = await mountPage());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      [...document.body.querySelectorAll("button")].find((button) => button.textContent.includes("下載範本")).click();
      await flushPromises();
    }
    expect(names).toEqual(["供應商範本.csv", "supplier-import-template-v1.csv"]);
    click.mockRestore();
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

  it("REV-073 L-4: a failed precheck never ran, so it offers neither a download nor an expiry note", async () => {
    detail({ status: "failed", confirmedAt: null, filesPurged: true, lastErrorCode: "SUPPLIER_IMPORT_CSV_MALFORMED", errorSummary: "CSV 格式錯誤" });
    ({ wrapper } = await mountPage({ job: "7" }));
    expect(text()).toContain("CSV 格式錯誤");
    expect(text()).not.toContain("下載結果");
    expect(text()).not.toContain("結果已過保留期限");
  });

  it("REV-073 L-3: a malformed ?job= opens nothing and is dropped from the URL", async () => {
    for (const job of ["abc", "0", "-1", "1.5", "7x", "9007199254740992", "9999999999999999"]) {
      let router;
      ({ wrapper, router } = await mountPage({ job }));
      expect(supplierImportService.getJob).not.toHaveBeenCalled();
      expect(text()).not.toContain("匯入工作 #");
      expect(router.currentRoute.value.query.job).toBeUndefined();
      wrapper.unmount();
      wrapper = null;
    }
  });

  it("REV-073 L-2: a late answer to an older row request does not replace the newer one", async () => {
    ({ wrapper } = await mountPage({ job: "7" }));
    let releaseOld;
    supplierImportService.getJob
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve({ job: JOB, rows: [{ rowNumber: 1, operation: "create", status: "valid", errors: [], warnings: [] }], rowsNumber: 1 }); }))
      .mockResolvedValueOnce({ job: JOB, rows: [{ rowNumber: 12, operation: "create", status: "valid", errors: [], warnings: [] }], rowsNumber: 1 });
    const vm = wrapper.findComponent(SupplierImportsPage).vm;
    const older = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
    const newer = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
    const fromNewer = await newer;
    releaseOld();
    const fromOlder = await older;
    expect(fromNewer.rows.map((row) => row.rowNumber)).toEqual([12]);
    expect(fromOlder.rows.map((row) => row.rowNumber)).toEqual([12]);
  });

  it("REV-074 L-1/I-2: a late failure of an older request neither blanks the newer rows nor repeats a notice", async () => {
    ({ wrapper } = await mountPage({ job: "7" }));
    let failOld;
    supplierImportService.getJob
      .mockImplementationOnce(() => new Promise((_, reject) => { failOld = () => reject(Object.assign(new Error("網路錯誤"), { code: "NETWORK_ERROR" })); }))
      .mockResolvedValueOnce({ job: JOB, rows: [{ rowNumber: 12, operation: "create", status: "valid", errors: [], warnings: [] }], rowsNumber: 1 });
    const vm = wrapper.findComponent(SupplierImportsPage).vm;
    const older = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
    const newer = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
    expect((await newer).rows.map((row) => row.rowNumber)).toEqual([12]);
    failOld();
    expect((await older).rows.map((row) => row.rowNumber)).toEqual([12]);

    const gone = Object.assign(new Error("not found"), { status: 404 });
    let releaseOld;
    supplierImportService.getJob
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve({ job: JOB, rows: [], rowsNumber: 0 }); }))
      .mockRejectedValueOnce(gone);
    const pending = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 }).catch((error) => error);
    const latest = vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 }).catch((error) => error);
    expect(await latest).toBe(gone);
    releaseOld();
    expect(await pending).toBe(gone);
    expect(notifyError.mock.calls.filter(([message]) => message === "找不到這個匯入工作")).toHaveLength(1);
  });

  it("REV-074 L-4: a row number the server would refuse is never sent", async () => {
    ({ wrapper } = await mountPage({ job: "7" }));
    const vm = wrapper.findComponent(SupplierImportsPage).vm;
    for (const value of [-1, 1.5, 0, 2_000_000]) {
      supplierImportService.getJob.mockClear();
      vm.$.setupState.rowNumber = value;
      vm.$.setupState.reloadRows();
      await vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
      await flushPromises();
      expect(supplierImportService.getJob.mock.calls.every(([, options]) => options.rowNumber === undefined), String(value)).toBe(true);
    }
    vm.$.setupState.rowNumber = 1_000_000;
    await vm.$.setupState.fetchRows({ page: 1, rowsPerPage: 20 });
    expect(supplierImportService.getJob).toHaveBeenLastCalledWith(7, expect.objectContaining({ rowNumber: 1_000_000 }));
  });
});
