import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { list: vi.fn() }, service: { name: "supplier" }
}));

import supplierService from "@/services/supplier.js";
import SuppliersPage, { page } from "@/pages/suppliers/SuppliersPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ROW = {
  id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
  defaultCurrencyCode: "HKD", defaultPaymentTermId: null, primaryContactName: "Amy Chan",
  status: "active", version: 2, updatedAt: 1700000000000
};

async function mountPage({ permissions = ["supplier.view", "supplier.mgmt"], initialRoute = "/suppliers" } = {}) {
  supplierService.list.mockResolvedValue({ rows: [ROW], rowsNumber: 1 });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, component: SuppliersPage },
      { path: "/suppliers/:id", component: { template: "<div>detail</div>" } },
      { path: "/suppliers/new", component: { template: "<div>create</div>" } }
    ]
  });
  await router.push(initialRoute);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount(SuppliersPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/suppliers/SuppliersPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("is the permission-filtered Supplier menu entry and renders explicit status text", async () => {
    expect(page.menu.group).toBe("suppliers");
    expect(page.requires.permissions).toEqual(["supplier.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("SUP-007");
    expect(body.text()).toContain("Amy Chan");
    expect(body.text()).toContain("啟用");
    expect(body.find('a[href="/suppliers/7"]').exists()).toBe(true);
  });

  it("shows create only to supplier.mgmt users", async () => {
    let result = await mountPage({ permissions: ["supplier.view"] });
    expect(result.body.find('a[href="/suppliers/new"]').exists()).toBe(false);
    result.wrapper.unmount();
    document.body.innerHTML = "";
    result = await mountPage();
    expect(result.body.find('a[href="/suppliers/new"]').exists()).toBe(true);
  });

  it("restores filters and paging from URL and keeps the query shareable", async () => {
    const { router } = await mountPage({ initialRoute: "/suppliers?page=2&q=evergreen&status=active&sortBy=supplierName&descending=false" });
    expect(supplierService.list).toHaveBeenCalledWith(expect.objectContaining({
      page: 2, filter: "evergreen", status: "active", sortBy: "supplierName", descending: false
    }));
    expect(router.currentRoute.value.query.q).toBe("evergreen");
  });
});
