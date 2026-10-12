import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { QInput, QSelect, Quasar } from "quasar";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/inventory.js", () => ({ default: {
  lookupSku: vi.fn(), listWarehouses: vi.fn(), listBins: vi.fn(), listStocks: vi.fn(), getStock: vi.fn(),
  listLots: vi.fn(), getStockSummary: vi.fn(), getMovement: vi.fn(), findOperationBySource: vi.fn(),
  postAdjustment: vi.fn(), postStatusTransfer: vi.fn(), reverseMovement: vi.fn(), listMovements: vi.fn()
} }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
import inventory from "@/services/inventory.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
const SKU = { skuId: 3, skuCode: "SKU-3", skuName: "Widget", trackingPolicy: "none", baseUom: { uomId: 5, uomCode: "EA" } };
const BUCKET = { balanceId: 12, warehouse: { warehouseId: 1, code: "WH-A" }, bin: { binId: 2, code: "A-01" },
  sku: { skuId: 3, code: "SKU-3", name: "Widget" }, lot: null, stockStatus: "AVAILABLE", onHand: 10, allocated: 2,
  bucketFree: 8, baseUom: SKU.baseUom, version: 6 };
const LOT = { lotId: 4, sku: BUCKET.sku, lotNumber: "LOT-4", expiryDate: "2027-09-27", manufactureDate: null, firstReceiptDate: "2026-01-01" };
const wrappers = [];
const component = name => import(`../../../src/components/inventory/${name}.vue`);
const pageComponent = name => import(`../../../src/pages/inventory/${name}.vue`);
const recordKey = "inventory-high-risk:v1:7";
const recovery = { action: "IN", source: { module: "INVENTORY", documentType: "ADJUSTMENT", documentId: "11111111-1111-4111-8111-111111111111", lineId: "", eventId: "22222222-2222-4222-8222-222222222222" } };
const draft = () => ({ action: "IN", body: { direction: "IN", warehouseId: 1, binId: 2, skuId: 3, stockStatus: "AVAILABLE", expectedBalanceVersion: 6,
  quantity: 3, uomId: 5, reasonCategory: "DATA_CORRECTION", reasonText: "庫存資料校正" }, preview: { legs: [{ bucket: BUCKET, direction: "IN", quantity: 3, projected: 13 }], summaries: [], reasonText: "庫存資料校正" } });
async function openPage(permissions = ["inventory.view", "inventory.adjust"]) {
  const { default: Page, page } = await pageComponent("AdjustmentsPage");
  const pinia = createPinia(), session = useSessionStore(pinia); session.user = { id: 7, roles: [], permissions };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: page.path, component: Page, meta: { title: page.title } }, { path: "/inventory/movements", component: { template: "<div />" } }
  ] });
  await router.push(page.path); await router.isReady();
  const wrapper = mount(Page, { global: { plugins: [Quasar, router, pinia] }, attachTo: document.body });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body), session, router, page };
}
async function review(wrapper, value = draft()) {
  const { default: Form } = await component("AdjustmentForm"); wrapper.findComponent(Form).vm.$emit("review", value); await flushPromises();
}
async function confirm(body, value = "unit-entry") {
  await body.find('input[type="password"]').setValue(value);
  await body.find('form[aria-labelledby="inventory-confirm-title"]').trigger("submit"); await flushPromises();
}
const input = (wrapper, label) => wrapper.findAllComponents(QInput).find(field => field.props("label") === label);
const select = async (wrapper, label, value) => {
  const field = wrapper.findAllComponents(QSelect).find(item => item.props("label") === label);
  field.vm.$emit("update:modelValue", value); await flushPromises();
};
const button = (wrapper, label) => wrapper.findAll("button").find(item => item.text().includes(label));
const prepare = async wrapper => { await wrapper.find("form").trigger("submit"); await flushPromises(); };
async function form(action = "IN", movementId = null) {
  const { default: Form } = await component("AdjustmentForm");
  const wrapper = mount(Form, { props: { action, movementId }, global: { plugins: [Quasar] }, attachTo: document.body });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
async function choose(wrapper) {
  await input(wrapper, "SKU Code").find("input").setValue("SKU-3");
  await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
  await select(wrapper, "倉庫", 1); await select(wrapper, "庫位", 2);
  await input(wrapper, "數量（Base UOM）").find("input").setValue("3");
  await input(wrapper, "原因說明").find("textarea").setValue("庫存資料校正");
}
describe("TASK033 high-risk form and confirmation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    inventory.findOperationBySource.mockResolvedValue(null);
    inventory.postAdjustment.mockRejectedValue(Object.assign(new Error("未收到結果"), { code: "TIMEOUT" }));
    inventory.lookupSku.mockResolvedValue(SKU);
    inventory.listWarehouses.mockResolvedValue({ rows: [{ id: 1, code: "WH-A", status: "ACTIVE" }], rowsNumber: 1 });
    inventory.listBins.mockResolvedValue({ rows: [{ id: 2, warehouseId: 1, code: "A-01", status: "ACTIVE" }], rowsNumber: 1 });
    inventory.listLots.mockResolvedValue({ rows: [], rowsNumber: 0 });
    inventory.listStocks.mockResolvedValue({ rows: [BUCKET], rowsNumber: 1 });
    inventory.getStock.mockResolvedValue(BUCKET);
    inventory.getStockSummary.mockResolvedValue({ reserved: 4, uncoveredReserved: 0, eligibleOnHand: 10, atp: 6 });
  });
  afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
  it("UI033-SELECTORS supports exact-Code usable no-Balance SKU with explicit Base UOM and confirmed absence", async () => {
    inventory.listStocks.mockResolvedValue({ rows: [], rowsNumber: 0 });
    const wrapper = await form(); await choose(wrapper); await prepare(wrapper);
    expect(inventory.lookupSku).toHaveBeenCalledWith("SKU-3", expect.any(Object));
    expect(wrapper.text()).toContain("EA");
    expect(wrapper.emitted("review")[0][0].body).toEqual({ direction: "IN", warehouseId: 1, binId: 2, skuId: 3,
      stockStatus: "AVAILABLE", expectedBalanceVersion: null, quantity: 3, uomId: 5, reasonCategory: "DATA_CORRECTION", reasonText: "庫存資料校正" });
  });
  it("UI033-SELECTORS discards late SKU response after Code changed", async () => {
    let finish; inventory.lookupSku.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = await form(); await input(wrapper, "SKU Code").find("input").setValue("SKU-3");
    await button(wrapper, "查找 SKU").trigger("click"); await flushPromises();
    await input(wrapper, "SKU Code").find("input").setValue("OTHER"); finish(SKU); await flushPromises();
    expect(wrapper.text()).not.toContain("Widget"); await prepare(wrapper); expect(wrapper.emitted("review")).toBeUndefined();
  });
  it("UI033-VALIDATION rejects nonpositive, fractional and unsafe Base quantities before review", async () => {
    const wrapper = await form(); await choose(wrapper);
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      await input(wrapper, "數量（Base UOM）").find("input").setValue(value); await prepare(wrapper);
      expect(wrapper.emitted("review")).toBeUndefined(); expect(wrapper.text()).toContain("安全正整數");
      expect(input(wrapper, "數量（Base UOM）").props("error")).toBe(true);
    }
  });
  it("UI033-VALIDATION applies trim, Unicode OTHER minimum, control rejection and UTF-8 byte limit", async () => {
    const wrapper = await form(); await choose(wrapper); await select(wrapper, "原因分類", "OTHER");
    for (const value of ["  ", "不足十字", "有控制\u0085字元原因文字", "字".repeat(167)]) {
      await input(wrapper, "原因說明").find("textarea").setValue(value); await prepare(wrapper); expect(wrapper.emitted("review")).toBeUndefined();
    }
    await input(wrapper, "原因說明").find("textarea").setValue("  一二三四五六七八九十  "); await prepare(wrapper);
    expect(wrapper.emitted("review")[0][0].body.reasonText).toBe("一二三四五六七八九十");
  });
  it("UI033-CURRENT-GUARDS refuses incomplete Reservation summary instead of showing guessed safeguards", async () => {
    inventory.getStockSummary.mockResolvedValue({ reserved: 4 });
    const wrapper = await form(); await choose(wrapper); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined(); expect(wrapper.text()).toContain("保障摘要不完整");
  });
  it("UI033-VALIDATION rejects invalid calendar dates for a new expiring Lot", async () => {
    inventory.lookupSku.mockResolvedValue({ ...SKU, trackingPolicy: "batch_expiry" });
    const wrapper = await form(); await choose(wrapper); await select(wrapper, "批次模式", "NEW");
    await input(wrapper, "批次編號").find("input").setValue("NEW-LOT");
    await input(wrapper, "效期").find("input").setValue("2027-02-30"); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined(); expect(wrapper.text()).toContain("日期");
  });
  it("UI033-IN-LOT preserves existing immutable Lot dates and current Balance version", async () => {
    inventory.lookupSku.mockResolvedValue({ ...SKU, trackingPolicy: "batch_expiry" });
    inventory.listLots.mockResolvedValue({ rows: [LOT], rowsNumber: 1 });
    inventory.listStocks.mockResolvedValue({ rows: [{ ...BUCKET, lot: { lotId: 4, number: "LOT-4" } }], rowsNumber: 1 });
    const wrapper = await form(); await choose(wrapper); await select(wrapper, "既有批次", 4); await prepare(wrapper);
    expect(wrapper.text()).toContain("2026-01-01");
    expect(wrapper.emitted("review")[0][0].body).toMatchObject({ lotNumber: "LOT-4", expiryDate: "2027-09-27", expectedBalanceVersion: 6 });
    expect(wrapper.emitted("review")[0][0].body).not.toHaveProperty("manufactureDate");
  });
  it("UI033-CURRENT-GUARDS reads all target pages and distinguishes null Lot from a tracked Lot", async () => {
    inventory.listStocks.mockResolvedValueOnce({ rows: [{ ...BUCKET, balanceId: 13, lot: { lotId: 4, number: "LOT-4" } }], rowsNumber: 2 })
      .mockResolvedValueOnce({ rows: [BUCKET], rowsNumber: 2 });
    const wrapper = await form(); await choose(wrapper); await prepare(wrapper);
    expect(inventory.listStocks.mock.calls.map(([request]) => request.page)).toEqual([1, 2]);
    expect(wrapper.emitted("review")[0][0].body.expectedBalanceVersion).toBe(6);
  });
  it("UI033-CURRENT-GUARDS refuses failed, partial and duplicate target reads rather than inferring absence", async () => {
    const wrapper = await form(); await choose(wrapper);
    inventory.listStocks.mockRejectedValueOnce(new Error("查詢中斷")); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined();
    inventory.listStocks.mockResolvedValueOnce({ rows: [], rowsNumber: 1 }); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined();
    inventory.listStocks.mockResolvedValueOnce({ rows: [BUCKET, BUCKET], rowsNumber: 2 }); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined();
  });
  it("UI033-CURRENT-GUARDS binds OUT to freshly read source identity/version, not its list snapshot", async () => {
    const wrapper = await form("OUT"); await choose(wrapper); await button(wrapper, "載入來源庫存").trigger("click"); await flushPromises();
    await select(wrapper, "來源庫存 bucket", 12); inventory.getStock.mockResolvedValue({ ...BUCKET, version: 9 }); await prepare(wrapper);
    expect(wrapper.emitted("review")[0][0].body).toEqual({ direction: "OUT", balanceId: 12, expectedBalanceVersion: 9,
      quantity: 3, uomId: 5, reasonCategory: "DATA_CORRECTION", reasonText: "庫存資料校正" });
  });
  it("UI033-IN-LOT prepares paired Status effects using current source and confirmed absent destination", async () => {
    const wrapper = await form("STATUS_TRANSFER"); await choose(wrapper); await button(wrapper, "載入來源庫存").trigger("click"); await flushPromises();
    await select(wrapper, "來源庫存 bucket", 12); await select(wrapper, "目標狀態", "QUARANTINED");
    inventory.listStocks.mockResolvedValue({ rows: [], rowsNumber: 0 }); await prepare(wrapper);
    expect(wrapper.emitted("review")[0][0].body).toEqual({ sourceBalanceId: 12, destinationStatus: "QUARANTINED",
      expectedSourceVersion: 6, expectedDestinationVersion: null, quantity: 3, uomId: 5, reasonText: "庫存資料校正" });
    expect(wrapper.emitted("review")[0][0].preview.legs).toHaveLength(2);
  });
  it("UI033-RECONCILE derives complete unique current Reversal guards instead of historical versions", async () => {
    const leg = { movementId: 21, groupId: "group", operationId: 31, movementType: "RECEIPT", locationKind: "BIN", ...BUCKET,
      quantity: 2, direction: "IN", balanceVersionAfter: 2 };
    inventory.getMovement.mockResolvedValue({ movement: leg, groupLegs: [leg], reversal: { reversalOfMovementId: null, reversedByMovementId: null } });
    const wrapper = await form("REVERSAL", 21);
    await input(wrapper, "原因說明").find("textarea").setValue("錯誤入庫沖銷"); await prepare(wrapper);
    expect(wrapper.emitted("review")[0][0].body).toEqual({ expectedBalances: [{ balanceId: 12, expectedVersion: 6 }], reasonText: "錯誤入庫沖銷" });
    expect(wrapper.emitted("review")[0][0].preview.legs[0].direction).toBe("OUT");
  });
  it("UI033-CURRENT-GUARDS rejects a Lot response owned by another SKU", async () => {
    inventory.lookupSku.mockResolvedValue({ ...SKU, trackingPolicy: "batch_expiry" });
    inventory.listLots.mockResolvedValue({ rows: [LOT], rowsNumber: 1 });
    const wrapper = await form(); await choose(wrapper); await select(wrapper, "既有批次", 4);
    inventory.listLots.mockResolvedValue({ rows: [{ ...LOT, sku: { ...BUCKET.sku, skuId: 99 } }], rowsNumber: 1 }); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined(); expect(wrapper.text()).toContain("批次與 SKU 不一致");
  });
  it("UI033-RECONCILE rejects duplicate original Movement legs instead of previewing duplicated effects", async () => {
    const leg = { movementId: 21, groupId: "group", operationId: 31, movementType: "RECEIPT", locationKind: "BIN", ...BUCKET, quantity: 2, direction: "IN" };
    inventory.getMovement.mockResolvedValue({ movement: leg, groupLegs: [leg, leg], reversal: {} });
    const wrapper = await form("REVERSAL", 21); await input(wrapper, "原因說明").find("textarea").setValue("整組資料核對沖銷"); await prepare(wrapper);
    expect(wrapper.emitted("review")).toBeUndefined(); expect(wrapper.text()).toContain("異動組不完整");
  });
  it("UI033-CONFIRM-SECRETS clears native password immediately, never emits it, and clears cancel/hide/disable", async () => {
    const { default: Dialog } = await component("InventoryHighRiskDialog");
    const execute = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(Dialog, { props: { modelValue: true, execute }, global: { plugins: [Quasar] }, attachTo: document.body });
    wrappers.push(wrapper); await flushPromises(); const body = new DOMWrapper(document.body);
    const password = body.find('input[type="password"]'); await password.setValue("one-use-entry");
    await body.find("form").trigger("submit"); await flushPromises();
    expect(execute).toHaveBeenCalledWith("one-use-entry"); expect(password.element.value).toBe("");
    expect(wrapper.vm.password).toBeUndefined(); expect(JSON.stringify(wrapper.emitted())).not.toContain("one-use-entry");
    await password.setValue("cancel-entry"); await button(body, "取消").trigger("click"); expect(password.element.value).toBe("");
    await password.setValue("disabled-entry"); await wrapper.setProps({ disabled: true }); expect(password.element.value).toBe("");
  });
  it("UI033-AUTH requires view+adjust on the page and hides its form for read-only actors", async () => {
    const { wrapper, page } = await openPage(["inventory.view", "inventory.operation", "inventory.fefo.override"]);
    expect(page.requires.permissions).toEqual(["inventory.view", "inventory.adjust"]);
    expect(wrapper.find('form[aria-label="高風險庫存操作表單"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("需要 inventory.view 及 inventory.adjust");
  });
  it("UI033-SIGNED-INTENT freezes original input and persists only actor source identity before POST", async () => {
    const { wrapper, body } = await openPage(); const value = draft(); await review(wrapper, value); value.body.quantity = 99;
    await confirm(body);
    const payload = inventory.postAdjustment.mock.calls[0][0], stored = JSON.parse(sessionStorage.getItem(recordKey));
    expect(payload.quantity).toBe(3); expect(payload.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(payload.source.documentId).not.toBe(payload.source.eventId);
    expect(Object.keys(stored).sort()).toEqual(["action", "source"]);
    for (const field of ["password", "idempotencyKey", "quantity", "reasonText", "expectedBalanceVersion"]) expect(stored).not.toHaveProperty(field);
    expect(inventory.postAdjustment).toHaveBeenCalledTimes(1); expect(wrapper.text()).toContain("結果未知");
    expect(body.find('input[type="password"]').exists()).toBe(false);
  });
  it("UI033-UNKNOWN-QUERY keeps null unresolved and never automatically creates or resends another intent", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper); await confirm(body);
    const first = JSON.parse(sessionStorage.getItem(recordKey));
    await button(wrapper, "查詢原結果").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("結果未知"); expect(inventory.postAdjustment).toHaveBeenCalledTimes(1);
    expect(inventory.findOperationBySource).toHaveBeenLastCalledWith(first.source, expect.any(Object));
    expect(JSON.parse(sessionStorage.getItem(recordKey))).toEqual(first);
  });
  it("UI033-RETRY requires explicit retry and fresh entry with unchanged original business/source/key", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper); await confirm(body, "first-entry");
    await button(wrapper, "重試原意圖").trigger("click"); await flushPromises(); expect(inventory.postAdjustment).toHaveBeenCalledTimes(1);
    await confirm(body, "fresh-entry");
    const [first, second] = inventory.postAdjustment.mock.calls.map(([payload]) => payload);
    expect(second).toEqual({ ...first, password: "fresh-entry" }); expect(first.password).toBe("first-entry");
    expect(inventory.findOperationBySource.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("UI033-REFRESH restores only query recovery, with no rebuilt payload or retry/new operation", async () => {
    sessionStorage.setItem(recordKey, JSON.stringify(recovery)); const { wrapper } = await openPage();
    expect(wrapper.text()).toContain("重新載入後只可查詢");
    expect(button(wrapper, "重試原意圖")).toBeUndefined();
    expect(wrapper.find('form[aria-label="高風險庫存操作表單"]').exists()).toBe(false);
    expect(inventory.postAdjustment).not.toHaveBeenCalled(); expect(inventory.findOperationBySource).toHaveBeenCalledWith(recovery.source, expect.any(Object));
  });
  it("UI033-REFRESH isolates actors and clears pending confirmation without deleting another actor's reference", async () => {
    const { wrapper, body, session } = await openPage(); await review(wrapper); await confirm(body);
    const stored = sessionStorage.getItem(recordKey); session.user = { id: 8, roles: [], permissions: ["inventory.view", "inventory.adjust"] }; await flushPromises();
    expect(wrapper.text()).not.toContain(JSON.parse(stored).source.documentId);
    expect(sessionStorage.getItem(recordKey)).toBe(stored); expect(body.find('input[type="password"]').exists()).toBe(false);
  });
  it("UI033-REFRESH blocks POST when minimal recovery identity cannot be saved", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper);
    const blocked = vi.spyOn(Object.getPrototypeOf(sessionStorage), "setItem").mockImplementation(() => { throw new Error("quota"); }); await confirm(body);
    expect(blocked).toHaveBeenCalledOnce();
    expect(inventory.postAdjustment).not.toHaveBeenCalled(); expect(wrapper.text()).toContain("無法保存復原識別");
  });
  it("UI033-RETRY preserves earlier UNKNOWN even when a later retry is definitively rejected", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper); await confirm(body);
    inventory.postAdjustment.mockRejectedValue(Object.assign(new Error("版本已變更"), { code: "VERSION_CONFLICT", status: 409 }));
    await button(wrapper, "重試原意圖").trigger("click"); await flushPromises(); await confirm(body, "fresh-entry");
    expect(wrapper.text()).toContain("結果未知"); expect(sessionStorage.getItem(recordKey)).not.toBeNull();
    expect(button(wrapper, "核對結果並重新準備")).toBeUndefined();
  });
  it("UI033-RECONCILE resolves only exact source/operation/group and reloads actual facts", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper); await confirm(body);
    const stored = JSON.parse(sessionStorage.getItem(recordKey));
    inventory.findOperationBySource.mockResolvedValue({ operationId: 31, resultType: "MOVEMENT_GROUP", resultId: "posted-group", resultSummary: { status: "POSTED", baseQuantity: 3, lineCount: 1 }, completedAt: 10 });
    const matched = { movementId: 22, operationId: 31, groupId: "posted-group", source: stored.source, ...BUCKET };
    inventory.listMovements.mockResolvedValue({ rows: [{ ...matched, movementId: 21, source: { ...stored.source, eventId: "other" } }, matched], rowsNumber: 2 });
    inventory.getMovement.mockResolvedValue({ movement: matched, groupLegs: [matched], reversal: {} });
    await button(wrapper, "查詢原結果").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("已確認過帳"); expect(wrapper.find('[aria-label="查看已過帳 Movement 22"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="查看已過帳 Movement 21"]').exists()).toBe(false);
    expect(inventory.listStocks).toHaveBeenCalled(); expect(sessionStorage.getItem(recordKey)).toBeNull();
    expect(inventory.postAdjustment).toHaveBeenCalledTimes(1);
  });
  it("UI033-UNKNOWN-QUERY reports only resolved truth when a lost response is immediately reconciled", async () => {
    const { wrapper, body } = await openPage(); await review(wrapper);
    inventory.findOperationBySource.mockImplementation(async source => {
      const matched = { ...BUCKET, movementId: 22, operationId: 31, groupId: "posted-group", source };
      inventory.listMovements.mockResolvedValue({ rows: [matched], rowsNumber: 1 });
      inventory.getMovement.mockResolvedValue({ movement: matched, groupLegs: [matched], reversal: {} });
      return { operationId: 31, resultType: "MOVEMENT_GROUP", resultId: "posted-group", resultSummary: {}, completedAt: 10 };
    });
    await confirm(body);
    expect(wrapper.text()).toContain("已確認過帳"); expect(sessionStorage.getItem(recordKey)).toBeNull();
    expect(inventory.postAdjustment).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenCalledTimes(1); expect(notifyError).not.toHaveBeenCalled();
  });
});
