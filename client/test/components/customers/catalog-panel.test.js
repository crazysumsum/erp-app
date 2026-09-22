import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerCatalog.js", () => ({ default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() } }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import customerCatalogService from "@/services/customerCatalog.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import CustomerCatalogPanel from "@/components/customers/CustomerCatalogPanel.vue";

describe("CustomerCatalogPanel", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); customerCatalogService.list.mockResolvedValue({ items: [] }); });
  it("creates a typed catalog item with device re-auth fields", async () => {
    promptPassword.mockResolvedValue({ reason: "新增客戶分類", password: "pw" }); customerCatalogService.create.mockResolvedValue({ id: 1 });
    const wrapper = mount(CustomerCatalogPanel, { props: { catalog: "categories", title: "客戶分類" }, global: { plugins: [Quasar] }, attachTo: document.body });
    await flushPromises(); const body = new DOMWrapper(document.body);
    await wrapper.findAll("button").find((button) => button.text() === "新增客戶分類").trigger("click");
    await body.findAll(".q-field").find((field) => field.text().includes("代碼")).find("input").setValue("retail");
    await body.findAll(".q-field").find((field) => field.text().includes("名稱")).find("input").setValue("零售");
    await body.findAll("button").find((button) => button.text() === "儲存").trigger("click"); await flushPromises();
    expect(customerCatalogService.create).toHaveBeenCalledWith("categories", { code: "retail", name: "零售", description: "", sortOrder: 0, reason: "新增客戶分類", password: "pw" });
  });
});
