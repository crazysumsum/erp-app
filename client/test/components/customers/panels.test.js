import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { QCheckbox, QSelect, QToggle, Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: { createAddress: vi.fn(), updateAddress: vi.fn(), createContact: vi.fn(), createIdentifier: vi.fn(), saveCreditPolicy: vi.fn(), clearCreditPolicy: vi.fn() } }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
import customerService from "@/services/customer.js";
import CustomerAddressPanel from "@/components/customers/CustomerAddressPanel.vue";
import CustomerCompletenessBanner from "@/components/customers/CustomerCompletenessBanner.vue";
import CustomerContactPanel from "@/components/customers/CustomerContactPanel.vue";
import CustomerCreditPanel from "@/components/customers/CustomerCreditPanel.vue";
import CustomerIdentifierPanel from "@/components/customers/CustomerIdentifierPanel.vue";

function input(body, label) { return body.findAll(".q-field").find((field) => field.text().includes(label)).find("input, textarea"); }
describe("Customer TASK-017 panels", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });
  it("creates an address with multiple purpose/default selections", async () => {
    customerService.createAddress.mockResolvedValue({ id: 1 });
    const wrapper = mount(CustomerAddressPanel, { props: { customerId: 7, addresses: [], canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await body.findAll("button").find((b) => b.text() === "新增地址").trigger("click"); await flushPromises();
    await input(body, "地址標籤 *").setValue("總部"); await input(body, "地址行 1 *").setValue("皇后大道中 1 號");
    const checks = wrapper.findAllComponents(QCheckbox); checks[0].vm.$emit("update:modelValue", true); checks[1].vm.$emit("update:modelValue", true); await flushPromises();
    wrapper.findAllComponents(QToggle)[0].vm.$emit("update:modelValue", true); await flushPromises();
    await body.findAll("button").find((b) => b.text() === "儲存地址").trigger("click"); await flushPromises();
    expect(customerService.createAddress).toHaveBeenCalledWith(7, expect.objectContaining({ purposes: [{ code: "billing", isDefault: true }, { code: "shipping", isDefault: false }] }));
  });
  it("creates a contact with the selected default purpose", async () => {
    customerService.createContact.mockResolvedValue({ id: 2 });
    const contacts = [{ id: 1, name: "現有聯絡人", status: "active", purposes: [{ code: "billing_ar", isDefault: true }] }];
    const wrapper = mount(CustomerContactPanel, { props: { customerId: 7, contacts, canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); expect(body.text()).toContain("帳單／應收（預設）"); await body.findAll("button").find((b) => b.text() === "新增聯絡人").trigger("click"); await flushPromises();
    await input(body, "姓名 *").setValue("陳大文"); await input(body, "備註").setValue("只於辦公時間聯絡");
    wrapper.findAllComponents(QCheckbox)[0].vm.$emit("update:modelValue", true); await flushPromises();
    wrapper.findAllComponents(QToggle)[0].vm.$emit("update:modelValue", true); await flushPromises();
    await body.findAll("button").find((b) => b.text() === "儲存聯絡人").trigger("click"); await flushPromises();
    expect(customerService.createContact).toHaveBeenCalledWith(7, expect.objectContaining({ name: "陳大文", notes: "只於辦公時間聯絡", purposes: [{ code: "general", isDefault: true }] }));
  });
  it("creates an identifier with UTC date values", async () => {
    customerService.createIdentifier.mockResolvedValue({ id: 3 });
    const wrapper = mount(CustomerIdentifierPanel, { props: { customerId: 7, identifiers: [], canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await body.findAll("button").find((b) => b.text() === "新增識別資料").trigger("click"); await flushPromises();
    wrapper.findComponent(QSelect).vm.$emit("update:modelValue", "business_registration"); await flushPromises();
    await input(body, "簽發國家／地區 *").setValue("hk"); await input(body, "識別號碼 *").setValue("12345678"); await input(body, "生效日期").setValue("2026-09-22");
    await body.findAll("button").find((b) => b.text() === "儲存識別資料").trigger("click"); await flushPromises();
    expect(customerService.createIdentifier).toHaveBeenCalledWith(7, expect.objectContaining({ identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: "12345678", validFrom: Date.UTC(2026, 8, 22) }));
  });
  it("moves focus to an API error without clearing address input", async () => {
    customerService.createAddress.mockRejectedValue(new Error("暫時無法儲存"));
    mount(CustomerAddressPanel, { props: { customerId: 7, addresses: [], canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await body.findAll("button").find((b) => b.text() === "新增地址").trigger("click"); await flushPromises();
    await input(body, "地址標籤 *").setValue("總部"); await input(body, "地址行 1 *").setValue("皇后大道中 1 號");
    await body.findAll("button").find((b) => b.text() === "儲存地址").trigger("click"); await flushPromises();
    expect(document.activeElement).toBe(body.find('[role="alert"]').element); expect(input(body, "地址標籤 *").element.value).toBe("總部");
  });
  it("shows purpose defaults and offers an explicit conflict reload", async () => {
    customerService.updateAddress.mockRejectedValue(Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" }));
    const address = { id: 4, label: "總部", addressLine1: "中環", status: "active", version: 2, purposes: [{ code: "shipping", isDefault: true }] };
    const wrapper = mount(CustomerAddressPanel, { props: { customerId: 7, addresses: [address], canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); expect(body.text()).toContain("送貨（預設）");
    await body.find('button[aria-label="編輯地址 總部"]').trigger("click"); await flushPromises();
    await input(body, "修改原因 *").setValue("更新地址資料"); await body.findAll("button").find((b) => b.text() === "儲存地址").trigger("click"); await flushPromises();
    const reload = body.findAll("button").find((b) => b.text() === "載入最新資料"); expect(reload).toBeTruthy();
    await reload.trigger("click"); expect(wrapper.emitted("refresh")).toHaveLength(1);
  });
  it("preserves zero as a configured credit limit", async () => {
    customerService.saveCreditPolicy.mockResolvedValue({ configured: true });
    mount(CustomerCreditPanel, { props: { customerId: 7, policy: { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null }, canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await body.findAll("button").find((b) => b.text() === "設定信用政策").trigger("click");
    await input(body, "信用額度").setValue("0.0000"); await input(body, "信用貨幣").setValue("HKD"); await input(body, "修改原因 *").setValue("設定零額度");
    await body.findAll("button").find((b) => b.text() === "儲存信用政策").trigger("click"); await flushPromises();
    const payload = customerService.saveCreditPolicy.mock.calls[0][1];
    expect(payload).toEqual(expect.objectContaining({ creditLimit: "0.0000", creditCurrencyCode: "HKD", version: null }));
    expect(payload).not.toHaveProperty("creditNotes"); expect(body.text()).toContain("不代表信用超額、逾期或暫停信用交易的豁免權限");
  });
  it("requires a password when clearing a configured credit policy", async () => {
    customerService.clearCreditPolicy.mockResolvedValue({ configured: false });
    mount(CustomerCreditPanel, { props: { customerId: 7, policy: { configured: true, creditLimit: "100.0000", currencyCode: "HKD", status: "normal", policyVersion: 3 }, canManage: true }, global: { plugins: [Quasar] }, attachTo: document.body });
    const body = new DOMWrapper(document.body); await body.findAll("button").find((b) => b.text() === "清除信用政策").trigger("click");
    await input(body, "修改原因 *").setValue("取消信用安排"); await input(body, "密碼 *").setValue("secret");
    await body.findAll("button").find((b) => b.text() === "確認清除").trigger("click"); await flushPromises();
    expect(customerService.clearCreditPolicy).toHaveBeenCalledWith(7, { version: 3, reason: "取消信用安排", password: "secret" });
  });
  it("shows completeness issues without treating credit null as zero", () => {
    const completeness = { issues: [{ code: "CURRENCY_NOT_ACTIVE", message: "啟用前必須設定有效的預設貨幣" }], warnings: [{ code: "CREDIT_POLICY_MISSING", message: "尚未設定信用政策（不等同 0 額度）" }] };
    const wrapper = mount(CustomerCompletenessBanner, { props: { completeness }, global: { plugins: [Quasar] } });
    expect(wrapper.text()).toContain("有效的預設貨幣"); expect(wrapper.text()).toContain("不等同 0 額度");
  });
});
