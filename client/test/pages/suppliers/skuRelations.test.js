import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { listSkuRelations: vi.fn(), createSkuRelation: vi.fn(), updateSkuRelation: vi.fn(), searchPurchasableSkus: vi.fn() },
  service: { name: "supplier" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import supplierService from "@/services/supplier.js";
import SupplierSkuRelationsPanel from "@/components/suppliers/SupplierSkuRelationsPanel.vue";

const ROW = { id: 91, supplierId: 7, skuId: 52, skuCode: "TEA-002", skuName: "Oolong", skuStatus: "active", itemStatus: "active",
  supplierItemCode: "OO-9", supplierItemName: "Oolong", purchaseSkuUomId: 511, purchaseUomCode: "EA", purchaseUomName: "Each",
  purchaseUomStatus: "active", minimumOrderQty: 12, standardLeadTimeDays: 7, relationshipStatus: "alternative", firstSuppliedAt: null,
  lastSuppliedAt: null, source: "manual", version: 3, updatedAt: 300 };

function mountPanel(props = {}) {
  const wrapper = mount(SupplierSkuRelationsPanel, {
    props: { supplierId: 7, supplierCode: "SUP-007", supplierStatus: "active", canManage: true, ...props },
    global: { plugins: [Quasar] }, attachTo: document.body
  });
  return { wrapper, body: new DOMWrapper(document.body) };
}

const button = (body, text) => body.findAll(".q-btn").find((candidate) => candidate.text().includes(text));
const field = (body, label) => body.findAll(".q-field").find((candidate) => candidate.text().includes(label));

describe("SupplierSkuRelationsPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    supplierService.listSkuRelations.mockResolvedValue({ rows: [ROW], rowsNumber: 1 });
  });

  it("loads relations for this Supplier and offers writes only to a manager of a non-archived Supplier", async () => {
    let { wrapper, body } = mountPanel();
    await flushPromises();
    expect(supplierService.listSkuRelations).toHaveBeenCalledWith(7, expect.objectContaining({ page: 1, rowsPerPage: 20 }));
    expect(body.text()).toContain("TEA-002");
    expect(button(body, "新增供貨關係")).toBeTruthy();
    for (const props of [{ canManage: false }, { supplierStatus: "archived" }]) {
      wrapper.unmount();
      document.body.innerHTML = "";
      ({ wrapper, body } = mountPanel(props));
      await flushPromises();
      expect(button(body, "新增供貨關係")).toBeUndefined();
      expect(body.find('[aria-label="編輯供貨關係 TEA-002"]').exists()).toBe(false);
    }
  });

  it("sends cleared number fields as null and the version on update, then reloads the table", async () => {
    supplierService.searchPurchasableSkus.mockResolvedValue({ items: [] });
    supplierService.updateSkuRelation.mockResolvedValue({ ...ROW, version: 4 });
    const { body } = mountPanel();
    await flushPromises();
    await body.find('[aria-label="編輯供貨關係 TEA-002"]').trigger("click");
    await flushPromises();
    await field(body, "最低訂購量").find("input").setValue("");
    await field(body, "一般交貨期").find("input").setValue("");
    await button(body, "儲存").trigger("click");
    await flushPromises();
    expect(supplierService.updateSkuRelation).toHaveBeenCalledWith(7, 91, { supplierItemCode: "OO-9", supplierItemName: "Oolong",
      purchaseSkuUomId: 511, minimumOrderQty: null, standardLeadTimeDays: null, relationshipStatus: "alternative", version: 3 });
    expect(supplierService.listSkuRelations).toHaveBeenCalledTimes(2);
  });

  it("refuses a fractional or out-of-range number before calling the server", async () => {
    supplierService.searchPurchasableSkus.mockResolvedValue({ items: [] });
    const { body } = mountPanel();
    await flushPromises();
    await body.find('[aria-label="編輯供貨關係 TEA-002"]').trigger("click");
    await flushPromises();
    for (const [label, value] of [["最低訂購量", "1.5"], ["最低訂購量", "0"], ["一般交貨期", "3651"]]) {
      await field(body, label).find("input").setValue(value);
      expect(button(body, "儲存").attributes("disabled"), `${label}=${value}`).toBeDefined();
      await field(body, label).find("input").setValue("");
    }
    expect(supplierService.updateSkuRelation).not.toHaveBeenCalled();
  });
});
