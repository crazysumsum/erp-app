import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: { list: vi.fn() }, service: { name: "customer" } }));

import customerService from "@/services/customer.js";
import CustomersPage, { page } from "@/pages/customers/CustomersPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ROW = { id: 7, code: "CUS-007", legalName: "Evergreen Customer", displayName: "Evergreen", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "active", version: 2, updatedAt: 1_700_000_000_000 };

async function mountPage({ permissions = ["customer.view", "customer.mgmt"], initialRoute = "/customers" } = {}) {
  customerService.list.mockResolvedValue({ rows: [ROW], rowsNumber: 1 });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: page.path, component: CustomersPage }, { path: "/customers/new", component: { template: "<div>create</div>" } }, { path: "/customers/:id", component: { template: "<div>detail</div>" } }
  ] });
  await router.push(initialRoute); await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount(CustomersPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

describe("pages/customers/CustomersPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("is a customer.view menu page with explicit status and detail route", async () => {
    expect(page.requires.permissions).toEqual(["customer.view"]);
    const { body } = await mountPage();
    expect(body.text()).toContain("CUS-007");
    expect(body.text()).toContain("Evergreen Customer");
    expect(body.text()).toContain("啟用");
    expect(body.find('a[href="/customers/7"]').exists()).toBe(true);
  });

  it("keeps exact/prefix search, status and sorting in shareable URL state", async () => {
    const { router } = await mountPage({ initialRoute: "/customers?page=2&q=evergreen&status=active&sortBy=legalName&descending=false" });
    expect(customerService.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, filter: "evergreen", status: "active", sortBy: "legalName", descending: false }));
    expect(router.currentRoute.value.query.q).toBe("evergreen");
  });
});
