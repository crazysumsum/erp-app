import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: {
    list: vi.fn(), getById: vi.fn(), completeness: vi.fn(),
    activate: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), block: vi.fn(), unblock: vi.fn(),
    archive: vi.fn(), restore: vi.fn(), deleteSupplier: vi.fn()
  },
  service: { name: "supplier" }
}));

import supplierService from "@/services/supplier.js";
import SuppliersPage from "@/pages/suppliers/SuppliersPage.vue";
import SupplierDetailPage from "@/pages/suppliers/SupplierDetailPage.vue";
import { useSessionStore } from "@/stores/session.js";

const SUPPLIER = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, primaryContactName: "Amy Chan",
  status: "active", version: 4, updatedAt: 1700000000000, createdAt: 1600000000000,
  website: "", generalPhone: "", generalEmail: "", notes: "", addresses: [], contacts: [], identifiers: [],
  bankAccounts: [], warnings: []
};

describe("Supplier Core client smoke flow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("lets a view-only user move from the bounded list projection to detail without exposing write actions", async () => {
    supplierService.list.mockResolvedValue({ rows: [SUPPLIER], rowsNumber: 1 });
    supplierService.getById.mockResolvedValue(SUPPLIER);
    supplierService.completeness.mockResolvedValue({ supplierId: 7, issues: [], warnings: [] });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/suppliers", component: SuppliersPage },
        { path: "/suppliers/:id", component: SupplierDetailPage },
        { path: "/suppliers/new", component: { template: "<div>create</div>" } }
      ]
    });
    await router.push("/suppliers");
    await router.isReady();
    useSessionStore().user = { id: 18, username: "supplier-viewer", permissions: ["supplier.view"], roles: [] };
    const wrapper = mount({ render: () => h(RouterView) }, {
      global: { plugins: [Quasar, router] },
      attachTo: document.body
    });
    const body = new DOMWrapper(document.body);
    await flushPromises();

    expect(body.text()).toContain("SUP-007");
    expect(body.find('a[href="/suppliers/new"]').exists()).toBe(false);
    expect(body.find('[aria-label="供應商狀態操作"]').exists()).toBe(false);
    await body.find('a[href="/suppliers/7"]').trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/suppliers/7");
    expect(supplierService.getById).toHaveBeenCalledWith(7);
    expect(body.text()).toContain("SUP-007 — Evergreen Trading");
    expect(body.text()).not.toContain("編輯一般資料");
    expect(body.text()).not.toContain("受控修正 Supplier Code");
    wrapper.unmount();
  });
});
