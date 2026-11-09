import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/purchasing.js", () => ({ default: { getPurchaseOrder: vi.fn(), updatePurchaseOrder: vi.fn(), submitPurchaseOrder: vi.fn(), lookupCurrencies: vi.fn(), lookupPaymentTerms: vi.fn() } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));
import purchasing from "@/services/purchasing.js";
import { notifyError, notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import Create, { page as createPage } from "@/pages/purchasing/PurchaseOrderCreatePage.vue";
import Edit, { page as editPage } from "@/pages/purchasing/PurchaseOrderEditPage.vue";
import { useSessionStore } from "@/stores/session.js";

const line = { id: 11, lineNumber: 1, skuId: 7, skuCode: "SKU7", skuName: "貨品", trackingPolicy: "NONE", baseUomCode: "EA", purchaseSkuUomId: 2, purchaseUomCode: "BOX", uomToBaseFactor: 10, orderedQuantity: "1.000000", unitPrice: "12.3400", zeroPriceReason: "", expectedDeliveryDate: null, lineNote: "" };
const draft = { id: 8, number: "PO-202611-000008", status: "DRAFT", version: 2, supplierId: 3, supplierCode: "S3", supplierName: "供應商", currencyCode: "HKD", currencyName: "港幣", currencyDecimalPlaces: 2, orderDate: "2026-11-01", expectedDeliveryDate: null, buyerId: 5, buyerLabel: "採購員甲", supplierReference: "", totalAmount: "12.34", orderingAddressId: null, orderingAddress: null, paymentTermId: 1, paymentTerm: { code: "N30", name: "30 天" }, defaultReceivingWarehouseId: null, defaultWarehouseCode: "", notes: "", allowedActions: ["edit", "submit", "copy"], lines: [line] };
const saved = { id: 8, number: draft.number, status: "DRAFT", version: 3, warnings: [], replayed: false };
const VIEW = ["purchasing.view"], MANAGE = ["purchasing.view", "purchasing.mgmt"];
const button = (label) => wrapper.findAll("button,a").find((node) => node.text() === label);
const price = () => wrapper.find('input[aria-label="單價 1 *"]');
let wrapper;

async function open(path, { permissions = MANAGE, stubs = {} } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...createPage, component: Create, meta: { title: createPage.title } }, { ...editPage, component: Edit }, { path: "/purchasing/purchase-orders/:id", name: "detail", component: { render: () => h("p", "詳情頁") } }, { path: "/purchasing/purchase-orders", name: "list", component: { render: () => h("p", "列表頁") } }] });
  await router.push(path);
  await router.isReady();
  useSessionStore().user = { id: 5, displayName: "採購員甲", username: "buyer", permissions, roles: [] };
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router], stubs }, attachTo: document.body });
  await flushPromises();
  return router;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  purchasing.getPurchaseOrder.mockResolvedValue(draft);
  purchasing.lookupCurrencies.mockResolvedValue([]);
  purchasing.lookupPaymentTerms.mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("TASK-020 新增頁", () => {
  const FormStub = defineComponent({ name: "PurchaseOrderForm", props: ["actor", "document"], emits: ["saved"], setup: (props, { emit }) => () => h("button", { "data-testid": "stub", onClick: () => emit("saved", { ...saved, id: 20, number: "PO-202611-000020", warnings: [{ code: "SKU_NOT_PURCHASABLE", lineNumber: 2 }, { code: "SUPPLIER_NOT_PURCHASABLE" }] }) }, JSON.stringify(props.actor)) });

  it("要 view 同 mgmt；採購員預設目前用戶；新單冇 document", async () => {
    expect(createPage.requires.permissions).toEqual(MANAGE);
    expect(createPage.path).toBe("/purchasing/purchase-orders/new");
    await open("/purchasing/purchase-orders/new", { stubs: { PurchaseOrderForm: FormStub } });
    expect(wrapper.find("h1").text()).toBe("新增採購單");
    expect(JSON.parse(wrapper.find('[data-testid="stub"]').text())).toEqual({ id: 5, label: "採購員甲" });
    expect(wrapper.findComponent(FormStub).props("document")).toBeUndefined();
    expect(purchasing.getPurchaseOrder).not.toHaveBeenCalled();
  });
  it("儲存後取代歷史去編輯頁，warning 用文字顯示", async () => {
    const router = await open("/purchasing/purchase-orders/new", { stubs: { PurchaseOrderForm: FormStub } });
    const replace = vi.spyOn(router, "replace");
    await wrapper.find('[data-testid="stub"]').trigger("click");
    await flushPromises();
    expect(replace).toHaveBeenCalledWith("/purchasing/purchase-orders/20/edit");
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/20/edit");
    expect(notifySuccess.mock.calls[0][0]).toContain("PO-202611-000020");
    expect(notifyWarning.mock.calls.map(([message]) => message)).toEqual(["第 2 行的貨品目前不可採購；提交前請修正。", "供應商目前不可採購；提交前請更換或恢復供應商。"]);
  });
});

describe("TASK-020 編輯頁", () => {
  it("要 view 同 mgmt；Draft 帶入 server 值", async () => {
    expect(editPage.requires.permissions).toEqual(MANAGE);
    await open("/purchasing/purchase-orders/8/edit");
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledWith("8", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(wrapper.find("h1").text()).toBe(`編輯 ${draft.number}`);
    expect(price().element.value).toBe("12.3400");
  });
  it("儲存：帶版本、重新讀取但表單唔 unmount，warning 有提示", async () => {
    purchasing.updatePurchaseOrder.mockResolvedValue({ ...saved, warnings: [{ code: "SUPPLIER_NOT_PURCHASABLE" }] });
    await open("/purchasing/purchase-orders/8/edit");
    const form = price().element;
    await price().setValue("20");
    purchasing.getPurchaseOrder.mockResolvedValue({ ...draft, version: 3, lines: [{ ...line, unitPrice: "20.0000" }] });
    await button("儲存草稿").trigger("click");
    await flushPromises();
    expect(purchasing.updatePurchaseOrder).toHaveBeenCalledWith(8, expect.objectContaining({ version: 2, eventId: expect.any(String) }));
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(price().element).toBe(form);
    expect(price().element.value).toBe("20.0000");
    expect(notifySuccess.mock.calls[0][0]).toContain("已儲存");
    expect(notifyWarning).toHaveBeenCalledWith("供應商目前不可採購；提交前請更換或恢復供應商。");
  });
  it("儲存後重新讀取失敗：有訊息可重試，唔會留低舊版本繼續改", async () => {
    purchasing.updatePurchaseOrder.mockResolvedValue(saved);
    await open("/purchasing/purchase-orders/8/edit");
    await price().setValue("20");
    purchasing.getPurchaseOrder.mockRejectedValueOnce(new Error("讀取失敗"));
    await button("儲存草稿").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain("讀取失敗");
    expect(price().exists()).toBe(false);
    purchasing.getPurchaseOrder.mockResolvedValue({ ...draft, version: 3 });
    await button("重試").trigger("click");
    await flushPromises();
    expect(price().exists()).toBe(true);
  });
  it("提交成功去詳情頁", async () => {
    purchasing.submitPurchaseOrder.mockResolvedValue({ id: 8, number: draft.number, status: "CONFIRMED", outcome: "CONFIRMED", version: 3, warnings: [], replayed: false });
    const router = await open("/purchasing/purchase-orders/8/edit");
    await button("提交").trigger("click");
    await flushPromises();
    const confirmButton = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "確認提交");
    confirmButton.click();
    await flushPromises();
    expect(purchasing.submitPurchaseOrder).toHaveBeenCalledWith(8, expect.objectContaining({ version: 2 }));
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8");
    expect(notifySuccess.mock.calls[0][0]).toContain("已提交");
  });
  it("版本衝突：輸入保留；確認後載入最新版本", async () => {
    purchasing.updatePurchaseOrder.mockRejectedValue(Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT", status: 409, details: { currentVersion: 5 } }));
    await open("/purchasing/purchase-orders/8/edit");
    await price().setValue("20");
    await button("儲存草稿").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("最新版本 5");
    expect(price().element.value).toBe("20");
    window.confirm.mockReturnValue(false);
    await button("載入最新資料").trigger("click");
    await flushPromises();
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(1);
    window.confirm.mockReturnValue(true);
    purchasing.getPurchaseOrder.mockResolvedValue({ ...draft, version: 5, lines: [{ ...line, unitPrice: "30.0000" }] });
    await button("載入最新資料").trigger("click");
    await flushPromises();
    expect(price().element.value).toBe("30.0000");
    expect(wrapper.text()).not.toContain("最新版本 5");
  });
  it("改咗未存：離開要確認，拒絕就留低", async () => {
    const router = await open("/purchasing/purchase-orders/8/edit");
    await price().setValue("20");
    window.confirm.mockReturnValue(false);
    await router.push("/purchasing/purchase-orders");
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8/edit");
    expect(price().element.value).toBe("20");
    window.confirm.mockReturnValue(true);
    await router.push("/purchasing/purchase-orders");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders");
  });
  it.each([
    ["非 Draft", { ...draft, status: "CONFIRMED", allowedActions: ["copy"] }, MANAGE],
    ["前端冇 mgmt", draft, VIEW]
  ])("%s：唔出表單，只有返回詳情", async (_, document, permissions) => {
    purchasing.getPurchaseOrder.mockResolvedValue(document);
    await open("/purchasing/purchase-orders/8/edit", { permissions });
    expect(price().exists()).toBe(false);
    expect(button("儲存草稿")).toBeUndefined();
    expect(wrapper.text()).toContain("不允許編輯");
    expect(button("查看採購單").attributes("href")).toBe("/purchasing/purchase-orders/8");
  });
  it.each(["abc", "0", "..%2Fusers"])("唔合法嘅 id %s 唔會打 API", async (id) => {
    await open(`/purchasing/purchase-orders/${id}/edit`);
    expect(purchasing.getPurchaseOrder).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').text()).toContain("找不到此採購單");
  });
  it("讀取失敗可重試", async () => {
    purchasing.getPurchaseOrder.mockRejectedValueOnce(new Error("載入失敗"));
    await open("/purchasing/purchase-orders/8/edit");
    expect(wrapper.find('[role="alert"]').text()).toContain("載入失敗");
    await button("重試").trigger("click");
    await flushPromises();
    expect(price().exists()).toBe(true);
  });
});

describe("TASK-024 R1：Edit 頁係儲存／提交 record 嘅穩定 owner", () => {
  const PATH = "/purchasing/purchase-orders/8/edit";
  const timeout = () => Object.assign(new Error("逾時"), { code: "TIMEOUT" });
  const conflict = () => Object.assign(new Error("版本已更改"), { code: "VERSION_CONFLICT", status: 409, details: { currentVersion: 9 } });
  const confirmed = { id: 8, number: draft.number, status: "CONFIRMED", outcome: "CONFIRMED", version: 3, warnings: [], replayed: false };
  const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
  // 同一 actor 權限刷新（仍有 mgmt）：usePurchaseOrder 重新讀取唔 keep，父頁 loading 令 Form 卸載再重建。
  const refresh = (permissions = [...MANAGE, "purchasing.approval"], user = { id: 5, displayName: "採購員甲", username: "buyer" }) => {
    useSessionStore().user = { ...user, permissions: [...permissions], roles: [] };
    return flushPromises();
  };
  const dialogButton = (label) => [...document.body.querySelectorAll(".q-dialog button")].find((node) => node.textContent.trim() === label);
  const save = async () => { await button("儲存草稿").trigger("click"); await flushPromises(); };
  const openSubmit = async () => { await button("提交").trigger("click"); await flushPromises(); dialogButton("確認提交").click(); await flushPromises(); };
  beforeEach(() => { purchasing.updatePurchaseOrder.mockReset(); purchasing.submitPurchaseOrder.mockReset(); });

  it.each([
    ["a 權限刷新（仍有 mgmt）", false],
    ["b 同一張 PO 讀取失敗後重試", true]
  ])("C8 %s：儲存未確定，Form 卸載重建後顯示原值兼鎖住，重試送原 body", async (_, failOnce) => {
    purchasing.updatePurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValue(saved);
    await open(PATH);
    await price().setValue("20");
    await save();
    expect(wrapper.text()).toContain("結果尚未確認");
    if (failOnce) purchasing.getPurchaseOrder.mockRejectedValueOnce(new Error("讀取失敗"));
    await refresh();
    if (failOnce) {
      expect(wrapper.find('[role="alert"]').text()).toContain("讀取失敗");
      expect(price().exists()).toBe(false);
      expect(wrapper.find('[data-testid="po-hidden-unknown"]').text()).toContain("儲存結果尚未確認");
      await button("重試").trigger("click");
      await flushPromises();
    }
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(failOnce ? 3 : 2);
    expect(price().element.value).toBe("20");
    expect(price().element.matches(":disabled")).toBe(true);
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.updatePurchaseOrder.mock.calls;
    expect(purchasing.updatePurchaseOrder).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
  });

  it("C9 提交未確定之後 VERSION_CONFLICT：對話框留低、唔入 stale；之後成功都係原 body", async () => {
    purchasing.submitPurchaseOrder.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(conflict()).mockResolvedValue(confirmed);
    const router = await open(PATH);
    await openSubmit();
    dialogButton("重試確認結果").click();
    await flushPromises();
    expect(wrapper.text()).not.toContain("最新版本 9");
    expect(dialogButton("重試確認結果")).toBeDefined();
    dialogButton("重試確認結果").click();
    await flushPromises();
    const [first, second, third] = purchasing.submitPurchaseOrder.mock.calls;
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8");
  });

  it("C10 提交 in-flight 期間 Form 重建：新 Form 對話框忙住；成功只由 owner 處理一次", async () => {
    const held = deferred();
    purchasing.submitPurchaseOrder.mockReturnValueOnce(held.promise);
    const router = await open(PATH);
    await openSubmit();
    await refresh();
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('[data-testid="po-submit-summary"]')).not.toBeNull();
    expect(dialogButton("確認提交").disabled).toBe(true);
    held.resolve(confirmed);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8");
    expect(notifySuccess).toHaveBeenCalledTimes(1);
    expect(purchasing.submitPurchaseOrder).toHaveBeenCalledTimes(1);
  });

  it("C15 儲存中換 actor：原 call 之後 409，新畫面冇錯誤、冇 stale、owner 唔通知", async () => {
    const held = deferred();
    purchasing.updatePurchaseOrder.mockReturnValueOnce(held.promise);
    await open(PATH);
    await price().setValue("20");
    await save();
    await refresh(MANAGE, { id: 6, displayName: "採購員乙", username: "buyer2" });
    held.reject(conflict());
    await flushPromises();
    expect(wrapper.text()).not.toContain("最新版本 9");
    expect(wrapper.text()).not.toContain("版本已更改");
    expect(notifyError).not.toHaveBeenCalled();
    expect(price().element.matches(":disabled")).toBe(false);
    expect(purchasing.updatePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a 有 mgmt：用原內容重試", [...MANAGE, "purchasing.approval"], true],
    ["b 冇 mgmt：只顯示被擋", VIEW, false]
  ])("C16 %s——提交其實成功但回應丟失，重新讀取已唔可以編輯，Edit 頁保留未確定提交", async (_, permissions, canReplay) => {
    purchasing.submitPurchaseOrder.mockRejectedValueOnce(timeout()).mockResolvedValue({ ...confirmed, status: "PENDING_APPROVAL", outcome: "PENDING_APPROVAL", replayed: true });
    const router = await open(PATH);
    await openSubmit();
    purchasing.getPurchaseOrder.mockResolvedValue({ ...draft, status: "PENDING_APPROVAL", version: 3, allowedActions: ["copy"] });
    await refresh(permissions);
    expect(price().exists()).toBe(false);
    const banner = wrapper.find('[data-testid="po-hidden-unknown"]');
    expect(banner.text()).toContain("提交結果尚未確認");
    if (canReplay) {
      await button("以原內容重試提交").trigger("click");
      await flushPromises();
      const [first, second] = purchasing.submitPurchaseOrder.mock.calls;
      expect(second).toEqual(first);
      expect(router.currentRoute.value.path).toBe("/purchasing/purchase-orders/8");
      expect(notifySuccess.mock.calls.at(-1)[0]).toContain("已提交審批");
    } else {
      expect(banner.text()).toContain("沒有採購管理權限");
      expect(button("以原內容重試提交")).toBeUndefined();
      expect(purchasing.submitPurchaseOrder).toHaveBeenCalledTimes(1);
    }
    expect(purchasing.getPurchaseOrder).toHaveBeenCalledTimes(2);
  });

  it("C18 儲存 in-flight 期間 Form 重建：新 Form 鎖住顯示原值；原 call TIMEOUT 之後新 Form 跟住轉未確定，重試送原 body", async () => {
    const held = deferred();
    purchasing.updatePurchaseOrder.mockReturnValueOnce(held.promise).mockResolvedValue(saved);
    await open(PATH);
    await price().setValue("20");
    await save();
    await refresh();
    expect(price().element.value).toBe("20");
    expect(price().element.matches(":disabled")).toBe(true);
    held.reject(timeout());
    await flushPromises();
    expect(wrapper.text()).toContain("結果尚未確認");
    expect(price().element.value).toBe("20");
    await button("重試確認結果").trigger("click");
    await flushPromises();
    const [first, second] = purchasing.updatePurchaseOrder.mock.calls;
    expect(second).toEqual(first);
  });
});
