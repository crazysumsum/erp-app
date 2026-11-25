import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { h } from "vue";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/services/ar.js", () => ({ default: { getInvoicePrint: vi.fn() } }));
import ar from "@/services/ar.js";
import PrintPage, { page } from "@/pages/ar/ArInvoicePrintPage.vue";
import { useSessionStore } from "@/stores/session.js";

const invoice = {
  number: "INV-2026-000042", customerName: "Example Customer", billingAddress: ["42 Bill Road"],
  currencyCode: "HKD", currencyDecimalPlaces: 2, totalAmount: "3.5000", lines: [], issuerName: "Example Trading"
};
let wrapper;
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function open() {
  setActivePinia(createPinia());
  useSessionStore().user = { id: 1, permissions: ["ar.view"], roles: [] };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { ...page, component: PrintPage }, { path: "/ar/invoices/:id", component: { render: () => h("p", "invoice") } }
  ] });
  await router.push("/ar/invoices/42/print");
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [router, Quasar] } });
  await flushPromises();
}

it("列印前重新讀取發票，使用新取得的應收列印資料", async () => {
  const print = vi.fn();
  vi.stubGlobal("print", print);
  ar.getInvoicePrint.mockResolvedValueOnce(invoice).mockResolvedValueOnce({ ...invoice, issuerName: "Current Example Trading" });
  await open();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(ar.getInvoicePrint).toHaveBeenCalledTimes(2);
  expect(ar.getInvoicePrint).toHaveBeenLastCalledWith("42", { signal: expect.any(AbortSignal) });
  expect(wrapper.get("article").text()).toContain("Current Example Trading");
  expect(print).toHaveBeenCalledOnce();
});

it("發票在預覽後作廢時，重新檢查會移除預覽並停印", async () => {
  const print = vi.fn();
  vi.stubGlobal("print", print);
  ar.getInvoicePrint.mockResolvedValueOnce(invoice).mockRejectedValueOnce(new Error("目前狀態不允許列印此發票"));
  await open();
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("目前狀態不允許列印此發票");
  expect(wrapper.find("article").exists()).toBe(false);
  expect(print).not.toHaveBeenCalled();
});
