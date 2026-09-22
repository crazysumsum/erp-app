import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplierBank.js", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), deactivate: vi.fn(), reveal: vi.fn() },
  service: { name: "supplierBank" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import supplierBankService from "@/services/supplierBank.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import SupplierBankPanel from "@/components/suppliers/SupplierBankPanel.vue";
import { useSessionStore } from "@/stores/session.js";

const SECRET = "12345678901234";
const ROWS = [
  { id: 41, bankName: "Test Bank", accountHolderName: "Evergreen Trading", maskedAccountNumber: "•••• 1234",
    status: "active", isDefault: true, version: 1, bankCountryCode: "HK", accountCurrencyCode: "HKD" },
  { id: 42, bankName: "Other Bank", accountHolderName: "Evergreen Trading", maskedAccountNumber: "•••• 5678",
    status: "active", isDefault: false, version: 3, bankCountryCode: "HK", accountCurrencyCode: "HKD" }
];
const writes = [];
const VIEW = ["supplier.view"];
const VIEW_BANK = ["supplier.view", "supplier.bank.view"];
const FULL = ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"];

/**
 * 真係要有個 router：`onBeforeRouteLeave` 淨係喺一個 render 喺 <router-view>
 * 入面嘅 component 度先註冊得到。冇 router 就掛住個 guard 都唔會行，而
 * 「route change 要清明文」呢條 AC 就會變成一條冇人測過嘅說話。
 */
async function mountPanel({ permissions = FULL, rows = ROWS } = {}) {
  supplierBankService.list.mockResolvedValue(rows);
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { render: () => h(SupplierBankPanel, { supplierId: 7, supplierCode: "SUP-007" }) } },
      { path: "/elsewhere", component: { render: () => h("div", "elsewhere") } }
    ]
  });
  router.push("/");
  await router.isReady();
  const wrapper = mount({ render: () => h(RouterView) }, {
    global: { plugins: [Quasar, router] }, attachTo: document.body
  });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

const byText = (body, text) => body.findAll(".q-btn").find((button) => button.text().includes(text));
const field = (body, label) => body.findAll(".q-field").find((item) => item.text().includes(label));

async function revealRow(body, { password = "Correct-Horse-1!", reason = "核對付款帳號" } = {}) {
  await byText(body, "查看完整帳號").trigger("click");
  await flushPromises();
  await field(body, "密碼").find("input").setValue(password);
  await field(body, "查看原因").find("textarea").setValue(reason);
  await byText(body, "確認查看").trigger("click");
  await flushPromises();
}

describe("components/suppliers/SupplierBankPanel.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom 喺 about:blank 係 opaque origin，冇 localStorage。與其跳過個斷言
    // （一個跳過咗嘅斷言同一個過咗嘅斷言睇落一樣），不如裝一對**會記低寫入**
    // 嘅 storage。咁樣個斷言由「storage 入面搵唔到」變成「根本冇人寫過去」，
    // 而且下面有一個 control 證明佢真係記得到。
    writes.length = 0;
    for (const name of ["localStorage", "sessionStorage"]) {
      vi.stubGlobal(name, {
        getItem: () => null,
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
        setItem: (key, value) => writes.push({ store: name, key, value })
      });
    }
  });
  afterEach(() => vi.useRealTimers());

  // AC-023：遮罩清單所有 supplier.view 都睇到，而初次 render **唔可以**叫 reveal。
  it("renders masked rows on load and never calls reveal by itself", async () => {
    const { body } = await mountPanel({ permissions: VIEW });
    expect(supplierBankService.list).toHaveBeenCalledWith(7);
    expect(body.text()).toContain("•••• 1234");
    expect(body.text()).toContain("Test Bank");
    expect(supplierBankService.reveal).not.toHaveBeenCalled();
    expect(body.text()).not.toContain(SECRET);
  });

  it("offers no reveal without bank.view and no write controls without bank.mgmt", async () => {
    let result = await mountPanel({ permissions: VIEW });
    expect(byText(result.body, "查看完整帳號")).toBeUndefined();
    expect(byText(result.body, "新增銀行帳戶")).toBeUndefined();
    result.wrapper.unmount();
    document.body.innerHTML = "";

    result = await mountPanel({ permissions: VIEW_BANK });
    expect(byText(result.body, "查看完整帳號")).toBeDefined();
    expect(byText(result.body, "新增銀行帳戶"), "bank.view alone must not buy write controls").toBeUndefined();
  });

  // AC-024 + 設計 §7.5：主動輸入密碼之後只展開**嗰一筆** 30 秒，並且顯示倒數。
  it("reveals one row for thirty seconds with a countdown, then clears it from the DOM", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);

    expect(supplierBankService.reveal).toHaveBeenCalledWith(7, 41, { password: "Correct-Horse-1!", reason: "核對付款帳號" });
    expect(body.text()).toContain(SECRET);
    expect(body.text()).toMatch(/30/u);
    // 另一行唔可以跟住展開。
    expect(body.text()).toContain("•••• 5678");

    vi.advanceTimersByTime(15_000);
    await flushPromises();
    expect(body.text()).toContain(SECRET);
    expect(body.text()).toMatch(/1[0-5]/u);

    vi.advanceTimersByTime(16_000);
    await flushPromises();
    expect(body.text()).not.toContain(SECRET);
    // 唔可以淨係隱藏 —— 個節點要冇咗，唔係 display:none 收埋住明文。
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("keeps the plaintext out of Pinia, storage, the URL and notifications", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    expect(body.text()).toContain(SECRET);

    const session = useSessionStore();
    expect(JSON.stringify(session.$state)).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);

    // Control：個 stub 真係捉得到寫入。冇呢兩句，下面嗰個 `writes` 斷言喺一個
    // 壞咗嘅 stub 上面一樣會綠 —— 即係一個唔會失敗嘅檢查。
    localStorage.setItem("control", SECRET);
    expect(writes.filter((write) => write.value.includes(SECRET))).toHaveLength(1);
    writes.length = 0;

    expect(writes, "nothing the panel does may write to browser storage").toEqual([]);
    for (const call of [...notifySuccess.mock.calls, ...notifyError.mock.calls]) {
      expect(String(call[0])).not.toContain(SECRET);
    }
  });

  it("clears the plaintext when the row is closed by hand", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    await byText(body, "收起").trigger("click");
    await flushPromises();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("clears the plaintext when the user navigates away", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { router, body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    expect(body.text()).toContain(SECRET);
    await router.push("/elsewhere");
    await flushPromises();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("clears the plaintext on unmount and on session expiry", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    let result = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(result.body);
    result.wrapper.unmount();
    expect(document.body.innerHTML).not.toContain(SECRET);

    document.body.innerHTML = "";
    result = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(result.body);
    expect(result.body.text()).toContain(SECRET);
    useSessionStore().user = null;
    await flushPromises();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  // 設計 §7.5：提交成功之後 form state 入面個帳號要即刻清空，password 一樣。
  it("clears the account number and password fields after a successful create", async () => {
    supplierBankService.create.mockResolvedValue({ id: 43, bankName: "New Bank", maskedAccountNumber: "•••• 9999", warnings: [] });
    const { wrapper, body } = await mountPanel();
    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳戶名稱").find("input").setValue("Evergreen Trading");
    await field(body, "銀行名稱").find("input").setValue("New Bank");
    await field(body, "帳號").find("input").setValue(SECRET);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "新增原因").find("textarea").setValue("新開一個戶口");
    await byText(body, "儲存").trigger("click");
    await flushPromises();

    expect(supplierBankService.create).toHaveBeenCalledWith(7, expect.objectContaining({
      accountNumber: SECRET, password: "Correct-Horse-1!", reason: "新開一個戶口"
    }));
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("Correct-Horse-1!");
    expect(wrapper.findComponent(SupplierBankPanel).emitted("refresh")).toBeTruthy();
  });

  it("marks the account and password inputs so browsers do not autofill or store them", async () => {
    const { body } = await mountPanel();
    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    expect(field(body, "帳號").find("input").attributes("autocomplete")).toBe("off");
    const password = field(body, "密碼").find("input");
    expect(password.attributes("type")).toBe("password");
    expect(password.attributes("autocomplete")).toBe("current-password");
  });

  /**
   * 設計 §6.6／§7.5：同一個 Supplier 重覆係伺服器直接擋（409）；跨 Supplier 只回一個
   * warning，而個 warning **唔可以**帶對方嘅帳號，使用者要主動確認先繼續。
   */
  it("blocks a same-Supplier duplicate and makes a cross-Supplier duplicate an explicit confirmation", async () => {
    supplierBankService.create.mockRejectedValue(
      Object.assign(new Error("這個銀行帳號已經登記咗"), { code: "BANK_ACCOUNT_DUPLICATE" })
    );
    const { body } = await mountPanel();
    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳戶名稱").find("input").setValue("Evergreen Trading");
    await field(body, "銀行名稱").find("input").setValue("New Bank");
    await field(body, "帳號").find("input").setValue(SECRET);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "新增原因").find("textarea").setValue("新開一個戶口");
    await byText(body, "儲存").trigger("click");
    await flushPromises();
    expect(body.find('[role="alert"]').text()).toContain("已經登記");
    // 錯誤訊息唔可以覆述個帳號 —— 驗證摘要係設計 §7.5 明文禁止嘅其中一個地方。
    expect(body.find('[role="alert"]').text()).not.toContain(SECRET);

    // 失敗之後密碼要清 —— step-up 憑證唔可以留喺一個開住嘅 dialog 度等下次再用。
    // 帳號就留返，因為使用者要改嘅可能就係佢。
    expect(field(body, "密碼").find("input").element.value).toBe("");
    expect(field(body, "帳號").find("input").element.value).toBe(SECRET);
    expect(byText(body, "儲存").attributes("disabled"), "a cleared password must re-disable submit").toBeDefined();

    supplierBankService.create.mockResolvedValue({
      id: 43, bankName: "New Bank", maskedAccountNumber: "•••• 9999",
      warnings: [{ code: "BANK_ACCOUNT_DUPLICATE_OTHER_SUPPLIER", message: "另一間供應商用緊同一個帳號", supplierCodes: ["SUP-009"] }]
    });
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await byText(body, "儲存").trigger("click");
    await flushPromises();
    const warning = body.find('[data-test="bank-duplicate-warning"]');
    expect(warning.exists()).toBe(true);
    expect(warning.text()).toContain("SUP-009");
    expect(warning.text()).not.toContain(SECRET);
  });

  // 設計 §7.5：切換預設要明講舊 default 會被取消。
  it("says the previous default will be cancelled before switching", async () => {
    supplierBankService.setDefault.mockResolvedValue({ id: 42, isDefault: true });
    const { body } = await mountPanel();
    await body.find('[aria-label="設為預設 Other Bank"]').trigger("click");
    await flushPromises();
    expect(body.text()).toMatch(/原本嘅預設|取消/u);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "原因").find("textarea").setValue("轉出糧戶口");
    await byText(body, "確認").trigger("click");
    await flushPromises();
    expect(supplierBankService.setDefault).toHaveBeenCalledWith(7, 42, expect.objectContaining({ version: 3 }));
  });

  it("deactivates with a version and a reason", async () => {
    supplierBankService.deactivate.mockResolvedValue({ id: 42, status: "inactive" });
    const { wrapper, body } = await mountPanel();
    await body.find('[aria-label="停用 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "原因").find("textarea").setValue("戶口已經結束");
    await byText(body, "確認").trigger("click");
    await flushPromises();
    expect(supplierBankService.deactivate).toHaveBeenCalledWith(7, 42, expect.objectContaining({
      version: 3, reason: "戶口已經結束", password: "Correct-Horse-1!"
    }));
    expect(wrapper.findComponent(SupplierBankPanel).emitted("refresh")).toBeTruthy();
  });

  it("surfaces a wrong password as a password problem, not a permission one", async () => {
    supplierBankService.reveal.mockRejectedValue(
      Object.assign(new Error("Please confirm your current password"), { code: "PASSWORD_INVALID" })
    );
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body, { password: "wrong" });
    expect(body.find('[role="alert"]').text()).toMatch(/密碼/u);
    expect(document.body.innerHTML).not.toContain("wrong");
  });
});
