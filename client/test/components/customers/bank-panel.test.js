import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: {
  bankAccounts: vi.fn(), createBankAccount: vi.fn(), updateBankAccount: vi.fn(),
  setDefaultBankAccount: vi.fn(), deactivateBankAccount: vi.fn(), revealBankAccount: vi.fn()
} }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn(), confirm: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import CustomerBankPanel from "@/components/customers/CustomerBankPanel.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import customerService from "@/services/customer.js";
import { useSessionStore } from "@/stores/session.js";

const BANK = { id: 9, customerId: 7, accountHolderName: "Evergreen Ltd", bankName: "Example Bank", bankCountryCode: "HK", bankCode: "001", branchCode: "002", swiftBic: "EXAMPLHH", accountCurrencyCode: "HKD", purposeCode: "general", maskedAccountNumber: "••••••••9001", isDefault: true, status: "active", version: 2, updatedAt: 1 };

async function mounted(props = {}) {
  const pinia = createPinia(); setActivePinia(pinia);
  useSessionStore().user = { id: 1, permissions: ["customer.view", "customer.bank.view", "customer.bank.mgmt"], roles: [] };
  customerService.bankAccounts.mockResolvedValue({ items: [BANK] });
  const wrapper = mount(CustomerBankPanel, { props: { customerId: 7, canManage: true, canReveal: true, ...props }, global: { plugins: [Quasar, pinia] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("CustomerBankPanel", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); vi.useRealTimers(); });

  it("loads only the masked list and hides sensitive controls without exact permission", async () => {
    const { body } = await mounted({ canManage: false, canReveal: false });
    expect(body.text()).toContain("••••••••9001");
    expect(body.text()).not.toContain("123456789001");
    expect(body.find('button[aria-label="查看 Example Bank 完整帳號"]').exists()).toBe(false);
    expect(body.find('button[aria-label="編輯 Example Bank 銀行帳戶"]').exists()).toBe(false);
  });

  it("keeps revealed plaintext component-local and clears it after 30 seconds", async () => {
    vi.useFakeTimers();
    promptPassword.mockResolvedValue({ reason: "核對退款銀行帳戶", password: "pw" });
    customerService.revealBankAccount.mockResolvedValue({ id: 9, accountNumber: "123456789001", revealedAt: 1, expiresInSeconds: 30 });
    const { wrapper, body } = await mounted();
    await body.find('button[aria-label="查看 Example Bank 完整帳號"]').trigger("click"); await flushPromises();
    expect(body.text()).toContain("123456789001");
    expect(JSON.stringify(useSessionStore().$state)).not.toContain("123456789001");
    expect(window.location.href).not.toContain("123456789001");
    vi.advanceTimersByTime(30_000); await flushPromises();
    expect(body.text()).not.toContain("123456789001");
    wrapper.unmount();
  });

  it("clears revealed plaintext immediately when reveal permission is removed", async () => {
    promptPassword.mockResolvedValue({ reason: "核對退款銀行帳戶", password: "pw" });
    customerService.revealBankAccount.mockResolvedValue({ id: 9, accountNumber: "123456789001", revealedAt: 1, expiresInSeconds: 30 });
    const { wrapper, body } = await mounted();
    await body.find('button[aria-label="查看 Example Bank 完整帳號"]').trigger("click"); await flushPromises();
    await wrapper.setProps({ canReveal: false }); await flushPromises();
    expect(body.text()).not.toContain("123456789001");
  });

  it("clears revealed plaintext and reloads when the customer changes", async () => {
    promptPassword.mockResolvedValue({ reason: "核對退款銀行帳戶", password: "pw" });
    customerService.revealBankAccount.mockResolvedValue({ id: 9, accountNumber: "123456789001", revealedAt: 1, expiresInSeconds: 30 });
    customerService.bankAccounts.mockResolvedValueOnce({ items: [BANK] }).mockResolvedValueOnce({ items: [{ ...BANK, id: 10, customerId: 8, bankName: "Second Bank", maskedAccountNumber: "••••0022" }] });
    const { wrapper, body } = await mounted();
    await body.find('button[aria-label="查看 Example Bank 完整帳號"]').trigger("click"); await flushPromises();
    expect(body.text()).toContain("123456789001");
    await wrapper.setProps({ customerId: 8 });
    expect(body.text()).not.toContain("123456789001");
    await flushPromises();
    expect(body.text()).toContain("Second Bank");
    expect(customerService.bankAccounts).toHaveBeenLastCalledWith(8);
  });

  it("clears an unsaved account number before the page enters browser history cache", async () => {
    const { body } = await mounted();
    await body.findAll("button").find((button) => button.text() === "新增銀行帳戶").trigger("click");
    const account = body.findAll(".q-field").find((field) => field.text().includes("帳號／IBAN")).find("input");
    await account.setValue("123456789001");
    window.dispatchEvent(new Event("pagehide")); await flushPromises();
    expect(account.element.value).toBe("");
  });
});
