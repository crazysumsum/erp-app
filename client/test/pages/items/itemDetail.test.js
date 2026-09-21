import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: {
    getItem: vi.fn(),
    updateItem: vi.fn(),
    activateItem: vi.fn(),
    deactivateItem: vi.fn(),
    discontinueItem: vi.fn(),
    archiveItem: vi.fn(),
    restoreItem: vi.fn(),
    activateSku: vi.fn(),
    deactivateSku: vi.fn(),
    discontinueSku: vi.fn(),
    archiveSku: vi.fn(),
    restoreSku: vi.fn(),
    deleteItem: vi.fn(),
    copyItem: vi.fn()
  },
  service: { name: "item" }
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
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import ItemDetailPage, { page } from "@/pages/items/ItemDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ITEM = {
  id: 1,
  name: "維他命 C 1000mg",
  shortName: "",
  description: null,
  categoryId: null,
  categoryName: null,
  brandId: null,
  brandName: null,
  productType: "standard",
  countryOfOrigin: null,
  manufacturer: "",
  defaultTrackingPolicy: "none",
  defaultShelfLifeDays: null,
  status: "active",
  attributeValues: [],
  skus: [{ id: 10, skuCode: "VITC-90", skuName: "維他命 C 90 粒裝", status: "active", suggestedRetailPrice: null, version: 1 }],
  media: [],
  version: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000
};

const RouterViewHost = { render: () => h(RouterView) };

async function mountPage({ permissions = ["item.view", "item.mgmt"], item = ITEM } = {}) {
  itemService.getItem.mockResolvedValue(item);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, name: page.name, component: ItemDetailPage },
      { path: "/items/:itemId/skus/new", name: "skuCreate", component: { template: "<div>sku create</div>" } },
      { path: "/items/:itemId/skus/:skuId", name: "skuDetail", component: { template: "<div>sku detail</div>" } },
      { path: "/items", name: "items", component: { template: "<div>items list</div>" } }
    ]
  });
  await router.push("/items/1");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam", permissions, roles: [] };

  const wrapper = mount(RouterViewHost, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/items/ItemDetailPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("item.view-only：睇得到詳情，但冇「編輯」按鈕", async () => {
    const { body } = await mountPage({ permissions: ["item.view"] });

    expect(body.text()).toContain("維他命 C 1000mg");
    expect(body.findAll(".q-btn").some((btn) => btn.text() === "編輯")).toBe(false);
  });

  it("顯示已保存的商品屬性值", async () => {
    const { body } = await mountPage({
      item: {
        ...ITEM,
        attributeValues: [
          {
            attributeId: 101,
            code: "MATERIAL",
            name: "材質",
            dataType: "single_option",
            value: "cotton",
            option: { id: 301, value: "cotton", label: "棉" }
          }
        ]
      }
    });

    const attributes = body.find('[data-testid="attribute-value-list"]');
    expect(attributes.text()).toContain("商品屬性");
    expect(attributes.text()).toContain("材質");
    expect(attributes.text()).toContain("棉");
  });

  it("item.mgmt：撳「編輯」先可以改欄位；儲存成功帶返 version", async () => {
    itemService.updateItem.mockResolvedValue({ ...ITEM, name: "改咗個名", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    const nameInput = body.findAll(".q-field").find((f) => f.text().includes("商品名稱")).find("input");
    await nameInput.setValue("改咗個名");
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(itemService.updateItem).toHaveBeenCalledWith(1, expect.objectContaining({ name: "改咗個名", version: 1 }));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("改咗個名"));
    expect(body.text()).toContain("版本 2");
  });

  it("TC-011 VERSION_CONFLICT：唔會自動覆蓋用戶輸入，顯示提示，撳「重新載入」先攞新資料", async () => {
    const conflict = Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" });
    itemService.updateItem.mockRejectedValue(conflict);
    itemService.getItem.mockResolvedValueOnce(ITEM).mockResolvedValueOnce({ ...ITEM, name: "被人改咗", version: 5 });

    const { body } = await mountPage();
    await body.findAll(".q-btn").find((btn) => btn.text() === "編輯").trigger("click");
    await flushPromises();

    const nameInput = body.findAll(".q-field").find((f) => f.text().includes("商品名稱")).find("input");
    await nameInput.setValue("我自己打緊嘅名");
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(body.text()).toContain("已經被人改過");
    // 用戶自己打緊嘅輸入應該仲喺個 input 度，未俾「被人改咗」蓋咗。
    expect(nameInput.element.value).toBe("我自己打緊嘅名");

    await body.findAll(".q-btn").find((btn) => btn.text().includes("重新載入")).trigger("click");
    await flushPromises();
    expect(nameInput.element.value).toBe("被人改咗");
  });

  it("撳 SKU 列表其中一行會導去 SkuDetailPage", async () => {
    const { body, router } = await mountPage();

    await body.findAll(".q-item").find((el) => el.text().includes("VITC-90")).trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/items/1/skus/10");
  });

  it("Variant Item 的 manager 可以進入新增 SKU 流程；Standard 與 view-only 不顯示", async () => {
    const variant = await mountPage({ item: { ...ITEM, productType: "variant" } });
    const addButton = variant.body.findAll(".q-btn").find((btn) => btn.text() === "新增 SKU");
    expect(addButton.exists()).toBe(true);
    await addButton.trigger("click");
    await flushPromises();
    expect(variant.router.currentRoute.value.path).toBe("/items/1/skus/new");

    document.body.innerHTML = "";
    const standard = await mountPage();
    expect(standard.body.findAll(".q-btn").some((btn) => btn.text() === "新增 SKU")).toBe(false);

    document.body.innerHTML = "";
    const viewOnly = await mountPage({ permissions: ["item.view"], item: { ...ITEM, productType: "variant" } });
    expect(viewOnly.body.findAll(".q-btn").some((btn) => btn.text() === "新增 SKU")).toBe(false);
  });

  it("Active Item：顯示「停用」，唔顯示「啟用」／「封存」／「從封存恢復」", async () => {
    const { body } = await mountPage();

    const labels = body.findAll(".q-btn").map((btn) => btn.text());
    expect(labels).toContain("停用");
    expect(labels).not.toContain("啟用");
    expect(labels).not.toContain("封存");
    expect(labels).not.toContain("從封存恢復");
  });

  it("停用商品：promptReason 文案帶啟用中 SKU 數，成功後徽章更新", async () => {
    promptReason.mockResolvedValue("暫停銷售");
    itemService.deactivateItem.mockResolvedValue({ ...ITEM, status: "inactive", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停用").trigger("click");
    await flushPromises();

    expect(promptReason).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("1 個啟用中") }));
    expect(itemService.deactivateItem).toHaveBeenCalledWith(1, { reason: "暫停銷售", version: 1 });
    expect(body.text()).toContain("版本 2");
  });

  it("Draft Item：顯示「啟用」，撳咗開 dialog，預先勾晒所有可啟用 SKU", async () => {
    const draftItem = {
      ...ITEM,
      status: "draft",
      skus: [{ id: 10, skuCode: "VITC-90", skuName: "維他命 C 90 粒裝", status: "draft", suggestedRetailPrice: null, version: 1 }]
    };
    itemService.activateItem.mockResolvedValue({ ...draftItem, status: "active", version: 2 });
    const { body } = await mountPage({ item: draftItem });

    expect(body.findAll(".q-btn").some((btn) => btn.text() === "啟用")).toBe(true);
    await body.findAll(".q-btn").find((btn) => btn.text() === "啟用").trigger("click");
    await flushPromises();

    const checkbox = body.findAll(".q-checkbox");
    expect(checkbox).toHaveLength(1);
    expect(checkbox[0].attributes("aria-checked")).toBe("true");

    const reasonInput = body.findAll(".q-field").find((f) => f.text().includes("啟用原因")).find("textarea");
    await reasonInput.setValue("首次上架啟用");

    const activateButtons = body.findAll(".q-btn").filter((btn) => btn.text() === "啟用");
    await activateButtons[activateButtons.length - 1].trigger("click");
    await flushPromises();

    expect(itemService.activateItem).toHaveBeenCalledWith(1, { skuIds: [10], reason: "首次上架啟用", version: 1 });
  });

  it("停產商品：用 promptPassword({ requireReason: true })", async () => {
    promptPassword.mockResolvedValue({ reason: "業務決定停產", password: "hunter2" });
    itemService.discontinueItem.mockResolvedValue({ ...ITEM, status: "discontinued", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停產").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemService.discontinueItem).toHaveBeenCalledWith(1, {
      reason: "業務決定停產",
      password: "hunter2",
      version: 1
    });
    expect(body.text()).toContain("已停產");
  });

  it("封存、恢復：完整走一次", async () => {
    promptPassword
      .mockResolvedValueOnce({ reason: "封存", password: "hunter2" })
      .mockResolvedValueOnce({ reason: "恢復", password: "hunter2" });
    itemService.archiveItem.mockResolvedValue({ ...ITEM, status: "archived", version: 2 });
    itemService.restoreItem.mockResolvedValue({ ...ITEM, status: "inactive", version: 3 });
    const { body } = await mountPage({ item: { ...ITEM, status: "inactive" } });

    await body.findAll(".q-btn").find((btn) => btn.text() === "封存").trigger("click");
    await flushPromises();
    expect(itemService.archiveItem).toHaveBeenCalledWith(1, { reason: "封存", password: "hunter2", version: 1 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("已封存"));

    await body.findAll(".q-btn").find((btn) => btn.text() === "從封存恢復").trigger("click");
    await flushPromises();
    expect(itemService.restoreItem).toHaveBeenCalledWith(1, { reason: "恢復", password: "hunter2", version: 2 });
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("已從封存恢復"));
  });

  it("生命週期動作撞 VERSION_CONFLICT：重新載入最新資料", async () => {
    promptReason.mockResolvedValue("暫停銷售");
    const conflict = Object.assign(new Error("版本衝突"), { code: "VERSION_CONFLICT" });
    itemService.deactivateItem.mockRejectedValue(conflict);
    itemService.getItem.mockResolvedValueOnce(ITEM).mockResolvedValueOnce({ ...ITEM, version: 9 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "停用").trigger("click");
    await flushPromises();

    expect(itemService.getItem).toHaveBeenCalledTimes(2);
    expect(notifyError).toHaveBeenCalled();
    expect(body.text()).toContain("版本 9");
  });

  it("SKU 列表 row menu：Active SKU 顯示「停用」，撳咗叫 activateSku／deactivateSku", async () => {
    promptReason.mockResolvedValue("暫停銷售");
    itemService.deactivateSku.mockResolvedValue({ ...ITEM.skus[0], status: "inactive", version: 2 });
    const { body } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.attributes("aria-label")?.includes("VITC-90")).trigger("click");
    await flushPromises();

    await body.findAll(".q-item__section").find((el) => el.text() === "停用")?.trigger("click");
    await flushPromises();

    expect(itemService.deactivateSku).toHaveBeenCalledWith(10, { reason: "暫停銷售", version: 1 });
  });

  it("Draft Item：顯示「刪除」；Active Item：唔顯示", async () => {
    const draft = await mountPage({ item: { ...ITEM, status: "draft" } });
    expect(draft.body.findAll(".q-btn").some((btn) => btn.text() === "刪除")).toBe(true);

    document.body.innerHTML = "";
    const active = await mountPage({ item: ITEM });
    expect(active.body.findAll(".q-btn").some((btn) => btn.text() === "刪除")).toBe(false);
  });

  it("刪除商品：promptPassword({ requireReason: true })，成功後導去 /items", async () => {
    promptPassword.mockResolvedValue({ reason: "測試刪除", password: "hunter2" });
    itemService.deleteItem.mockResolvedValue({ id: 1 });
    const { body, router } = await mountPage({ item: { ...ITEM, status: "draft" } });

    await body.findAll(".q-btn").find((btn) => btn.text() === "刪除").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemService.deleteItem).toHaveBeenCalledWith(1, { reason: "測試刪除", password: "hunter2", version: 1 });
    expect(router.currentRoute.value.path).toBe("/items");
  });

  it("複製商品：撳「複製」開 dialog，每個 SKU 一個新 Code 輸入，成功後導去新商品", async () => {
    itemService.copyItem.mockResolvedValue({ id: 99, name: "維他命 C 1000mg" });
    const { body, router } = await mountPage();

    await body.findAll(".q-btn").find((btn) => btn.text() === "複製").trigger("click");
    await flushPromises();

    const codeInput = body.findAll(".q-field").find((f) => f.text().includes("VITC-90 的新 Code")).find("input");
    await codeInput.setValue("VITC-90-COPY");

    const confirmButtons = body.findAll(".q-btn").filter((btn) => btn.text() === "複製");
    await confirmButtons[confirmButtons.length - 1].trigger("click");
    await flushPromises();

    expect(itemService.copyItem).toHaveBeenCalledWith(1, { skus: [{ sourceSkuId: 10, skuCode: "VITC-90-COPY" }] });
    expect(router.currentRoute.value.path).toBe("/items/99");
  });
});
