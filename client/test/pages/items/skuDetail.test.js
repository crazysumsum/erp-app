import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: { getSku: vi.fn(), updateSku: vi.fn() },
  service: { name: "item" }
}));
vi.mock("@/services/itemCatalog.js", () => ({
  default: { uomList: vi.fn() },
  service: { name: "itemCatalog" }
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemService from "@/services/item.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { notifySuccess } from "@/framework/ui/notify.js";
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
  barcodes: [{ id: 301, skuUomId: 201, barcode: "4710088412345", normalizedBarcode: "4710088412345", barcodeType: "ean13", isPrimary: true }],
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
});
