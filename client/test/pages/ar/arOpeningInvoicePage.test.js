import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { findOpeningCustomer: vi.fn(), registerOpeningInvoice: vi.fn() } }));
import ar from "@/services/ar.js";
import Opening, { page } from "@/pages/ar/ArOpeningInvoiceCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

let wrapper;
const customer = { customerId: 12, customerCode: "C-0012", customerName: "示範公司", active: false };
const confirmed = { id: 1, number: "INV-2026-000001", customerCode: customer.customerCode, customerName: customer.customerName };
const button = (label) => wrapper.findAll("button").find((item) => item.text() === label);
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); });

async function open() {
  setActivePinia(createPinia());
  useSessionStore().user = { id: 1, permissions: ["ar.opening.mgmt"], roles: [] };
  wrapper = mount(Opening, { global: { plugins: [Quasar], stubs: { PageHeader: true } } });
  for (const [name, value] of Object.entries({ customerCode: "C-0012", currencyCode: "hkd", openingReference: " 000125 ",
    invoiceDate: "2026-10-01", dueDate: "2026-10-31", amount: "125.50" })) {
    await wrapper.get(`input[name=${name}]`).setValue(value);
  }
}

async function chooseCustomer() {
  await button("查找客戶").trigger("click");
  await flushPromises();
}

it("期初登記只需專用權限，輸入代碼核對客戶，確認後顯示客戶和新編號", async () => {
  expect(page.requires.permissions).toEqual(["ar.opening.mgmt"]);
  ar.findOpeningCustomer.mockResolvedValue(customer);
  ar.registerOpeningInvoice.mockResolvedValue(confirmed);
  await open();
  expect(button("登記期初發票").element.disabled).toBe(true);
  await chooseCustomer();
  expect(wrapper.text()).toContain("C-0012 — 示範公司（已停用）");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(ar.registerOpeningInvoice).toHaveBeenCalledWith({
    customerId: 12, currencyCode: "HKD", openingReference: "000125", invoiceDate: "2026-10-01", dueDate: "2026-10-31",
    amount: "125.50", eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u)
  });
  expect(wrapper.get('[role="status"]').text()).toContain("INV-2026-000001");
  expect(wrapper.get('[role="status"]').text()).toContain("C-0012 — 示範公司");
  expect(wrapper.find("a").exists()).toBe(false);
});

it("結果未確定時鎖定欄位，重試沿用相同內容及 eventId", async () => {
  ar.findOpeningCustomer.mockResolvedValue(customer);
  ar.registerOpeningInvoice.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
    .mockResolvedValueOnce(confirmed);
  await open();
  await chooseCustomer();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("input[name=openingReference]").element.disabled).toBe(true);
  await button("重試確認結果").trigger("click");
  await flushPromises();
  expect(ar.registerOpeningInvoice).toHaveBeenCalledTimes(2);
  expect(ar.registerOpeningInvoice.mock.calls[1][0]).toEqual(ar.registerOpeningInvoice.mock.calls[0][0]);
  expect(wrapper.get("input[name=openingReference]").element.disabled).toBe(false);
});

it("修改客戶代碼後必須重新核對，查不到的代碼不能入帳", async () => {
  ar.findOpeningCustomer.mockResolvedValueOnce(customer).mockRejectedValueOnce(new Error("找不到這個客戶"));
  await open();
  await chooseCustomer();
  await wrapper.get("input[name=customerCode]").setValue("NO-SUCH-CUSTOMER");
  await chooseCustomer();
  expect(wrapper.get('[role="alert"]').text()).toContain("找不到這個客戶");
  expect(button("登記期初發票").element.disabled).toBe(true);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(ar.registerOpeningInvoice).not.toHaveBeenCalled();
});
