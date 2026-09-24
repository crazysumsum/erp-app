import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerImport.js", () => ({
  default: { listJobs: vi.fn(), getJob: vi.fn(), downloadTemplate: vi.fn(), uploadJob: vi.fn(), confirmJob: vi.fn(), cancelJob: vi.fn(), downloadResult: vi.fn() },
  service: { name: "customerImport" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn(), promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import CustomerImportsPage, { page } from "@/pages/customers/CustomerImportsPage.vue";
import customerImportService from "@/services/customerImport.js";
import { useSessionStore } from "@/stores/session.js";

describe("customer import page", () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks();
    customerImportService.listJobs.mockResolvedValue({ items: [{ id: 7, mode: "upsert", status: "ready_with_errors", validCount: 2, warningCount: 1, invalidCount: 1, createdAt: 100 }], total: 1 });
  });

  it("is permission-gated and exposes the four-step template/upload/precheck/confirm workflow", async () => {
    useSessionStore().user = { id: 1, permissions: ["customer.view", "customer.mgmt"], roles: [] };
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: page.path, component: CustomerImportsPage }] });
    await router.push(page.path); await router.isReady();
    const wrapper = mount(CustomerImportsPage, { global: { plugins: [Quasar, router] } });
    await flushPromises();
    expect(page.requires.permissions).toEqual(["customer.view", "customer.mgmt"]);
    expect(wrapper.text()).toContain("下載範本");
    expect(wrapper.text()).toContain("上傳 CSV");
    expect(wrapper.text()).toContain("待確認（有錯誤）");
    expect(customerImportService.listJobs).toHaveBeenCalled();
  });
});
