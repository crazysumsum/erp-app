import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: { getItem: vi.fn(), updateItem: vi.fn() },
  service: { name: "item" }
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemService from "@/services/item.js";
import { notifySuccess } from "@/framework/ui/notify.js";
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
      { path: "/items/:itemId/skus/:skuId", name: "skuDetail", component: { template: "<div>sku detail</div>" } }
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

  it("VERSION_CONFLICT：唔會自動覆蓋用戶輸入，顯示提示，撳「重新載入」先攞新資料", async () => {
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
});
