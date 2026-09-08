import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: { createItem: vi.fn() },
  service: { name: "item" }
}));
vi.mock("@/services/itemCatalog.js", () => ({
  default: {
    categoryTree: vi.fn(),
    brandList: vi.fn(),
    uomList: vi.fn(),
    attributeList: vi.fn()
  },
  service: { name: "itemCatalog" }
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemService from "@/services/item.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import ItemCreatePage, { page } from "@/pages/items/ItemCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

const CATEGORY_TREE = [{ id: 1, name: "Vitamins", status: "active", children: [] }];
const BRANDS = { rows: [{ id: 9, name: "Brand A" }], rowsNumber: 1 };
const UOMS = [{ id: 5, code: "EA", name: "Each", status: "active" }];

// `onBeforeRouteLeave` 靠 inject 一個由 <router-view> 提供嘅 matched-route
// key 先揾到自己個 guard 要掛喺邊——直接 mount(ItemCreatePage) 唔經
// <router-view>，呢個 inject 會攞唔到嘢，guard 靜靜哋冇註冊到。要測 leave
// guard 就一定要用一個帶 <router-view> 嘅殼，等 ItemCreatePage 係真正
// 由路由解析出嚟先掛得上。
const RouterViewHost = { render: () => h(RouterView) };

async function mountPage({ initialRoute = "/items/new" } = {}) {
  itemCatalogService.categoryTree.mockResolvedValue(CATEGORY_TREE);
  itemCatalogService.brandList.mockResolvedValue(BRANDS);
  itemCatalogService.uomList.mockResolvedValue(UOMS);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, name: page.name, component: ItemCreatePage },
      { path: "/items", name: "items", component: { template: "<div>items list</div>" } }
    ]
  });
  await router.push(initialRoute);
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions: ["item.view", "item.mgmt"], roles: [] };

  const wrapper = mount(RouterViewHost, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router, body: new DOMWrapper(document.body) };
}

function fieldInput(body, label) {
  return body.findAll(".q-field").find((f) => f.text().includes(label)).find("input, textarea");
}

describe("pages/items/ItemCreatePage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("撳「儲存草稿」：帶 activate:false，最少要 item.name／skuCode／skuName", async () => {
    itemService.createItem.mockResolvedValue({ id: 42, name: "維他命 C" });
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");

    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    expect(itemService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        activate: false,
        item: expect.objectContaining({ name: "維他命 C", productType: "standard" }),
        sku: expect.objectContaining({ skuCode: "VITC-90", skuName: "維他命 C 90 粒裝" })
      })
    );
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("草稿"));
  });

  it("撳「儲存並啟用」但冇填啟用原因：唔會叫 API，摘要顯示要求", async () => {
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");

    await wrapper.find('button[aria-label="儲存並啟用"]').trigger("click");
    await flushPromises();

    expect(itemService.createItem).not.toHaveBeenCalled();
    expect(body.text()).toContain("直接啟用時必須填寫啟用原因");
  });

  it("撳「儲存並啟用」連同啟用原因：帶 activate:true 同 activationReason", async () => {
    itemService.createItem.mockResolvedValue({ id: 42, name: "維他命 C" });
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");
    await fieldInput(body, "啟用原因").setValue("完成初次建檔並上架");

    await wrapper.find('button[aria-label="儲存並啟用"]').trigger("click");
    await flushPromises();

    expect(itemService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ activate: true, activationReason: "完成初次建檔並上架" })
    );
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("啟用"));
  });

  it("成功之後導返 /items", async () => {
    itemService.createItem.mockResolvedValue({ id: 42, name: "維他命 C" });
    const { wrapper, body, router } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");
    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/items");
  });

  it("後端回 request schema 錯誤（陣列形狀）：對應返欄位顯示，唔淨係彈 toast", async () => {
    const error = Object.assign(new Error("Invalid request body"), {
      details: [{ location: "body", path: "/item/name", keyword: "minLength", message: "商品名稱不可空白" }]
    });
    itemService.createItem.mockRejectedValue(error);
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");
    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    expect(body.text()).toContain("商品名稱不可空白");
    expect(notifyError).toHaveBeenCalled();
  });

  it("後端回 ITEM_NOT_ACTIVATABLE（issues 形狀）：對應唔到已知欄位嘅 issue 出現喺摘要", async () => {
    const error = Object.assign(new Error("資料尚未符合啟用條件"), {
      code: "ITEM_NOT_ACTIVATABLE",
      details: { issues: [{ field: "uoms", code: "BASE_UOM_REQUIRED", message: "必須恰好指定一個 Base 單位" }] }
    });
    itemService.createItem.mockRejectedValue(error);
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");
    await fieldInput(body, "啟用原因").setValue("完成初次建檔並上架");
    await wrapper.find('button[aria-label="儲存並啟用"]').trigger("click");
    await flushPromises();

    expect(body.text()).toContain("必須恰好指定一個 Base 單位");
  });

  it("提交失敗之後，錯誤摘要拎到 focus（screen reader 使用者即時知道錯咗）", async () => {
    const error = Object.assign(new Error("失敗"), {
      details: [{ location: "body", path: "/item/name", keyword: "minLength", message: "商品名稱不可空白" }]
    });
    itemService.createItem.mockRejectedValue(error);
    const { wrapper, body } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await fieldInput(body, "SKU Code *").setValue("VITC-90");
    await fieldInput(body, "SKU 名稱 *").setValue("維他命 C 90 粒裝");
    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    const summary = body.find('[role="alert"]');
    expect(summary.exists()).toBe(true);
    expect(document.activeElement).toBe(summary.element);
  });

  it("表單有改動（dirty）就離開頁面：跳去 window.confirm 確認", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { body, router } = await mountPage();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");
    await router.push("/items");
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("未儲存"));
    confirmSpy.mockRestore();
  });

  it("表單冇改動就離開：唔會彈 window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { router } = await mountPage();

    await router.push("/items");
    await flushPromises();

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("切去 Variant：揀屬性同選項、產生組合、提交時帶 skus[] 而唔係單一 sku", async () => {
    itemCatalogService.attributeList.mockResolvedValue({
      rows: [
        {
          id: 7,
          code: "COLOR",
          name: "顏色",
          dataType: "single_option",
          isVariant: true,
          status: "active",
          options: [
            { id: 70, value: "red", label: "紅", status: "active" },
            { id: 71, value: "blue", label: "藍", status: "active" }
          ]
        }
      ],
      rowsNumber: 1
    });
    itemService.createItem.mockResolvedValue({ id: 42, name: "維他命 C" });
    const { wrapper, body } = await mountPage();

    await wrapper.findAll(".q-btn-toggle .q-btn").find((btn) => btn.text().includes("多規格")).trigger("click");
    await flushPromises();

    await fieldInput(body, "商品名稱 *").setValue("維他命 C");

    const colorCheckbox = body.findAll(".q-checkbox").find((el) => el.text().includes("顏色"));
    await colorCheckbox.trigger("click");
    await flushPromises();

    const redCheckbox = body.findAll(".q-checkbox").find((el) => el.text().trim() === "紅");
    const blueCheckbox = body.findAll(".q-checkbox").find((el) => el.text().trim() === "藍");
    await redCheckbox.trigger("click");
    await blueCheckbox.trigger("click");
    await flushPromises();

    await body.findAll(".q-btn").find((btn) => btn.text().includes("產生組合")).trigger("click");
    await flushPromises();

    expect(body.text()).toContain("顏色：紅");
    expect(body.text()).toContain("顏色：藍");

    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    expect(itemService.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ productType: "variant" }),
        skus: expect.arrayContaining([
          expect.objectContaining({ skuCode: "RED", skuName: "紅", variantValues: [{ attributeId: 7, optionId: 70 }] }),
          expect.objectContaining({ skuCode: "BLUE", skuName: "藍", variantValues: [{ attributeId: 7, optionId: 71 }] })
        ])
      })
    );
    expect(itemService.createItem.mock.calls[0][0].sku).toBeUndefined();
  });

  it("Variant 模式冇產生任何組合就提交：唔會叫 API，摘要顯示要求", async () => {
    itemCatalogService.attributeList.mockResolvedValue({ rows: [], rowsNumber: 0 });
    const { wrapper, body } = await mountPage();

    await wrapper.findAll(".q-btn-toggle .q-btn").find((btn) => btn.text().includes("多規格")).trigger("click");
    await flushPromises();
    await fieldInput(body, "商品名稱 *").setValue("維他命 C");

    await wrapper.find('button[aria-label="儲存草稿"]').trigger("click");
    await flushPromises();

    expect(itemService.createItem).not.toHaveBeenCalled();
    expect(body.text()).toContain("多規格商品最少要產生一個規格組合");
  });
});
