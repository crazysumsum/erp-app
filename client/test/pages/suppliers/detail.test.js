import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { getById: vi.fn(), completeness: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/services/supplierBank.js", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), deactivate: vi.fn(), reveal: vi.fn() },
  service: { name: "supplierBank" }
}));
vi.mock("@/services/businessMaster.js", () => ({
  default: { currencyList: vi.fn().mockResolvedValue({ rows: [] }), paymentTermList: vi.fn().mockResolvedValue({ rows: [] }) },
  service: { name: "businessMaster" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import supplierService from "@/services/supplier.js";
import supplierBankService from "@/services/supplierBank.js";
import SupplierDetailPage, { page } from "@/pages/suppliers/SupplierDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const DETAIL = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "suspended", version: 2,
  website: "", generalPhone: "2123 4567", generalEmail: "orders@example.test", notes: "",
  createdAt: 100, updatedAt: 200, addresses: [], contacts: [], identifiers: [],
  // 呢個欄位伺服器永遠唔會填 —— toSupplierDetailResponse 個 `bankAccounts` 有一個
  // default `[]` 而冇任何 caller 傳嘢俾佢。留返喺度係因為 response schema 要求佢
  // 存在，但任何斷言都唔可以靠佢：真嘅遮罩清單由 SupplierBankPanel 自己叫
  // GET /suppliers/:id/bank-accounts 攞。
  bankAccounts: [],
  warnings: [{ field: "addresses", code: "ORDERING_ADDRESS_MISSING", message: "尚未設定採購用途地址" }]
};

async function mountPage({ permissions = ["supplier.view"], detail = DETAIL } = {}) {
  if (detail instanceof Error) supplierService.getById.mockRejectedValue(detail);
  else supplierService.getById.mockResolvedValue(detail);
  supplierService.completeness.mockResolvedValue({ supplierId: 7, issues: [], warnings: detail?.warnings ?? [] });
  supplierBankService.list.mockResolvedValue([
    { id: 4, bankName: "Test Bank", accountHolderName: "Evergreen Trading", maskedAccountNumber: "•••• 6789",
      status: "active", isDefault: true, version: 1 }
  ]);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: SupplierDetailPage }] });
  await router.push("/suppliers/7"); await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

const DETAIL_8 = {
  ...DETAIL, id: 8, supplierCode: "SUP-008", supplierName: "Northwind Supply",
  displayName: "Northwind", status: "active", version: 1, bankAccounts: [], warnings: []
};
const DETAIL_9 = { ...DETAIL_8, id: 9, supplierCode: "SUP-009", supplierName: "Kowloon Metals" };
const BY_ID = { 7: DETAIL, 8: DETAIL_8, 9: DETAIL_9 };

function serveById(overrides = {}) {
  supplierService.getById.mockImplementation((id) => overrides[id] ?? Promise.resolve(BY_ID[id]));
  supplierService.completeness.mockImplementation((id) => Promise.resolve({ supplierId: id, issues: [], warnings: BY_ID[id]?.warnings ?? [] }));
}

function editNameInput(body, currentValue) {
  return body.findAll("input").find((input) => input.element.value === currentValue);
}

async function clickButton(body, label) {
  await body.findAll("button").find((button) => button.text().includes(label)).trigger("click");
  await flushPromises();
}

describe("pages/suppliers/SupplierDetailPage.vue", () => {
  // restoreAllMocks 唔止清紀錄：下面有 test spy 住 window.confirm，唔還原嘅話會漏去
  // 後面嘅 test，令佢哋喺一個唔係自己設定嘅環境跑。
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("requires supplier.view and shows status, completeness and masked bank data", async () => {
    expect(page.requires.permissions).toEqual(["supplier.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("SUP-007");
    expect(body.text()).toContain("已暫停");
    expect(body.text()).toContain("不可用於新採購");
    expect(body.text()).toContain("尚未設定採購用途地址");
    await body.findAll(".q-tab").find((item) => item.text().includes("銀行資料")).trigger("click");
    await flushPromises();
    expect(supplierBankService.list).toHaveBeenCalledWith(7);
    expect(body.text()).toContain("•••• 6789");
    expect(body.text()).not.toContain("accountNumber");
    // 開個 tab 唔等於攞明文：AC-023。
    expect(supplierBankService.reveal).not.toHaveBeenCalled();
  });

  it("distinguishes not-found and generic loading failures", async () => {
    const missing = Object.assign(new Error("找不到這個供應商"), { code: "SUPPLIER_NOT_FOUND" });
    const { body } = await mountPage({ detail: missing });
    expect(body.text()).toContain("找不到這個供應商");
    expect(body.text()).toContain("返回供應商列表");
  });

  // `/suppliers/:id` 是一條 route record：換 param 時 Vue Router 重用同一個 component
  // instance，不會 unmount，所以只有 watcher 會令資料跟得上網址。
  it("refetches and renders the new supplier when the route id changes on a reused instance", async () => {
    const { wrapper, router, body } = await mountPage();
    const instanceUid = wrapper.findComponent(SupplierDetailPage).vm.$.uid;
    serveById();

    await router.push("/suppliers/8");
    await flushPromises();

    // 先釘住前提：真的是重用，不是 unmount 後重新掛載——否則這個測試會因為錯的理由變綠。
    expect(wrapper.findComponent(SupplierDetailPage).vm.$.uid).toBe(instanceUid);
    expect(supplierService.getById).toHaveBeenCalledWith(8);
    expect(supplierService.completeness).toHaveBeenCalledWith(8);
    expect(body.text()).toContain("SUP-008");
    expect(body.text()).toContain("Northwind Supply");
    expect(body.text()).not.toContain("SUP-007");
    expect(body.text()).not.toContain("Evergreen Trading");
  });

  // jsdom 嘅 window.confirm 返 undefined，而 vue-router 只當 `false` 算取消——即係唔
  // stub 嘅話呢兩個 test 都會照過，而個 guard 係咪真係守到就冇人驗過。
  it("drops a half-edited form instead of carrying it onto the next supplier", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { router, body } = await mountPage({ permissions: ["supplier.view", "supplier.mgmt"] });
    await clickButton(body, "編輯一般資料");
    await editNameInput(body, "Evergreen Trading").setValue("Evergreen Trading (draft)");
    expect(body.text()).toContain("儲存一般資料");
    serveById();

    await router.push("/suppliers/8");
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledWith("有未儲存的變更，確定要離開這一頁嗎？");

    // 編輯面板收起來了，代表 editing 已經清掉：沒有東西可以用 8 號的 id 提交 7 號的輸入。
    expect(body.text()).not.toContain("儲存一般資料");
    await clickButton(body, "編輯一般資料");
    expect(editNameInput(body, "Northwind Supply")).toBeTruthy();
    expect(editNameInput(body, "Evergreen Trading (draft)")).toBeUndefined();
  });

  it("keeps the user on the current supplier when they refuse to discard the draft", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { router, body } = await mountPage({ permissions: ["supplier.view", "supplier.mgmt"] });
    await clickButton(body, "編輯一般資料");
    await editNameInput(body, "Evergreen Trading").setValue("Evergreen Trading (draft)");
    serveById();

    await router.push("/suppliers/8").catch(() => {});
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe("/suppliers/7");
    expect(supplierService.getById).not.toHaveBeenCalledWith(8);
    // 草稿要原封不動：問完「唔好走」之後仲要食咗人哋啲輸入，比唔問更差。
    expect(editNameInput(body, "Evergreen Trading (draft)")).toBeTruthy();
  });

  it("ignores a load response that a newer navigation has superseded", async () => {
    const { router, body } = await mountPage();
    let resolveNine;
    serveById({ 9: new Promise((resolve) => { resolveNine = resolve; }) });

    await router.push("/suppliers/9");
    await flushPromises();
    await router.push("/suppliers/8");
    await flushPromises();
    resolveNine(DETAIL_9);
    await flushPromises();

    expect(body.text()).toContain("SUP-008");
    expect(body.text()).not.toContain("SUP-009");
    expect(body.text()).not.toContain("Kowloon Metals");
  });
});
