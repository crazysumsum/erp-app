import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/purchasing.js", () => ({ default: Object.fromEntries(["listMyApprovals", "getPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "withdrawPurchaseOrderApproval", "getSettings", "updateSettings", "copyPurchaseOrder"].map((name) => [name, vi.fn()])) }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import purchasing from "@/services/purchasing.js";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import Approvals, { page as approvalsPage } from "@/pages/purchasing/MyPurchaseOrderApprovalsPage.vue";
import Detail, { page as detailPage } from "@/pages/purchasing/PurchaseOrderDetailPage.vue";
import Settings, { page as settingsPage } from "@/pages/purchasing/PurchasingSettingsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const VIEW = "purchasing.view", APPROVAL = "purchasing.approval", MGMT = "purchasing.mgmt";
const item = { approvalId: 21, purchaseOrderId: 8, number: "PO-202611-000008", purchaseOrderVersion: 3, supplierCode: "S3", supplierName: "列表供應商", currencyCode: "HKD", totalAmount: "99.00",
  requestedByLabel: "提交人甲", requestNote: "請今日批", requestedAt: 1793000000000 };
const snapshot = { number: "PO-202611-000008", supplier: { id: 3, code: "S3", name: "快照時供應商" }, orderingAddress: null, currency: { code: "HKD", name: "港幣", decimalPlaces: 2 }, paymentTerm: null,
  orderDate: "2026-11-01", expectedDeliveryDate: null, defaultWarehouseCode: "W6", buyerLabel: "採購員甲", supplierReference: "", notes: "", subtotalAmount: "99.00", totalAmount: "99.00",
  warnings: ["NO_PAYMENT_TERM"], lines: [{ lineNumber: 1, skuId: 7, skuCode: "SKU7", skuName: "快照時貨品", purchaseUomCode: "BOX", orderedQuantity: "1.000000", baseUomCode: "EA",
    orderedBaseQuantity: "10", unitPrice: "99.0000", lineAmount: "99.00", zeroPriceReason: "", expectedDeliveryDate: null, lineNote: "" }] };
const line = { id: 11, lineNumber: 1, skuId: 7, skuCode: "SKU7", skuName: "目前貨品", trackingPolicy: "NONE", inventoryTracked: true, minimumReceiptLifeDays: null, baseUomId: 1, baseUomCode: "EA", purchaseSkuUomId: 2,
  purchaseUomCode: "BOX", uomToBaseFactor: 10, supplierItemCode: "", orderedQuantity: "1.000000", orderedBaseQuantity: "10", unitPrice: "99.0000", lineAmount: "99.00", zeroPriceReason: "", expectedDeliveryDate: null,
  lineNote: "", grossReceivedBaseQuantity: "0", reversedBaseQuantity: "0", netReceivedBaseQuantity: "0", outstandingBaseQuantity: "10", overReceivedBaseQuantity: "0", closedRemainingBaseQuantity: "0", closeReason: "", version: 1 };
const pending = { id: 8, number: snapshot.number, status: "PENDING_APPROVAL", version: 3, supplierId: 3, supplierCode: "S3", supplierName: "目前供應商", currencyCode: "HKD", currencyName: "港幣", currencyDecimalPlaces: 2,
  orderDate: "2026-11-01", expectedDeliveryDate: null, buyerId: 5, buyerLabel: "採購員甲", supplierReference: "", totalAmount: "99.00", subtotalAmount: "99.00", hasOutstanding: true, hasConfirmedReceipt: false,
  orderingAddressId: null, orderingAddress: null, paymentTermId: null, paymentTerm: null, defaultReceivingWarehouseId: null, defaultWarehouseCode: "W6", notes: "", createdAt: 1793000000000, updatedAt: 1793000000000,
  createdByLabel: "提交人甲", updatedByLabel: "提交人甲", confirmedAt: null, closedAt: null, cancelledAt: null, lines: [line], currentMasterDifferences: { supplier: null, lines: [] },
  allowedActions: ["approve", "reject"], approvalHistory: [], statusHistory: [],
  approval: { id: 21, status: "PENDING", purchaseOrderVersion: 3, requestedByLabel: "提交人甲", approverLabel: "審批人乙", requestNote: "請今日批", decisionReason: "", requestedAt: 1793000000000, decidedAt: null, snapshot } };
const settings = { requirePoApproval: false, version: 3, updatedAt: 1793000000000, updatedByLabel: "管理員", history: [{ requirePoApproval: false, version: 3, reason: "初始設定原因", actorLabel: "管理員", occurredAt: 1793000000000 }] };
const apiError = (message, fields) => Object.assign(new Error(message), fields);
const button = (label) => wrapper.findAll("button,a").find((node) => node.text() === label);
const field = (label) => wrapper.findAll(".q-field").find((node) => node.find(".q-field__label").exists() && node.find(".q-field__label").text().startsWith(label)).find("input, textarea");
let wrapper;

async function open(path, permissions) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...approvalsPage, component: Approvals }, { ...detailPage, component: Detail }, { ...settingsPage, component: Settings }] });
  await router.push(path);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return router;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  purchasing.listMyApprovals.mockResolvedValue({ rows: [item], rowsNumber: 1 });
  purchasing.getPurchaseOrder.mockResolvedValue(pending);
  purchasing.getSettings.mockResolvedValue(settings);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; });

describe("TASK-024 待我審批", () => {
  it("要 view＋approval，入選單；送頁碼同搜尋，按處理入詳情；冇資料有空狀態", async () => {
    expect(approvalsPage.requires.permissions).toEqual([VIEW, APPROVAL]);
    expect(approvalsPage.menu.group).toBe("purchasingReceiving");
    await open("/purchasing/approvals", [VIEW, APPROVAL]);
    expect(purchasing.listMyApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, rowsPerPage: 20 }));
    expect(wrapper.text()).toContain("S3 — 列表供應商");
    expect(wrapper.text()).toContain("HKD 99.00");
    expect(wrapper.text()).toContain("提交人甲");
    expect(button("處理").attributes("href")).toBe("/purchasing/purchase-orders/8");
    purchasing.listMyApprovals.mockResolvedValue({ rows: [], rowsNumber: 0 });
    await field("編號／供應商").setValue("  PO-2026 ");
    await button("搜尋").trigger("click");
    await flushPromises();
    expect(purchasing.listMyApprovals).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, filter: "PO-2026" }));
    expect(wrapper.text()).toContain("目前沒有待你審批的採購單");
  });
});

describe("TASK-024 審批快照及決定", () => {
  it("快照來自 approval.snapshot 唔係目前 PO；按鈕跟 allowedActions 同權限，mgmt 只見撤回", async () => {
    await open("/purchasing/purchase-orders/8", [VIEW, APPROVAL]);
    const panel = wrapper.find('[data-testid="po-approval-snapshot"]');
    expect(panel.text()).toContain("S3 — 快照時供應商");
    expect(panel.text()).toContain("SKU7 — 快照時貨品");
    expect(panel.text()).not.toContain("目前供應商");
    expect(panel.text()).toContain("未選擇付款條款");
    expect(panel.text()).toContain("審批人乙");
    expect(button("批准")).toBeDefined();
    expect(button("拒絕")).toBeDefined();
    expect(button("撤回審批")).toBeUndefined();
    wrapper.unmount(); document.body.innerHTML = "";

    purchasing.getPurchaseOrder.mockResolvedValue({ ...pending, allowedActions: ["approve", "reject", "withdraw"] });
    await open("/purchasing/purchase-orders/8", [VIEW, MGMT]);
    expect(wrapper.find('[data-testid="po-approval-snapshot"]').text()).toContain("快照時供應商");
    expect(wrapper.text()).not.toContain("審批決定");
    expect(button("批准")).toBeUndefined();
    expect(button("撤回審批")).toBeDefined();
    wrapper.unmount(); document.body.innerHTML = "";

    purchasing.getPurchaseOrder.mockResolvedValue({ ...pending, allowedActions: [] });
    await open("/purchasing/purchase-orders/8", [VIEW, APPROVAL]);
    expect(button("批准")).toBeUndefined();
    expect(button("拒絕")).toBeUndefined();
  });

  it("拒絕要原因；出錯保留原因清密碼；未確定只准同一動作用同一 eventId 重試", async () => {
    purchasing.rejectPurchaseOrder.mockRejectedValueOnce(apiError("請確認你目前的密碼", { code: "PASSWORD_INVALID", status: 403 }))
      .mockRejectedValueOnce(apiError("逾時", { code: "TIMEOUT" }))
      .mockResolvedValue({ id: 8, number: pending.number, status: "DRAFT", version: 4, replayed: false });
    await open("/purchasing/purchase-orders/8", [VIEW, APPROVAL]);
    await field("密碼").setValue("pw1");
    await button("拒絕").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("拒絕必須填寫原因");
    expect(purchasing.rejectPurchaseOrder).not.toHaveBeenCalled();

    await field("原因").setValue("數量不對，請修改");
    await button("拒絕").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("請確認你目前的密碼");
    expect(field("原因").element.value).toBe("數量不對，請修改");
    expect(field("密碼").element.value).toBe("");

    await field("密碼").setValue("pw2");
    await button("拒絕").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("結果尚未確認");
    expect(field("密碼").element.value).toBe("");
    expect(button("批准").attributes("disabled")).toBeDefined();

    await field("密碼").setValue("pw3");
    await button("拒絕").trigger("click");
    await flushPromises();
    const [first, second, third] = purchasing.rejectPurchaseOrder.mock.calls;
    expect(first).toEqual([8, { version: 3, reason: "數量不對，請修改", eventId: expect.any(String), password: "pw1" }]);
    expect(second[1].eventId).not.toBe(first[1].eventId);
    expect(third).toEqual([8, { ...second[1], password: "pw3" }]);
    expect(purchasing.approvePurchaseOrder).not.toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith(`${pending.number} 已拒絕，回到草稿。`);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
  });
});

describe("TASK-024 採購設定", () => {
  it("顯示目前值同紀錄；改設定送 version、原因同密碼，出錯保留原因清密碼", async () => {
    expect(settingsPage.requires.permissions).toEqual(["purchasing.settings"]);
    expect(settingsPage.menu.group).toBe("purchasingReceiving");
    purchasing.updateSettings.mockRejectedValueOnce(apiError("請確認你目前的密碼", { code: "PASSWORD_INVALID", status: 403 }))
      .mockResolvedValue({ requirePoApproval: true, version: 4, replayed: false });
    await open("/purchasing/settings", ["purchasing.settings"]);
    expect(wrapper.text()).toContain("目前：不需審批");
    expect(wrapper.text()).toContain("初始設定原因");
    expect(button("儲存設定").attributes("disabled")).toBeDefined();

    await wrapper.find('[role="switch"]').trigger("click");
    await field("變更原因").setValue("開始需要審批");
    await field("密碼").setValue("pw1");
    await button("儲存設定").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("請確認你目前的密碼");
    expect(field("變更原因").element.value).toBe("開始需要審批");
    expect(field("密碼").element.value).toBe("");

    await field("密碼").setValue("pw2");
    await button("儲存設定").trigger("click");
    await flushPromises();
    expect(purchasing.updateSettings).toHaveBeenLastCalledWith({ version: 3, requirePoApproval: true, reason: "開始需要審批", eventId: expect.any(String), password: "pw2" });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("需要審批"));
    expect(purchasing.getSettings).toHaveBeenCalledTimes(2);
  });
});

describe("TASK-024 R1：未確定 record 跟穩定 owner、單一 in-flight、生命週期", () => {
  const PATH = "/purchasing/purchase-orders/8", APPROVER = [VIEW, APPROVAL], MANAGER = [VIEW, MGMT];
  const approved = { id: 8, number: pending.number, status: "CONFIRMED", version: 4, replayed: false };
  const copied = { id: 20, number: "PO-202611-000020", status: "DRAFT", version: 1, replayed: false, warnings: [] };
  const po9 = { ...pending, id: 9, number: "PO-202611-000009", approval: { ...pending.approval, id: 22 } };
  const timeout = () => apiError("逾時", { code: "TIMEOUT" });
  const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
  // 同一 actor 權限刷新：usePurchaseOrder 重新讀取（唔 keep），panel 卸載重建。
  const refresh = (permissions, id = 1) => { useSessionStore().user = { id, permissions: [...permissions], roles: [] }; return flushPromises(); };
  const decide = async (label, password) => { await field("密碼").setValue(password); await button(label).trigger("click"); await flushPromises(); };
  const byId = (rows) => (id) => Promise.resolve(rows[String(id)]);
  beforeEach(() => {
    for (const mock of [purchasing.approvePurchaseOrder, purchasing.rejectPurchaseOrder, purchasing.withdrawPurchaseOrderApproval, purchasing.copyPurchaseOrder,
      purchasing.updateSettings, confirm, promptReason]) mock.mockReset();
  });

  it("C1 決定未確定後權限刷新令 panel 重建：原因由原 payload 回填、拒絕鎖住，重試用原 eventId", async () => {
    purchasing.approvePurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValue(approved);
    await open(PATH, APPROVER);
    await field("原因").setValue("數量已經核對");
    await decide("批准", "pw1");
    await refresh([...APPROVER, MGMT]);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(field("原因").element.value).toBe("數量已經核對");
    expect(button("拒絕").attributes("disabled")).toBeDefined();
    await decide("批准", "pw2");
    const [first, second] = purchasing.approvePurchaseOrder.mock.calls;
    expect(first[1]).toMatchObject({ reason: "數量已經核對", password: "pw1" });
    expect(second).toEqual([8, { ...first[1], password: "pw2" }]);
  });

  it("C2 未確定之後 403：保留原 record，訊息兩樣都講，拒絕仍鎖；之後成功都係原 eventId", async () => {
    purchasing.approvePurchaseOrder.mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(apiError("請確認你目前的密碼", { code: "PASSWORD_INVALID", status: 403 })).mockResolvedValue(approved);
    await open(PATH, APPROVER);
    await decide("批准", "pw1");
    await decide("批准", "wrong");
    expect(wrapper.text()).toContain("請確認你目前的密碼。結果尚未確認");
    expect(button("拒絕").attributes("disabled")).toBeDefined();
    await decide("批准", "pw3");
    const bodies = purchasing.approvePurchaseOrder.mock.calls.map(([, { password: _password, ...body }]) => body);
    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("C3 換 PO：另一張 PO 唔見原 record、用新 eventId；返原 PO 仍用原 eventId", async () => {
    purchasing.getPurchaseOrder.mockImplementation(byId({ 8: pending, 9: po9 }));
    purchasing.approvePurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValueOnce({ ...approved, id: 9, number: po9.number }).mockResolvedValue(approved);
    const router = await open(PATH, APPROVER);
    await decide("批准", "pw1");
    await router.push("/purchasing/purchase-orders/9");
    await flushPromises();
    expect(wrapper.text()).not.toContain("結果尚未確認");
    expect(button("拒絕").attributes("disabled")).toBeUndefined();
    await decide("批准", "pw2");
    await router.push(PATH);
    await flushPromises();
    expect(button("拒絕").attributes("disabled")).toBeDefined();
    await decide("批准", "pw3");
    const [first, second, third] = purchasing.approvePurchaseOrder.mock.calls;
    expect(second[0]).toBe(9);
    expect(second[1].eventId).not.toBe(first[1].eventId);
    expect(third[0]).toBe(8);
    expect(third[1].eventId).toBe(first[1].eventId);
  });

  it("C4 晚到回應：換咗 PO 之後先成功，唔通知、唔重新讀取", async () => {
    const held = deferred();
    purchasing.getPurchaseOrder.mockImplementation(byId({ 8: pending, 9: po9 }));
    purchasing.approvePurchaseOrder.mockReturnValueOnce(held.promise);
    const router = await open(PATH, APPROVER);
    await decide("批准", "pw1");
    await router.push("/purchasing/purchase-orders/9");
    await flushPromises();
    held.resolve(approved);
    await flushPromises();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(purchasing.approvePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
  });

  it("C5 換 actor：新 actor 唔見原 record 嘅鎖或者 banner，批准用新 eventId", async () => {
    purchasing.approvePurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValue(approved);
    await open(PATH, APPROVER);
    await decide("批准", "pw1");
    await refresh(APPROVER, 2);
    expect(button("拒絕").attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-testid="po-detached-decision"]').exists()).toBe(false);
    await decide("批准", "pw2");
    const [first, second] = purchasing.approvePurchaseOrder.mock.calls;
    expect(second[1].eventId).not.toBe(first[1].eventId);
  });

  it("C6 撤回審批未確定後同 context 重新讀取：banner 仍在，重試用原 eventId", async () => {
    purchasing.getPurchaseOrder.mockResolvedValue({ ...pending, allowedActions: ["copy", "withdraw"] });
    promptReason.mockResolvedValue("撤回原因五個字");
    purchasing.withdrawPurchaseOrderApproval.mockRejectedValueOnce(timeout()).mockResolvedValue({ id: 8, number: pending.number, status: "DRAFT", version: 4, replayed: false });
    await open(PATH, MANAGER);
    await button("撤回審批").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("撤回結果尚未確認");
    await refresh([...MANAGER, APPROVAL]);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("撤回結果尚未確認");
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.withdrawPurchaseOrderApproval.mock.calls;
    expect(first[1]).toMatchObject({ version: 3, reason: "撤回原因五個字" });
    expect(second).toEqual(first);
    expect(notifySuccess).toHaveBeenCalledWith(`${pending.number} 已撤回審批，回到草稿。`);
  });

  it("C7 設定未確定之後 VERSION_CONFLICT：唔入 stale、開關鎖住、原因保留；之後成功仍係原 body", async () => {
    purchasing.updateSettings.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(apiError("版本已更改", { code: "VERSION_CONFLICT", status: 409 }))
      .mockResolvedValue({ requirePoApproval: true, version: 4, replayed: false });
    await open("/purchasing/settings", ["purchasing.settings"]);
    await wrapper.find('[role="switch"]').trigger("click");
    await field("變更原因").setValue("開始需要審批");
    await field("密碼").setValue("pw1");
    await button("儲存設定").trigger("click");
    await flushPromises();
    await field("密碼").setValue("pw2");
    await button("重試確認結果").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("版本已更改。結果尚未確認");
    expect(button("載入最新設定")).toBeUndefined();
    expect(wrapper.find('[role="switch"]').attributes("aria-disabled")).toBe("true");
    expect(field("變更原因").element.value).toBe("開始需要審批");
    await field("密碼").setValue("pw3");
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const bodies = purchasing.updateSettings.mock.calls.map(([{ password: _password, ...body }]) => body);
    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(purchasing.getSettings).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a 有審批權：用原內容重試", [VIEW, APPROVAL, MGMT], true],
    ["b 冇審批權：只顯示被擋", [VIEW], false]
  ])("C11 %s——決定其實已 commit 但回應丟失，approval 變 null，panel 消失但頁面保留未確定決定", async (_, permissions, canReplay) => {
    purchasing.approvePurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValue(approved);
    await open(PATH, APPROVER);
    await decide("批准", "pw1");
    purchasing.getPurchaseOrder.mockResolvedValue({ ...pending, status: "CONFIRMED", approval: null, allowedActions: [] });
    await refresh([...permissions]);
    expect(wrapper.find('[data-testid="po-approval-snapshot"]').exists()).toBe(false);
    const banner = wrapper.find('[data-testid="po-detached-decision"]');
    expect(banner.text()).toContain("批准結果尚未確認");
    if (canReplay) {
      await field("確認用密碼").setValue("pw2");
      await button("以原內容重試批准").trigger("click");
      await flushPromises();
      const [first, second] = purchasing.approvePurchaseOrder.mock.calls;
      expect(second).toEqual([8, { ...first[1], password: "pw2" }]);
      expect(wrapper.find('[data-testid="po-detached-decision"]').exists()).toBe(false);
      expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(3);
    } else {
      expect(banner.text()).toContain("你目前沒有審批權限");
      expect(button("以原內容重試批准")).toBeUndefined();
      expect(purchasing.approvePurchaseOrder).toHaveBeenCalledTimes(1);
      expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
    }
  });

  it("C12 in-flight 期間 panel 重建：新 panel 唔可以再發批准或者拒絕；之後 TIMEOUT 拒絕仍鎖", async () => {
    const held = deferred();
    purchasing.approvePurchaseOrder.mockReturnValueOnce(held.promise);
    await open(PATH, APPROVER);
    await decide("批准", "pw1");
    await refresh([...APPROVER, MGMT]);
    expect(button("批准").attributes("disabled")).toBeDefined();
    expect(button("拒絕").attributes("disabled")).toBeDefined();
    await button("拒絕").trigger("click");
    await button("批准").trigger("click");
    await flushPromises();
    expect(purchasing.approvePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(purchasing.rejectPurchaseOrder).not.toHaveBeenCalled();
    held.reject(timeout());
    await flushPromises();
    expect(button("拒絕").attributes("disabled")).toBeDefined();
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
  });

  it("C13 離開再返同一張 PO：上一次生命週期嘅複製晚到成功，唔跳頁、唔通知", async () => {
    const held = deferred(), copyable = { ...pending, allowedActions: ["copy"] };
    purchasing.getPurchaseOrder.mockImplementation(byId({ 8: copyable, 9: { ...po9, allowedActions: ["copy"] } }));
    confirm.mockResolvedValue(true);
    purchasing.copyPurchaseOrder.mockReturnValueOnce(held.promise);
    const router = await open(PATH, MANAGER);
    await button("複製").trigger("click");
    await flushPromises();
    await router.push("/purchasing/purchase-orders/9");
    await flushPromises();
    await router.push(PATH);
    await flushPromises();
    held.resolve(copied);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(PATH);
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(purchasing.copyPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(3);
  });

  it("C14 離開詳情頁之後複製先成功：唔跳返去、唔通知", async () => {
    const held = deferred();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...pending, allowedActions: ["copy"] });
    confirm.mockResolvedValue(true);
    purchasing.copyPurchaseOrder.mockReturnValueOnce(held.promise);
    const router = await open(PATH, MANAGER);
    await button("複製").trigger("click");
    await flushPromises();
    await router.push("/purchasing/approvals");
    await flushPromises();
    held.resolve(copied);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/purchasing/approvals");
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(purchasing.copyPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 複製確認期間換 PO", "copy"],
    ["b 撤回原因期間換 actor", "withdraw"]
  ])("C17 %s：dialog 返嚟時 context 已經唔同，唔送任何 request", async (_, action) => {
    const answer = deferred();
    purchasing.getPurchaseOrder.mockImplementation(byId({ 8: { ...pending, allowedActions: ["copy", "withdraw"] }, 9: { ...po9, allowedActions: ["copy", "withdraw"] } }));
    (action === "copy" ? confirm : promptReason).mockReturnValueOnce(answer.promise);
    const router = await open(PATH, MANAGER);
    await button(action === "copy" ? "複製" : "撤回審批").trigger("click");
    await flushPromises();
    if (action === "copy") await router.push("/purchasing/purchase-orders/9");
    else useSessionStore().user = { id: 2, permissions: [...MANAGER], roles: [] };
    await flushPromises();
    answer.resolve(action === "copy" ? true : "撤回原因五個字");
    await flushPromises();
    expect(purchasing.copyPurchaseOrder).not.toHaveBeenCalled();
    expect(purchasing.withdrawPurchaseOrderApproval).not.toHaveBeenCalled();
  });
});
