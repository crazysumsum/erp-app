import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/purchasing.js", () => ({ default: Object.fromEntries(["listMyApprovals", "getPurchaseOrder", "approvePurchaseOrder", "rejectPurchaseOrder", "withdrawPurchaseOrderApproval", "getSettings", "updateSettings"].map((name) => [name, vi.fn()])) }));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import purchasing from "@/services/purchasing.js";
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
