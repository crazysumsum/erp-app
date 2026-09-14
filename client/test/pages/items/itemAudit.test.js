import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/itemAudit.js", () => ({
  default: { list: vi.fn() },
  service: { name: "itemAudit" }
}));

import itemAuditService from "@/services/itemAudit.js";
import ItemAuditPage from "@/pages/items/ItemAuditPage.vue";

const ROWS = [
  {
    id: 1,
    occurredAt: 1_735_689_600_000,
    actorUserId: 1,
    actorUsername: "sam",
    action: "sku.update",
    targetType: "sku",
    targetId: 7,
    targetLabel: "SKU-BLUE",
    reason: "更正名稱",
    detail: { skuName: { before: "藍色", after: "海軍藍" } }
  }
];

async function mountItemAuditPage() {
  itemAuditService.list.mockResolvedValue({ rows: ROWS, rowsNumber: ROWS.length });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "itemAudit", component: ItemAuditPage, meta: { title: "商品變更紀錄", menuGroup: "items" } }]
  });
  await router.push("/");
  await router.isReady();

  const wrapper = mount(ItemAuditPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("pages/items/ItemAuditPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("初次載入 Item audit，並顯示完整對象、原因與前後變更", async () => {
    const { wrapper } = await mountItemAuditPage();

    expect(itemAuditService.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, actor: "", target: "", action: null, targetType: null })
    );
    expect(wrapper.text()).toContain("sku/SKU-BLUE");
    expect(wrapper.text()).toContain("更正名稱");
    expect(wrapper.text()).toContain("skuName：藍色 → 海軍藍");
  });

  it("設定日期範圍時以當日首尾 epoch 重新查詢", async () => {
    const { body } = await mountItemAuditPage();
    itemAuditService.list.mockClear();

    const fromInput = body.findAll(".q-field").find((field) => field.text().includes("從")).find("input");
    await fromInput.setValue("2025-01-01");
    await flushPromises();

    expect(itemAuditService.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: new Date("2025-01-01T00:00:00").getTime() })
    );
  });

  it("選擇對象類型時把篩選帶到 API", async () => {
    const { wrapper } = await mountItemAuditPage();
    itemAuditService.list.mockClear();

    const targetTypeSelect = wrapper.findAllComponents({ name: "QSelect" })[1];
    targetTypeSelect.vm.$emit("update:modelValue", "sku");
    await flushPromises();

    expect(itemAuditService.list).toHaveBeenCalledWith(expect.objectContaining({ targetType: "sku" }));
  });

  it("陣列前後值會完整列出新增與移除項目", async () => {
    const { wrapper } = await mountItemAuditPage();
    await wrapper.vm.$nextTick();

    itemAuditService.list.mockResolvedValueOnce({
      rows: [{ ...ROWS[0], detail: { barcodes: { before: ["OLD"], after: ["NEW"] } } }],
      rowsNumber: 1
    });
    const table = wrapper.findComponent({ name: "DataTable" });
    await table.vm.reload();
    await flushPromises();

    expect(wrapper.text()).toContain("+NEW");
    expect(wrapper.text()).toContain("−OLD");
  });

  it("分類屬性指派按 added、removed、updated 語意顯示完整變更", async () => {
    const { wrapper } = await mountItemAuditPage();
    itemAuditService.list.mockResolvedValueOnce({
      rows: [
        {
          ...ROWS[0],
          action: "category.attributes.assign",
          detail: {
            added: [{ attributeId: 2, requiredForActivation: false, sortOrder: 1 }],
            removed: [{ attributeId: 3, requiredForActivation: true, sortOrder: 0 }],
            updated: [
              {
                before: { attributeId: 1, requiredForActivation: false, sortOrder: 0 },
                after: { attributeId: 1, requiredForActivation: true, sortOrder: 2 }
              }
            ]
          }
        }
      ],
      rowsNumber: 1
    });
    const table = wrapper.findComponent({ name: "DataTable" });
    await table.vm.reload();
    await flushPromises();

    expect(wrapper.text()).toContain("+屬性 #2（必填：否，排序：1）");
    expect(wrapper.text()).toContain("−屬性 #3（必填：是，排序：0）");
    expect(wrapper.text()).toContain("屬性 #1：必填：否 → 是；排序：0 → 2");
  });

  it("舊版分類屬性 audit payload 的 ID 陣列不會令頁面失敗", async () => {
    const { wrapper } = await mountItemAuditPage();
    itemAuditService.list.mockResolvedValueOnce({
      rows: [{ ...ROWS[0], action: "category.attributes.assign", detail: { added: [2], removed: [3], updated: [1] } }],
      rowsNumber: 1
    });
    const table = wrapper.findComponent({ name: "DataTable" });
    await table.vm.reload();
    await flushPromises();

    expect(wrapper.text()).toContain("+屬性 #2");
    expect(wrapper.text()).toContain("−屬性 #3");
    expect(wrapper.text()).toContain("屬性 #1 已更新；舊紀錄未保存欄位差異");
  });
});
