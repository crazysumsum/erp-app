import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: {
    getSku: vi.fn(),
    updateSku: vi.fn(),
    activateSku: vi.fn(),
    deactivateSku: vi.fn(),
    discontinueSku: vi.fn(),
    archiveSku: vi.fn(),
    restoreSku: vi.fn(),
    deleteSku: vi.fn(),
    changeSkuCode: vi.fn(),
    releaseBarcode: vi.fn()
  },
  service: { name: "item" }
}));
vi.mock("@/services/itemCatalog.js", () => ({
  default: { uomList: vi.fn() },
  service: { name: "itemCatalog" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({
  promptPassword: vi.fn(),
  promptReason: vi.fn()
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemService from "@/services/item.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import SkuDetailPage, { page } from "@/pages/items/SkuDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const SKU = {
  id: 10,
  skuCode: "VITC-90",
  skuName: "維他命 C 90 粒裝",
  item: { id: 1, name: "維他命 C 1000mg", status: "active", productType: "standard", categoryId: null, categoryName: null, brandId: null, brandName: null },
  variantSignature: null,
  variantValues: [],
  netContent: null,
  netContentUomId: null,
  weight: null,
  weightUomId: null,
  length: null,
  width: null,
  height: null,
  dimensionUomId: null,
  trackingPolicy: "none",
  shelfLifeDays: null,
  minReceiptLifeDays: null,
  minSaleLifeDays: null,
  purchasable: true,
  sellable: true,
  inventoryTracked: true,
  suggestedRetailPrice: { amount: "128.0000", currency: "HKD", taxBasis: "tax_not_applicable" },
  effectiveFrom: null,
  effectiveTo: null,
  status: "active",
  uoms: [{ id: 201, uomId: 5, uomCode: "EA", uomName: "Each", toBaseFactor: 1, isBase: true, isDefaultPurchase: false, isDefaultSale: true }],
  barcodes: [{ id: 301, skuUomId: 201, barcode: "4710088412345", normalizedBarcode: "4710088412345", barcodeType: "ean13", isPrimary: true, version: 1 }],
  media: [],
  version: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
};

const RouterViewHost = { render: () => h(RouterView) };

const UOMS = [{ id: 5, code: "EA", name: "Each", status: "active" }];

async function mountPage({ permissions = ["item.view", "item.mgmt"], sku = SKU } = {}) {
  itemService.getSku.mockResolvedValue(sku);
  itemCatalogService.uomList.mockResolvedValue(UOMS);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, name: page.name, component: SkuDetailPage },
      { path: "/items/:id", name: "itemDetail", component: { template: "<div>item detail</div>" } }
    ]
  });
  await router.push("/items/1/skus/10");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam", permissions, roles: [] };

  const wrapper = mount(RouterViewHost, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/items/SkuDetailPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("item.view-only：睇得到詳情，冇「編輯」按鈕", async () => {
    const { body } = await mountPage({ permissions: ["item.view"] });

    expect(body.text()).toContain("VITC-90");
    const priceInput = body.findAll(".q-field").find((f) => f.text().includes("建議零售價")).find("input");
    expect(priceInput.element.value).toBe("128.0000");
    expect(body.findAll(".q-btn").some((btn) => btn.text() === "編輯")).toBe(false);
  });

  it("SKU Code 就算撳咗「編輯」都仲係 readonly", async () => {
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    const skuCodeInput = body.findAll(".q-field").find((f) => f.text().includes("SKU Code")).find("input");
    expect(skuCodeInput.attributes("readonly")).toBeDefined();
  });

  it("改非關鍵欄位（SKU 名稱）唔使填原因，儲存成功", async () => {
    itemService.updateSku.mockResolvedValue({ ...SKU, skuName: "新名", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    const nameInput = body.findAll(".q-field").find((f) => f.text().includes("SKU 名稱")).find("input");
    await nameInput.setValue("新名");
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(itemService.updateSku).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ skuName: "新名", version: 1, reason: undefined })
    );
    expect(notifySuccess).toHaveBeenCalled();
    expect(body.text()).toContain("版本 2");
  });

  it("關鍵變更冇填原因：後端 CRITICAL_CHANGE_REASON_REQUIRED 原樣顯示", async () => {
    const error = Object.assign(new Error("修改 Base 單位、單位換算係數或追蹤政策時必須填寫原因"), {
      code: "CRITICAL_CHANGE_REASON_REQUIRED"
    });
    itemService.updateSku.mockRejectedValue(error);
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(body.text()).toContain("必須填寫原因");
  });

  it("VERSION_CONFLICT：唔會自動覆蓋用戶輸入", async () => {
    const conflict = Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" });
    itemService.updateSku.mockRejectedValue(conflict);
    itemService.getSku.mockResolvedValueOnce(SKU).mockResolvedValueOnce({ ...SKU, skuName: "被人改咗", version: 5 });

    const { body } = await mountPage();
    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    const nameInput = body.findAll(".q-field").find((f) => f.text().includes("SKU 名稱")).find("input");
    await nameInput.setValue("我自己打緊");
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(body.text()).toContain("已經被人改過");
    expect(nameInput.element.value).toBe("我自己打緊");
  });

  it("Active SKU：只顯示「停用」「停產」，撳「停用」用 promptReason 帶 reason／version", async () => {
    promptReason.mockResolvedValue("暫停銷售");
    itemService.deactivateSku.mockResolvedValue({ ...SKU, status: "inactive", version: 2 });
    const { body } = await mountPage();

    const buttonLabels = body.findAll(".q-btn").map((btn) => btn.text());
    expect(buttonLabels).toContain("停用");
    expect(buttonLabels).toContain("停產");
    expect(buttonLabels).not.toContain("啟用");
    expect(buttonLabels).not.toContain("封存");
    expect(buttonLabels).not.toContain("從封存恢復");

    await body.findAll(".q-btn").find((btn) => btn.text() === "停用").trigger("click");
    await flushPromises();

    expect(promptReason).toHaveBeenCalledWith(expect.objectContaining({ title: "停用 SKU" }));
    expect(itemService.deactivateSku).toHaveBeenCalledWith(10, { reason: "暫停銷售", version: 1 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("已停用"));
    expect(body.text()).toContain("版本 2");
  });

  it("取消 promptReason 唔會呼叫任何 API", async () => {
    promptReason.mockResolvedValue(null);
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停用").trigger("click");
    await flushPromises();

    expect(itemService.deactivateSku).not.toHaveBeenCalled();
  });

  it("父 Item Active＋SKU Inactive：顯示「啟用」，撳咗會叫 activateSku", async () => {
    promptReason.mockResolvedValue("重新上架");
    const inactiveSku = { ...SKU, status: "inactive" };
    itemService.activateSku.mockResolvedValue({ ...SKU, status: "active", version: 2 });
    const { body } = await mountPage({ sku: inactiveSku });

    expect(body.findAll(".q-btn").some((btn) => btn.text() === "啟用")).toBe(true);

    await body.findAll(".q-btn").find((btn) => btn.text() === "啟用").trigger("click");
    await flushPromises();

    expect(itemService.activateSku).toHaveBeenCalledWith(10, { reason: "重新上架", version: 1 });
  });

  it("父 Item 未 Active：唔顯示「啟用」（就算 SKU 本身係 Inactive）", async () => {
    const { body } = await mountPage({
      sku: { ...SKU, status: "inactive", item: { ...SKU.item, status: "draft" } }
    });

    expect(body.findAll(".q-btn").some((btn) => btn.text() === "啟用")).toBe(false);
  });

  it("停產：用 promptPassword({ requireReason: true })", async () => {
    promptPassword.mockResolvedValue({ reason: "停產清貨", password: "hunter2" });
    itemService.discontinueSku.mockResolvedValue({ ...SKU, status: "discontinued", version: 2, purchasable: false });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停產").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemService.discontinueSku).toHaveBeenCalledWith(10, {
      reason: "停產清貨",
      password: "hunter2",
      version: 1
    });
    expect(body.text()).toContain("已停產");
  });

  it("封存、恢復：完整走一次", async () => {
    promptPassword
      .mockResolvedValueOnce({ reason: "封存", password: "hunter2" })
      .mockResolvedValueOnce({ reason: "恢復", password: "hunter2" });
    itemService.archiveSku.mockResolvedValue({ ...SKU, status: "archived", version: 2 });
    itemService.restoreSku.mockResolvedValue({ ...SKU, status: "inactive", version: 3 });
    const { body } = await mountPage({ sku: { ...SKU, status: "inactive" } });

    await body.findAll(".q-btn").find((btn) => btn.text() === "封存").trigger("click");
    await flushPromises();
    expect(itemService.archiveSku).toHaveBeenCalledWith(10, { reason: "封存", password: "hunter2", version: 1 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("已封存"));
    expect(body.text()).toContain("已封存");

    await body.findAll(".q-btn").find((btn) => btn.text() === "從封存恢復").trigger("click");
    await flushPromises();
    expect(itemService.restoreSku).toHaveBeenCalledWith(10, { reason: "恢復", password: "hunter2", version: 2 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("已從封存恢復"));
  });

  it("生命週期動作撞 VERSION_CONFLICT：重新載入最新資料再顯示錯誤", async () => {
    promptReason.mockResolvedValue("暫停銷售");
    const conflict = Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" });
    itemService.deactivateSku.mockRejectedValue(conflict);
    itemService.getSku.mockResolvedValueOnce(SKU).mockResolvedValueOnce({ ...SKU, version: 9 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停用").trigger("click");
    await flushPromises();

    expect(itemService.getSku).toHaveBeenCalledTimes(2);
    expect(notifyError).toHaveBeenCalled();
    expect(body.text()).toContain("版本 9");
  });

  it("Draft SKU：顯示「刪除」；Active SKU：唔顯示", async () => {
    const draft = await mountPage({ sku: { ...SKU, status: "draft" } });
    expect(draft.body.findAll(".q-btn").some((btn) => btn.text() === "刪除")).toBe(true);

    document.body.innerHTML = "";
    const active = await mountPage();
    expect(active.body.findAll(".q-btn").some((btn) => btn.text() === "刪除")).toBe(false);
  });

  it("刪除 SKU：promptPassword({ requireReason: true })，成功後導返商品詳情", async () => {
    promptPassword.mockResolvedValue({ reason: "測試刪除", password: "hunter2" });
    itemService.deleteSku.mockResolvedValue({ id: 10 });
    const { body, router } = await mountPage({ sku: { ...SKU, status: "draft" } });

    await body.findAll(".q-btn").find((btn) => btn.text() === "刪除").trigger("click");
    await flushPromises();

    expect(itemService.deleteSku).toHaveBeenCalledWith(10, { reason: "測試刪除", password: "hunter2", version: 1 });
    expect(router.currentRoute.value.path).toBe("/items/1");
  });

  it("特批修改 SKU Code：填新 Code／原因／密碼，成功後畫面更新新 Code", async () => {
    itemService.changeSkuCode.mockResolvedValue({ ...SKU, skuCode: "VITC-90-NEW", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "特批修改 Code").trigger("click");
    await flushPromises();

    const codeInput = body.findAll(".q-field").find((f) => f.text().includes("新 SKU Code")).find("input");
    await codeInput.setValue("VITC-90-NEW");
    const reasonInput = body.findAll(".q-field").find((f) => f.text().includes("修改原因")).find("textarea");
    await reasonInput.setValue("特批改 code 原因");
    const passwordInput = body.findAll(".q-field").find((f) => f.text().includes("密碼確認")).find("input");
    await passwordInput.setValue("hunter2");

    await body.findAll(".q-btn").find((btn) => btn.text() === "確認修改").trigger("click");
    await flushPromises();

    expect(itemService.changeSkuCode).toHaveBeenCalledWith(10, {
      skuCode: "VITC-90-NEW",
      reason: "特批改 code 原因",
      version: 1,
      password: "hunter2"
    });
    expect(body.text()).toContain("VITC-90-NEW");
  });

  it("條碼釋放：睇緊模式先顯示「釋放」掣，撳咗要求密碼確認先叫 releaseBarcode", async () => {
    promptPassword.mockResolvedValue({ reason: "釋放測試", password: "hunter2" });
    itemService.releaseBarcode.mockResolvedValue({ ...SKU, barcodes: [] });
    const { body } = await mountPage();

    const releaseBtn = body.findAll(".q-btn").find((btn) => btn.attributes("aria-label")?.includes("釋放條碼"));
    expect(releaseBtn).toBeTruthy();
    await releaseBtn.trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemService.releaseBarcode).toHaveBeenCalledWith(10, 301, {
      reason: "釋放測試",
      password: "hunter2",
      version: 1
    });
  });

  it("編輯模式：條碼列表冇「釋放」掣（釋放同編輯係兩個獨立流程）", async () => {
    const { body } = await mountPage();
    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    expect(body.findAll(".q-btn").some((btn) => btn.attributes("aria-label")?.includes("釋放條碼"))).toBe(false);
  });
});
