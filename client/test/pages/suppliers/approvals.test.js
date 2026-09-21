import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplierApproval.js", () => ({
  default: {
    activationPolicy: vi.fn(), eligibleApprovers: vi.fn(), queue: vi.fn(),
    get: vi.fn(), approve: vi.fn(), reject: vi.fn(), reassign: vi.fn(), withdraw: vi.fn()
  },
  service: { name: "supplierApproval" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn() }));

import supplierApprovalService from "@/services/supplierApproval.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import SupplierApprovalsPage, { page } from "@/pages/suppliers/SupplierApprovalsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const APPROVER = { id: 2, username: "checker", displayName: "Checker" };
const REQUESTER = { id: 1, username: "maker", displayName: "Maker" };

const ROW = {
  id: 11, supplierId: 7, supplierCode: "SUP-007", supplierName: "Evergreen", supplierStatus: "pending_approval",
  status: "pending", requester: REQUESTER, assignedApprover: APPROVER,
  requestNote: "請覆核", requestedAt: 1700000000000, decidedAt: null, version: 1
};

const SNAPSHOT = {
  supplierCode: "SUP-007", supplierName: "Evergreen", displayName: "", defaultCurrencyCode: "HKD",
  defaultPaymentTermId: null, identifierCount: 0, identifiersTruncated: false, identifiers: []
};

function detail(overrides = {}) {
  return {
    ...ROW,
    decidedBy: null, decisionReason: "", supplierVersion: 5, currentSupplierVersion: 5,
    stale: false, submitted: SNAPSHOT, current: SNAPSHOT, changedFields: [],
    ...overrides
  };
}

async function mountPage({ actor = APPROVER, permissions = ["supplier.view", "supplier.approval"], rows = [ROW] } = {}) {
  supplierApprovalService.queue.mockResolvedValue({ rows, rowsNumber: rows.length });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: page.path, component: SupplierApprovalsPage }]
  });
  await router.push(page.path);
  await router.isReady();
  useSessionStore().user = { ...actor, permissions, roles: [] };
  const wrapper = mount(SupplierApprovalsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

function button(body, label) {
  return body.findAll("button").find((candidate) => candidate.text().includes(label));
}

describe("pages/suppliers/SupplierApprovalsPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("guards on the same pair of permissions the API demands", () => {
    // 只守 supplier.approval 會令使用者入到頁，但每個請求都 403（設計 §6.4）。
    expect(page.requires.permissions).toEqual(["supplier.view", "supplier.approval"]);
    expect(page.path).toBe("/suppliers/approvals");
    expect(page.menu.group).toBe("suppliers");
  });

  it("opens on the actor's own pending queue", async () => {
    await mountPage();
    expect(supplierApprovalService.queue).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "mine", status: "pending" })
    );
  });

  it("switches between mine, all and unassigned", async () => {
    const { body } = await mountPage();
    for (const [label, scope] of [["全部待處理", "all"], ["未指派", "unassigned"], ["待我審批", "mine"]]) {
      await button(body, label).trigger("click");
      await flushPromises();
      expect(supplierApprovalService.queue).toHaveBeenLastCalledWith(expect.objectContaining({ scope }));
    }
  });

  it("shows the submitted snapshot beside the current Supplier and marks what changed", async () => {
    supplierApprovalService.get.mockResolvedValue(detail({
      current: { ...SNAPSHOT, supplierName: "Evergreen Trading" },
      changedFields: ["supplierName"], stale: true, currentSupplierVersion: 6
    }));
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    expect(body.text()).toContain("Evergreen Trading");
    // REV-030 H-1：`body.text()).toContain("已變更")` 由 stale chip 嘅「提交後已變更」
    // 滿足，行都未行到 diff table。所以要逐行睇，而且要睇埋「冇改嘅行冇標記」——
    // 少咗第二句，一個「乜都標記」嘅實作一樣過。
    // REV-031 N-1：`row.text().includes("名稱")` 只係因為「名稱」喺 FIELD_LABEL 入面
    // 排喺「顯示名稱」前面先啱——即係靠 key 次序。`data-field` 已經 render 咗喺
    // <tr> 上面，兩層（vitest 同 browser）用返同一個精確選擇器。
    const named = body.find('[data-field="supplierName"]');
    const coded = body.find('[data-field="supplierCode"]');
    expect(named.text()).toContain("已變更");
    expect(coded.text()).not.toContain("已變更");
  });

  it("refuses to approve a stale request, which is the same rule the service enforces", async () => {
    // AC-012：提交後 Supplier 改過就唔可以批舊申請。UI 禁用嘅嘢，服務層唔會突然又批得。
    supplierApprovalService.get.mockResolvedValue(detail({ stale: true, currentSupplierVersion: 6 }));
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    expect(body.text()).toContain("不能批准");
    expect(button(body, "批准").attributes("disabled")).toBeDefined();
    // REV-030 L-1：服務層嘅 #assertRequestStillCurrent 喺 command 唔係 approve 就
    // 已經 return，所以拒絕唔受 stale 影響，設計 §7.6 亦只講禁止 approve。一併禁埋
    // 拒絕會令 UI 擋住一個服務層會接受嘅動作，而拒絕正正係過時申請最合理嘅出路。
    expect(button(body, "拒絕").attributes("disabled")).toBeUndefined();
  });

  it("only the assigned approver may decide", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    const { body } = await mountPage({ actor: { id: 99, username: "someone", displayName: "Someone" } });
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    expect(button(body, "批准").attributes("disabled")).toBeDefined();
  });

  it("approving asks for the password and sends the request version", async () => {
    supplierApprovalService.get.mockResolvedValue(detail({ version: 3 }));
    supplierApprovalService.approve.mockResolvedValue({ id: 11, status: "approved", supplierStatus: "active" });
    promptPassword.mockResolvedValue("pw");
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    await button(body, "批准").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalled();
    expect(supplierApprovalService.approve).toHaveBeenCalledWith(11, { password: "pw", version: 3 });
    // 設計 §7.6：成功通知要帶 Supplier Code 同結果，唔係淨係「成功」。
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("SUP-007"));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("啟用"));
  });

  it("rejecting demands a reason as well as the password", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    supplierApprovalService.reject.mockResolvedValue({ id: 11, status: "rejected", supplierStatus: "draft" });
    promptPassword.mockResolvedValue({ reason: "資料不足以啟用", password: "pw" });
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    await button(body, "拒絕").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(supplierApprovalService.reject).toHaveBeenCalledWith(11, { reason: "資料不足以啟用", password: "pw", version: 1 });
  });

  it("cancelling a decision sends nothing", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    promptPassword.mockResolvedValue(null);
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    await button(body, "批准").trigger("click");
    await flushPromises();
    expect(supplierApprovalService.approve).not.toHaveBeenCalled();
  });

  it("the requester sees withdraw, and the approver does not", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    supplierApprovalService.withdraw.mockResolvedValue({ id: 11, status: "withdrawn", supplierId: 7, supplierStatus: "draft" });

    const asApprover = await mountPage();
    await asApprover.body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    expect(button(asApprover.body, "撤回")).toBeUndefined();
    asApprover.wrapper.unmount();
    document.body.innerHTML = "";

    const asRequester = await mountPage({ actor: REQUESTER });
    await asRequester.body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    await button(asRequester.body, "撤回").trigger("click");
    await flushPromises();

    // 撤回行 Supplier route，帶 request id，唔要密碼（設計 §6.4）。
    expect(supplierApprovalService.withdraw).toHaveBeenCalledWith(7, { requestId: 11, version: 1 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("SUP-007"));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("草稿"));
  });

  it("a version conflict reloads instead of retrying", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    supplierApprovalService.approve.mockRejectedValue(
      Object.assign(new Error("審批申請已被其他人修改"), { code: "VERSION_CONFLICT" })
    );
    promptPassword.mockResolvedValue("pw");
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();
    supplierApprovalService.get.mockClear();

    await button(body, "批准").trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalled();
    expect(supplierApprovalService.approve).toHaveBeenCalledTimes(1);
    expect(supplierApprovalService.get).toHaveBeenCalledTimes(1);
  });

  it("reassigning excludes the requester and demands a reason", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    supplierApprovalService.eligibleApprovers.mockResolvedValue({ items: [{ id: 3, username: "other", displayName: "Other" }] });
    supplierApprovalService.reassign.mockResolvedValue({ id: 11, assignedApproverId: 3, version: 2 });
    promptPassword.mockResolvedValue({ reason: "原審批人休假", password: "pw" });
    const { wrapper, body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    // 開 detail 就已經攞咗人選，排除提交人（BR-012）。
    expect(supplierApprovalService.eligibleApprovers).toHaveBeenCalledWith({ excludeUserId: REQUESTER.id });

    wrapper.vm.reassignTarget = 3;
    await button(body, "重新指派").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(supplierApprovalService.reassign).toHaveBeenCalledWith(11, {
      reason: "原審批人休假", password: "pw", approverUserId: 3, version: 1
    });
  });

  it("reassigning without a target sends nothing", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    await button(body, "重新指派").trigger("click");
    await flushPromises();
    expect(supplierApprovalService.reassign).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining("審批人"));
  });

  // ---- REV-030 M-1: the error paths -----------------------------------------

  it("a failed detail read reports the failure instead of showing a half-open detail", async () => {
    supplierApprovalService.get.mockRejectedValue(new Error("網路錯誤，請檢查連線"));
    const { body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining("網路錯誤"));
    expect(body.text()).not.toContain("提交時快照");
    expect(button(body, "批准")).toBeUndefined();
  });

  it("a failed approver lookup leaves the reassign list empty rather than stale", async () => {
    supplierApprovalService.get.mockResolvedValue(detail());
    supplierApprovalService.eligibleApprovers.mockRejectedValue(new Error("網路錯誤，請檢查連線"));
    const { wrapper, body } = await mountPage();
    await body.findAll("button").find((candidate) => candidate.attributes("aria-label")?.includes("審批詳情")).trigger("click");
    await flushPromises();

    // 服務層拋乜就講乜；`|| "載入可選審批人失敗"` 只係冇 message 嗰陣先用。
    expect(notifyError).toHaveBeenCalledWith("網路錯誤，請檢查連線");
    expect(wrapper.vm.reassignOptions).toEqual([]);
  });
});
