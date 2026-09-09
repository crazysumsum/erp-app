import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/itemImport.js", () => ({
  default: {
    downloadTemplate: vi.fn(),
    uploadJob: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    confirmJob: vi.fn(),
    cancelJob: vi.fn(),
    downloadResult: vi.fn()
  },
  service: { name: "itemImport" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({
  confirm: vi.fn(),
  promptPassword: vi.fn()
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemImportService from "@/services/itemImport.js";
import { confirm, promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import ItemImportsPage from "@/pages/items/ItemImportsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const JOB_ROWS = [
  {
    id: 1,
    mode: "create_only",
    status: "ready",
    totalCount: 3,
    successCount: 2,
    failureCount: 0,
    warningCount: 1,
    skippedCount: 0,
    createdAt: 1700000000000
  }
];

const JOB_DETAIL = {
  id: 1,
  mode: "create_only",
  status: "ready",
  totalCount: 3,
  successCount: 2,
  failureCount: 0,
  warningCount: 1,
  skippedCount: 0,
  errorSummary: null,
  resultStoredName: "result.csv",
  filesPurgedAt: null,
  version: 2
};

const ROW_ITEMS = [
  {
    jobId: 1,
    rowNumber: 1,
    operation: "create",
    status: "valid",
    errors: [],
    warnings: []
  },
  {
    jobId: 1,
    rowNumber: 2,
    operation: "create",
    status: "warning",
    errors: [],
    warnings: [{ field: "skuCode", code: "SKU_CODE_MISMATCH", message: "SKU Code 唔一致" }]
  }
];

async function mountImportsPage({ permissions = ["item.mgmt"], jobs = JOB_ROWS } = {}) {
  itemImportService.listJobs.mockResolvedValue({ items: jobs, total: jobs.length, page: 1, pageSize: 20 });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: ItemImportsPage }]
  });
  await router.push("/");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

  const wrapper = mount(ItemImportsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("pages/items/ItemImportsPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake-url");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("開機以分頁 fetch 載入匯入工作，顯示喺表入面", async () => {
    const { wrapper } = await mountImportsPage();

    expect(itemImportService.listJobs).toHaveBeenCalled();
    expect(wrapper.text()).toContain("待確認");
  });

  it("冇 item.mgmt：睇唔到「上傳 CSV」按鈕", async () => {
    const { wrapper } = await mountImportsPage({ permissions: [] });

    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("上傳 CSV"))).toBe(false);
  });

  it("下載範本：打 downloadTemplate() 並觸發 blob 下載", async () => {
    itemImportService.downloadTemplate.mockResolvedValue({ blob: new Blob(["x"]), contentType: "text/csv" });
    const { wrapper } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("下載範本")).trigger("click");
    await flushPromises();

    expect(itemImportService.downloadTemplate).toHaveBeenCalled();
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
  });

  it("上傳：未揀檔案就提交唔會打 API，會顯示錯誤", async () => {
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("上傳 CSV")).trigger("click");
    await flushPromises();
    await body.findAll(".q-btn").find((btn) => btn.text() === "上傳").trigger("click");
    await flushPromises();

    expect(itemImportService.uploadJob).not.toHaveBeenCalled();
    expect(body.text()).toContain("請選擇要上傳的 CSV 檔案");
  });

  it("上傳：揀咗檔案就打 uploadJob()，成功後重新整理表格並關閉 dialog", async () => {
    itemImportService.uploadJob.mockResolvedValue({ id: 2, status: "uploaded" });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("上傳 CSV")).trigger("click");
    await flushPromises();

    const file = new File(["a,b\n1,2"], "import.csv", { type: "text/csv" });
    const [fileInput] = wrapper.findAllComponents({ name: "QFile" });
    await fileInput.vm.$emit("update:model-value", file);
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text() === "上傳").trigger("click");
    await flushPromises();

    expect(itemImportService.uploadJob).toHaveBeenCalledWith({ file, mode: "create_only" });
    expect(notifySuccess).toHaveBeenCalled();
    expect(itemImportService.listJobs).toHaveBeenCalledTimes(2);
  });

  it("上傳失敗顯示後端訊息，唔會靜靜哋失敗", async () => {
    itemImportService.uploadJob.mockRejectedValue(new Error("找不到這個匯入工作"));
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("上傳 CSV")).trigger("click");
    await flushPromises();

    const file = new File(["a,b\n1,2"], "import.csv", { type: "text/csv" });
    const [fileInput] = wrapper.findAllComponents({ name: "QFile" });
    await fileInput.vm.$emit("update:model-value", file);
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text() === "上傳").trigger("click");
    await flushPromises();

    expect(body.text()).toContain("找不到這個匯入工作");
    expect(notifyError).toHaveBeenCalledWith("找不到這個匯入工作");
  });

  it("詳情：打 getJob()，顯示 job 摘要同逐列錯誤／警告", async () => {
    itemImportService.getJob.mockResolvedValue({
      job: JOB_DETAIL,
      rows: { items: ROW_ITEMS, total: ROW_ITEMS.length, page: 1, pageSize: 20 }
    });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();

    expect(itemImportService.getJob).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1, pageSize: 20 }));
    expect(body.text()).toContain("SKU Code 唔一致");
  });

  it("詳情：開完一個 job 嘅詳情、閂咗，再開第二個唔同嘅 job，要重新 fetch 返新嗰個嘅資料，唔會停喺舊資料或者 loading 狀態", async () => {
    const jobTwo = { ...JOB_ROWS[0], id: 2 };
    itemImportService.getJob.mockImplementation((id) =>
      Promise.resolve({
        job: { ...JOB_DETAIL, id },
        rows: { items: [], total: 0, page: 1, pageSize: 20 }
      })
    );
    const { wrapper, body } = await mountImportsPage({ jobs: [JOB_ROWS[0], jobTwo] });

    await wrapper.find('[aria-label="工作 #1 的詳情"]').trigger("click");
    await flushPromises();
    expect(itemImportService.getJob).toHaveBeenCalledWith(1, expect.anything());
    expect(body.text()).toContain("匯入工作 #1");

    await body.findAll(".q-btn").find((btn) => btn.text() === "關閉").trigger("click");
    await flushPromises();

    await wrapper.find('[aria-label="工作 #2 的詳情"]').trigger("click");
    await flushPromises();

    expect(itemImportService.getJob).toHaveBeenCalledWith(2, expect.anything());
    expect(body.text()).toContain("匯入工作 #2");
  });

  it("確認：ready 狀態先顯示確認按鈕，promptPassword 帶 reason／password，打 confirmJob() 連埋目前 version", async () => {
    itemImportService.getJob.mockResolvedValue({
      job: JOB_DETAIL,
      rows: { items: ROW_ITEMS, total: ROW_ITEMS.length, page: 1, pageSize: 20 }
    });
    promptPassword.mockResolvedValue({ reason: "整合測試確認", password: "hunter2" });
    itemImportService.confirmJob.mockResolvedValue({ ...JOB_DETAIL, status: "queued" });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text().includes("確認匯入")).trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemImportService.confirmJob).toHaveBeenCalledWith(1, {
      reason: "整合測試確認",
      password: "hunter2",
      version: 2
    });
    expect(notifySuccess).toHaveBeenCalled();
  });

  it("取消：唔使密碼，confirm() 話 true 先打 cancelJob()", async () => {
    itemImportService.getJob.mockResolvedValue({
      job: JOB_DETAIL,
      rows: { items: ROW_ITEMS, total: ROW_ITEMS.length, page: 1, pageSize: 20 }
    });
    confirm.mockResolvedValue(true);
    itemImportService.cancelJob.mockResolvedValue({ ...JOB_DETAIL, status: "cancelled" });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text() === "取消").trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalled();
    expect(itemImportService.cancelJob).toHaveBeenCalledWith(1);
    expect(notifySuccess).toHaveBeenCalled();
  });

  it("結果已過期（filesPurgedAt 有值）：顯示唔可以下載嘅徽章，冇下載按鈕", async () => {
    itemImportService.getJob.mockResolvedValue({
      job: { ...JOB_DETAIL, status: "completed", filesPurgedAt: 1700000000000 },
      rows: { items: [], total: 0, page: 1, pageSize: 20 }
    });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();

    expect(body.findAll(".q-btn").some((btn) => btn.text().includes("下載結果"))).toBe(false);
    expect(body.text()).toContain("結果檔已過期");
  });

  it("下載結果：resultStoredName 有值且未過期，打 downloadResult()", async () => {
    itemImportService.getJob.mockResolvedValue({
      job: { ...JOB_DETAIL, status: "completed" },
      rows: { items: [], total: 0, page: 1, pageSize: 20 }
    });
    itemImportService.downloadResult.mockResolvedValue({ blob: new Blob(["x"]), contentType: "text/csv" });
    const { wrapper, body } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text().includes("下載結果")).trigger("click");
    await flushPromises();

    expect(itemImportService.downloadResult).toHaveBeenCalledWith(1, expect.anything());
  });

  it("Poll：狀態係 validating 期間會定期重新打 getJob()，轉做 ready 之後停止", async () => {
    vi.useFakeTimers();
    itemImportService.getJob
      .mockResolvedValueOnce({
        job: { ...JOB_DETAIL, status: "validating" },
        rows: { items: [], total: 0, page: 1, pageSize: 20 }
      })
      .mockResolvedValueOnce({
        job: { ...JOB_DETAIL, status: "ready" },
        rows: { items: [], total: 0, page: 1, pageSize: 20 }
      });
    const { wrapper } = await mountImportsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("詳情")).trigger("click");
    await flushPromises();
    expect(itemImportService.getJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(itemImportService.getJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(itemImportService.getJob).toHaveBeenCalledTimes(2);
  });
});
