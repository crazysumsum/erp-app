import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { registerOpeningInvoice: vi.fn() } }));
import ar from "@/services/ar.js";
import Opening, { page } from "@/pages/ar/ArOpeningInvoiceCreatePage.vue";
import { useSessionStore } from "@/stores/session.js";

let wrapper;
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); });

async function open() {
  setActivePinia(createPinia());
  useSessionStore().user = { id: 1, permissions: ["ar.opening.mgmt"], roles: [] };
  wrapper = mount(Opening, { global: { plugins: [Quasar], stubs: { PageHeader: true } } });
  for (const [name, value] of Object.entries({ customerId: "12", currencyCode: "hkd", openingReference: " 000125 ",
    invoiceDate: "2026-10-01", dueDate: "2026-10-31", amount: "125.50" })) {
    await wrapper.get(`input[name=${name}]`).setValue(value);
  }
}

it("期初登記只需專用權限，逐字傳送原有編號並顯示已確認的新編號", async () => {
  expect(page.requires.permissions).toEqual(["ar.opening.mgmt"]);
  ar.registerOpeningInvoice.mockResolvedValue({ id: 1, number: "INV-2026-000001" });
  await open();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(ar.registerOpeningInvoice).toHaveBeenCalledWith({
    customerId: 12, currencyCode: "HKD", openingReference: " 000125 ", invoiceDate: "2026-10-01", dueDate: "2026-10-31",
    amount: "125.50", eventId: expect.stringMatching(/^[0-9a-f-]{36}$/u)
  });
  expect(wrapper.get('[role="status"]').text()).toContain("INV-2026-000001");
  expect(wrapper.find("a").exists()).toBe(false);
});

it("結果未確定時鎖定欄位，重試沿用相同內容及 eventId", async () => {
  ar.registerOpeningInvoice.mockRejectedValueOnce(Object.assign(new Error("逾時"), { code: "TIMEOUT" }))
    .mockResolvedValueOnce({ id: 1, number: "INV-2026-000001" });
  await open();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("input[name=openingReference]").element.disabled).toBe(true);
  await wrapper.findAll("button").find((item) => item.text() === "重試確認結果").trigger("click");
  await flushPromises();
  expect(ar.registerOpeningInvoice).toHaveBeenCalledTimes(2);
  expect(ar.registerOpeningInvoice.mock.calls[1][0]).toEqual(ar.registerOpeningInvoice.mock.calls[0][0]);
  expect(wrapper.get("input[name=openingReference]").element.disabled).toBe(false);
});
