import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/item.js", () => ({
  default: {
    listItems: vi.fn(),
    getItem: vi.fn(),
    listSkus: vi.fn(),
    getSku: vi.fn()
  },
  service: { name: "item" }
}));

import itemService from "@/services/item.js";
import ItemsPage, { page } from "@/pages/items/ItemsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ITEM_ROWS = [
  {
    id: 1,
    name: "Vitamin C 1000mg",
    categoryName: "Vitamins",
    brandName: "Brand A",
    productType: "standard",
    skuCount: 2,
    status: "active",
    updatedAt: 1700000000000
  }
];

const SKU_ROWS = [
  {
    id: 10,
    skuCode: "VITC-90",
    skuName: "Vitamin C 1000mg 90s",
    itemName: "Vitamin C 1000mg",
    primaryBarcode: "4710088412345",
    baseUomCode: "EA",
    suggestedRetailPrice: { amount: "199.00", currency: "HKD", taxBasis: "exclusive" },
    status: "active",
    updatedAt: 1700000000000
  }
];

async function mountItemsPage({
  permissions = ["item.view", "item.mgmt"],
  initialRoute = "/items",
  itemRows = ITEM_ROWS,
  skuRows = SKU_ROWS,
  itemRowsNumber = itemRows.length,
  skuRowsNumber = skuRows.length
} = {}) {
  itemService.listItems.mockResolvedValue({ rows: itemRows, rowsNumber: itemRowsNumber });
  itemService.listSkus.mockResolvedValue({ rows: skuRows, rowsNumber: skuRowsNumber });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: page.path, name: page.name, component: ItemsPage }]
  });
  await router.push(initialRoute);
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

  const wrapper = mount(ItemsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/items/ItemsPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("預設顯示 SKU 平鋪視圖，開機以分頁 fetch 載入", async () => {
    const { wrapper } = await mountItemsPage();

    expect(itemService.listSkus).toHaveBeenCalled();
    expect(itemService.listItems).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("VITC-90");
    expect(wrapper.text()).toContain("Vitamin C 1000mg 90s");
  });

  it("撳「商品」切換做 Item 視圖，改用 listItems 載入", async () => {
    const { wrapper } = await mountItemsPage();

    await wrapper.findAll(".q-btn-toggle .q-btn").find((btn) => btn.text() === "商品").trigger("click");
    await flushPromises();

    expect(itemService.listItems).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Vitamin C 1000mg");
    expect(wrapper.text()).not.toContain("VITC-90");
  });

  it("Archived 預設隱藏（status 冇傳），明確揀 status=archived 先睇得到", async () => {
    const { body } = await mountItemsPage();

    expect(itemService.listSkus).toHaveBeenCalledWith(expect.objectContaining({ status: null }));

    itemService.listSkus.mockClear();
    itemService.listSkus.mockResolvedValue({
      rows: [{ ...SKU_ROWS[0], status: "archived" }],
      rowsNumber: 1
    });

    const select = body.findAll(".q-field").find((f) => f.text().includes("狀態"));
    await select.find(".q-field__native, input").trigger("click");
    await flushPromises();
    const option = body.findAll(".q-item__label").find((el) => el.text() === "已封存");
    await option.trigger("click");
    await flushPromises();

    expect(itemService.listSkus).toHaveBeenLastCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("搜尋輸入 300ms debounce 之後先觸發重新查詢", async () => {
    const { body } = await mountItemsPage();
    itemService.listSkus.mockClear();

    // 淨用 `input` 事件（唔用 VTU 嘅 setValue()：嗰個會連 `change` 事件一齊
    // 發，Quasar 嘅 QInput 見到 `change` 會即刻 flush 咗個 debounce timer，
    // 令呢個測試完全測唔到 debounce 本身）。
    const searchInput = body.findAll(".q-field input").find((el) => el.attributes("type") !== "hidden");
    searchInput.element.value = "VITC";
    await searchInput.trigger("input");

    expect(itemService.listSkus).not.toHaveBeenCalled();
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
    await flushPromises();

    expect(itemService.listSkus).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "VITC" }));
  });

  it("只有 item.view：睇得到列表，但冇「新增商品」按鈕", async () => {
    const { wrapper } = await mountItemsPage({ permissions: ["item.view"] });

    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("新增商品"))).toBe(false);
  });

  it("有 item.mgmt：顯示「新增商品」按鈕", async () => {
    const { wrapper } = await mountItemsPage();

    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("新增商品"))).toBe(true);
  });

  it("page／sort／view／q／status 可從 URL 還原", async () => {
    const { router } = await mountItemsPage({
      initialRoute: "/items?view=item&page=2&sortBy=name&descending=true&q=vitamin&status=inactive"
    });

    expect(itemService.listItems).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        sortBy: "name",
        descending: true,
        filter: "vitamin",
        status: "inactive"
      })
    );
    expect(router.currentRoute.value.query.view).toBe("item");
  });

  it("揭頁之後 URL query 會反映最新嘅 page／view", async () => {
    const { body, router } = await mountItemsPage({ skuRowsNumber: 45 });

    await body.find('button[aria-label="Next page"]').trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.query.page).toBe("2");
    expect(router.currentRoute.value.query.view).toBe("sku");
  });
});
