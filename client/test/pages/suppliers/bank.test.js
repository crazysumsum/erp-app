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
      // `:id` 喺 path 度：咁樣由 /suppliers/7 去 /suppliers/8 先至係**同一個 route
      // record 換 param**，即係 Vue Router 會重用同一個 instance —— 嗰個就係
      // onBeforeRouteUpdate 守嗰條路。用一個冇 param 嘅 "/" 係測唔到佢嘅。
      { path: "/suppliers/:id", component: {
        render() { return h(SupplierBankPanel, { supplierId: Number(this.$route.params.id), supplierCode: "SUP-007" }); }
      } },
      { path: "/elsewhere", component: { render: () => h("div", "elsewhere") } }
    ]
  });
  router.push("/suppliers/7");
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
    // REV-044 M-3：之前淨係斷言最頂嗰個「新增」掣。每一行仲有三個寫入掣，而佢哋
    // 當時冇任何斷言 —— 把佢哋嘅 gate 放寬到 canReveal 都冇嘢會紅。
    for (const label of ["編輯 Test Bank", "設為預設 Other Bank", "停用 Test Bank"]) {
      expect(result.body.find(`[aria-label="${label}"]`).exists(), `${label} needs bank.mgmt`).toBe(false);
    }
    result.wrapper.unmount();
    document.body.innerHTML = "";

    result = await mountPanel({ permissions: FULL });
    for (const label of ["編輯 Test Bank", "設為預設 Other Bank", "停用 Test Bank"]) {
      expect(result.body.find(`[aria-label="${label}"]`).exists(), `${label} must appear with bank.mgmt`).toBe(true);
    }
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
  });

  /**
   * REV-044 L-1 / REV-045 F-L1：個倒數對住**單調**時鐘計，唔係數 tick，亦都唔係
   * 跟系統時鐘。
   *
   * 呢條測節流：背景 tab 嘅 `setInterval` 會被瀏覽器拖到幾秒先一次，所以要模擬
   * 「時鐘行咗好多，但 interval 只行過一次」。`advanceTimersByTime` 兩樣一齊推，
   * 推唔出呢個情況 —— 所以直接搬 `performance.now`，再用
   * `advanceTimersToNextTimer()` 只放一個 tick 出去。
   */
  it("clears on elapsed time even if the tab was throttled to one tick", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    expect(body.text()).toContain(SECRET);

    const real = performance.now.bind(performance);
    const jumped = vi.spyOn(performance, "now").mockImplementation(() => real() + 60_000);
    // 只放**一個** tick 出去，而個單調時鐘已經跳咗 60 秒 —— 即係節流嘅形狀。
    vi.advanceTimersByTime(1000);
    await flushPromises();
    jumped.mockRestore();
    expect(document.body.innerHTML,
      "a throttled tab must still clear once the deadline has passed").not.toContain(SECRET);
  });

  /**
   * REV-045 F-L1：系統時鐘向後跳（NTP 校正、使用者改時間、VM 由 snapshot 醒返）
   * 唔可以延長個窗口。用 `Date.now()` 計嘅話，向後跳一個鐘就會令 `deadline - now`
   * 變返一個好大嘅正數 —— 明文攞足一個鐘，而介面會顯示「3629 秒後自動隱藏」。
   */
  it("is not extended by the system clock jumping backwards", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);

    vi.setSystemTime(Date.now() - 3_600_000);
    vi.advanceTimersByTime(31_000);
    await flushPromises();
    expect(document.body.innerHTML,
      "a backwards clock step must not hold the account open").not.toContain(SECRET);
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

  /**
   * REV-044 H-1。`onBeforeRouteLeave` **唔會**喺淨係換 param 嗰陣行 —— 嗰個係
   * `onBeforeRouteUpdate`。我上一版留低咗前者並且喺註解度講明佢守呢條路，而佢根本
   * 唔會喺呢度行，所以 7 號嘅明文會留喺一個 URL 已經寫住 8 號嘅畫面上面。
   *
   * 呢條就係我當時話「寫唔出」嗰條測試。
   */
  it("clears the plaintext when only the :id changes and the panel is reused", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { router, body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    expect(body.text()).toContain(SECRET);

    await router.push("/suppliers/8");
    await flushPromises();
    expect(document.body.innerHTML, "supplier 7's account must not survive into supplier 8's page").not.toContain(SECRET);
  });

  /**
   * REV-044 M-1：reveal 係 async，所以佢可以喺使用者走咗之後先 resolve。嗰陣
   * `holdPlaintext` 會喺一個死咗嘅 component 上面重新揸住個帳號，仲會開多個
   * 30 秒 interval。斷言 timer 數目，因為個 DOM 已經冇咗 —— 淨係睇 DOM 係捉唔到
   * 一個 leak 咗嘅 interval 嘅。
   */
  it("does not re-hold the account if reveal resolves after the panel is gone", async () => {
    let resolveReveal;
    supplierBankService.reveal.mockReturnValue(new Promise((resolve) => { resolveReveal = resolve; }));
    const { wrapper, body } = await mountPanel({ permissions: VIEW_BANK });
    await byText(body, "查看完整帳號").trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "查看原因").find("textarea").setValue("核對付款帳號");
    await byText(body, "確認查看").trigger("click");

    wrapper.unmount();
    // 數總 timer 數係捉唔到嘅：unmount 會順手清埋 Quasar 自己嗰堆，所以個數點都會跌。
    // 要斷言嘅係「有冇**再**開一個」。
    const armed = vi.spyOn(globalThis, "setInterval");
    resolveReveal({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    await flushPromises();

    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(armed, "a late reveal must not arm a countdown on a dead component").not.toHaveBeenCalled();
    armed.mockRestore();
  });

  /**
   * REV-045 F-H1。上一輪加咗個 `gone` flag，但佢淨係喺 `onUnmounted` set ——
   * `onBeforeRouteUpdate` 同 session watch 都唔會 set，所以一個仲喺路上嘅 reveal
   * 會喺換咗 param 之後**畫返** 7 號嘅帳號出嚟喺 8 號嘅畫面度，附送一個新倒數。
   * 兩個 fix 各自啱，夾埋唔掂。依家所有清除觸發點都撳大一個 generation，而
   * `confirmReveal` 返嚟之後對返。
   */
  it("drops a reveal that lands after the Supplier has changed", async () => {
    let resolveReveal;
    supplierBankService.reveal.mockReturnValue(new Promise((resolve) => { resolveReveal = resolve; }));
    const { router, body } = await mountPanel({ permissions: VIEW_BANK });
    await byText(body, "查看完整帳號").trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "查看原因").find("textarea").setValue("核對付款帳號");
    await byText(body, "確認查看").trigger("click");

    await router.push("/suppliers/8");
    await flushPromises();
    resolveReveal({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    await flushPromises();
    expect(document.body.innerHTML,
      "supplier 7's account must not be painted onto supplier 8's screen").not.toContain(SECRET);
  });

  /**
   * REV-045 F-M1：`form.accountNumber` 同 `form.password` 一樣係使用者打落去嘅
   * 明文，而 route change 同 session 失效之前兩個都冇清 —— 個 dialog 會繼續開住、
   * 繼續 render 喺新嗰個 URL 底下。
   */
  it("wipes a half-typed write dialog on a Supplier change and on session expiry", async () => {
    const { router, body } = await mountPanel();
    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳號").find("input").setValue(SECRET);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    expect(document.body.innerHTML).toContain(SECRET);

    await router.push("/suppliers/8");
    await flushPromises();
    expect(document.body.innerHTML, "a half-typed account must not survive a Supplier change").not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("Correct-Horse-1!");

    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳號").find("input").setValue(SECRET);
    useSessionStore().user = null;
    await flushPromises();
    expect(document.body.innerHTML, "nor a session expiry").not.toContain(SECRET);
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
    // Unmount 本身就會拆走個節點，所以單睇 DOM 係一個**唔會失敗**嘅斷言 ——
    // 拆走 onUnmounted(forgetPlaintext) 佢一樣綠（REV-044 M-2）。數總 timer 數一樣
    // 唔得：unmount 會清埋 Quasar 自己嗰堆，個數點都會跌。要盯住嘅係**嗰一個**
    // handle 有冇被 clearInterval 收過。
    const cleared = vi.spyOn(globalThis, "clearInterval");
    result.wrapper.unmount();
    expect(cleared, "unmount must clear the countdown, not just remove the node").toHaveBeenCalled();
    cleared.mockRestore();
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

    // REV-044 M-2：成功路徑上面個 dialog 會閂，而 `@hide` 本身就會清欄位 —— 所以
    // 喺嗰度斷言「DOM 度搵唔到」捉唔到 forgetFormSecrets() 有冇行過。**呢條** warning
    // 路徑個 dialog 係開住嘅，即係 forgetFormSecrets() 係唯一嘅機制。
    expect(field(body, "帳號").find("input").element.value,
      "a successful write must wipe the account number even when the dialog stays open").toBe("");
    expect(field(body, "密碼").find("input").element.value).toBe("");
    expect(warning.html()).not.toContain(SECRET);
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
