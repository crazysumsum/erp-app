import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";

vi.mock("@/services/item.js", () => ({
  default: { getItem: vi.fn(), createSku: vi.fn() },
  service: { name: "item" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import itemService from "@/services/item.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import SkuCreatePage, { page } from "@/pages/items/SkuCreatePage.vue";

const VARIANT_ITEM = { id: 1, name: "T-shirt", productType: "variant" };
const RouterViewHost = { render: () => h(RouterView) };

async function mountPage(item = VARIANT_ITEM) {
  itemService.getItem.mockResolvedValue(item);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, name: page.name, component: SkuCreatePage },
      { path: "/items/:itemId/skus/:skuId", name: "skuDetail", component: { template: "<div>sku detail</div>" } },
      { path: "/items/:itemId", name: "itemDetail", component: { template: "<div>item detail</div>" } }
    ]
  });
  await router.push("/items/1/skus/new");
  await router.isReady();

  const wrapper = mount(RouterViewHost, {
    attachTo: document.body,
    global: {
      plugins: [Quasar, router],
      stubs: {
        SkuEditor: {
          template: '<button data-testid="set-sku" @click="$emit(\'update:modelValue\', { ...modelValue, uoms: [{ uomId: 5, toBaseFactor: 1, isBase: true, isDefaultPurchase: false, isDefaultSale: true }] })">set sku</button>',
          props: ["modelValue"]
        },
        VariantMatrixEditor: {
          template: '<button data-testid="set-variant" @click="$emit(\'update:modelValue\', [{ skuCode: \'BLUE\', skuName: \'藍色\', variantValues: [{ attributeId: 7, optionId: 71 }] }])">set variant</button>'
        }
      }
    }
  });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/items/SkuCreatePage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("建立一個 Variant SKU 後前往新 SKU 詳情", async () => {
    itemService.createSku.mockResolvedValue({ id: 15, skuCode: "BLUE" });
    const { body, router } = await mountPage();

    await body.find('[data-testid="set-sku"]').trigger("click");
    await body.find('[data-testid="set-variant"]').trigger("click");
    await body.findAll(".q-btn").find((button) => button.text() === "新增 SKU").trigger("click");
    await flushPromises();

    expect(itemService.createSku).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 1,
        skuCode: "BLUE",
        skuName: "藍色",
        uoms: [{ uomId: 5, toBaseFactor: 1, isBase: true, isDefaultPurchase: false, isDefaultSale: true }],
        variantValues: [{ attributeId: 7, optionId: 71 }]
      })
    );
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining("BLUE"));
    expect(router.currentRoute.value.path).toBe("/items/1/skus/15");
  });

  it("Standard Item 不顯示提交表單", async () => {
    const { body } = await mountPage({ ...VARIANT_ITEM, productType: "standard" });

    expect(body.text()).toContain("只有多規格商品可以新增 SKU");
    expect(body.findAll(".q-btn").some((button) => button.text() === "新增 SKU")).toBe(false);
  });
});
