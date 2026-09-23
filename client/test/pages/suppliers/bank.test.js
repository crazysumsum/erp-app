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
 *
 * **呢個宿主特登同真程式唔同**：佢綁 `$route.params.id` 落個 prop 並且保住同一個
 * instance，所以換 param 嗰陣個 panel **唔會** unmount。真嘅 `SupplierDetailPage`
 * 會拆走成個子樹再起過（`loading` 一 true，`v-else-if="supplier"` 就唔 render）。
 *
 * 保住 instance 係為咗令 `onBeforeRouteUpdate` 嗰個 guard 有嘢測。
 *
 * **嗰個 guard 喺 production 係跑緊嘅，而且係第一個跑。** 我上一版喺呢度寫佢係
 * 「縱深防禦（unmount 已經清咗）」、守住「有一日個 panel 真係被重用」—— 兩句都錯，
 * 而且錯同一個方向。實測（真 `SupplierDetailPage`、真 router、明文展開住、倒數行緊）：
 *
 *   guardUpdate:SupplierDetailPage → guardUpdate:SupplierBankPanel → list:8
 *
 * 個 guard 喺**路由確認之前**行，即係喺 `route.params.id` 變之前、喺 page 個 watcher
 * set `loading = true` 拆走個子樹之前。所以清明文嗰個係佢，unmount 先係冗餘嗰層。
 * （`framework/routing/router.js` 得一個全域 `beforeEach`、冇 `beforeResolve`，而
 * `beforeEach` 跑喺 component guard 之前，所以個 guard 清完之後冇嘢可以再中止導航。）
 *
 * 呢個分別要講明，因為呢個註解嘅唯一作用就係阻止下一個人刪咗個 guard —— 而佢之前
 * 講緊嗰句係「呢個 guard 係揣測性嘅」。同 REV-047 F-H1 係同一個品種嘅錯：一句關於
 * 程式嘅陳述，由推理得出而唔係由執行得出。（REV-048 F-L2）
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
   * 推唔出呢個情況 —— 所以直接搬 `performance.now`，再用 `advanceTimersByTime(1000)`
   * 放**一個** tick 出去（個 interval 週期就係 1000ms）。(REV-046 I-2)
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
    const { wrapper, router, body } = await mountPanel();
    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳號").find("input").setValue(SECRET);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    expect(document.body.innerHTML).toContain(SECRET);

    await router.push("/suppliers/8");
    await flushPromises();
    expect(document.body.innerHTML, "a half-typed account must not survive a Supplier change").not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("Correct-Horse-1!");
    // REV-049：淨係睇 DOM 唔夠（閂咗 dialog 就成立），而「重開 dialog 再睇欄位」
    // 一樣唔夠 —— `openCreate()` **會**重設嗰兩個欄位（`Object.assign`），所以
    // 嗰個斷言係佢滿足嘅，唔係清除機制滿足嘅。我上一版喺註解度寫「openCreate
    // 唔會清」，嗰句係錯，而且同 panel 自己個註解對唔上。
    //
    // 直接睇 component 自己嗰份 state。呢個係唯一一個唔會被「唔再 render」或者
    // 「重開時重設」滿足嘅斷言。
    const panelVm = wrapper.findComponent(SupplierBankPanel).vm;
    expect(panelVm.form.accountNumber,
      "the account number must be gone from form state, not merely unrendered").toBe("");
    expect(panelVm.form.password).toBe("");

    await byText(body, "新增銀行帳戶").trigger("click");
    await flushPromises();
    await field(body, "帳號").find("input").setValue(SECRET);
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    useSessionStore().user = null;
    await flushPromises();
    expect(document.body.innerHTML, "nor a session expiry").not.toContain(SECRET);
    // Session 失效嗰陣個 panel **唔會** unmount，所以 component state 係唯一
    // 講得出「真係唔記得咗」同「淨係唔再畫」嘅分別嘅地方。
    expect(panelVm.form.accountNumber, "session expiry must forget, not merely stop rendering").toBe("");
    expect(panelVm.form.password).toBe("");
  });

  /**
   * REV-050 F-L3：`session.refresh()` 係 `this.user = result.user` —— 換一個新
   * object，所以 `isAuthenticated` 一路都係 true。一個淨係睇佢嘅 watch 永遠唔會
   * 行，即係一次撤走 `supplier.bank.view` 嘅 refresh 之後，明文仲會留喺畫面。
   *
   * 呢個係十輪以嚟冇人接過嘅第六個「資格結束」觸發點。
   */
  it("forgets the plaintext when a session refresh revokes the entitlement", async () => {
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });
    const { wrapper, body } = await mountPanel({ permissions: VIEW_BANK });
    const panelVm = wrapper.findComponent(SupplierBankPanel).vm;
    await revealRow(body);
    expect(body.text()).toContain(SECRET);

    // 同 refresh() 做嘅嘢一樣：換一個新 user object，仲係登入緊，但冇咗 bank.view。
    useSessionStore().user = { id: 1, permissions: ["supplier.view"], roles: [] };
    await flushPromises();
    expect(useSessionStore().isAuthenticated, "still signed in — that is the point").toBe(true);
    expect(panelVm.revealed.accountNumber,
      "losing bank.view must forget the plaintext, not merely hide the button").toBe("");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  /**
   * REV-049 Z16／Z17：兩個 step-up dialog 各自嗰個密碼有同一個窿 —— 拆走
   * `@hide` 同 `forgetEverything()` 入面嗰行，634 條照綠，而密碼喺 session 失效
   * 之後仲留喺 component state 度（嗰陣個 panel 冇 unmount）。REV-046 個 X5 淨係
   * 捉到「兩句一齊拆」嗰個變體。
   */
  it("forgets both step-up passwords from component state, not just from the DOM", async () => {
    const { wrapper, router, body } = await mountPanel();
    const panelVm = wrapper.findComponent(SupplierBankPanel).vm;

    // Reveal dialog
    await byText(body, "查看完整帳號").trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Reveal-Password-1!");
    expect(panelVm.revealDialog.password).toBe("Reveal-Password-1!");
    await router.push("/suppliers/8");
    await flushPromises();
    expect(panelVm.revealDialog.password, "a Supplier change must forget the reveal password").toBe("");

    // Confirm dialog
    await body.find('[aria-label="設為預設 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Confirm-Password-1!");
    expect(panelVm.confirm.password).toBe("Confirm-Password-1!");
    useSessionStore().user = null;
    await flushPromises();
    expect(panelVm.confirm.password, "a session expiry must forget the confirm password").toBe("");
  });

  /**
   * REV-049：`holdPlaintext()` 第一句 `forgetPlaintext()` 冇嘢斷言 —— 展開第二行
   * 從來冇測過。拆走佢，第一行嗰個 interval 變成孤兒，永遠行落去，而第二行嘅
   * 30 秒會俾佢一路扣落去（量到 30 → 25）。
   */
  it("replaces the first row's countdown when a second row is revealed", async () => {
    supplierBankService.reveal.mockImplementation((_s, id) =>
      Promise.resolve({ id, accountNumber: `ACCOUNT-${id}`, revealedAt: 1 }));
    const { wrapper, body } = await mountPanel({ permissions: VIEW_BANK });
    const panelVm = wrapper.findComponent(SupplierBankPanel).vm;
    await revealRow(body);
    expect(panelVm.revealed.id).toBe(41);

    // 第一行展開之後行 5 秒，令兩個 deadline 明顯唔同。
    vi.advanceTimersByTime(5000);
    await flushPromises();
    await body.find('[aria-label="查看完整帳號 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "查看原因").find("textarea").setValue("核對第二個帳號");
    await byText(body, "確認查看").trigger("click");
    await flushPromises();


    expect(panelVm.revealed.id, "the second row replaces the first").toBe(42);
    expect(document.body.innerHTML, "the first row's account must be gone").not.toContain("ACCOUNT-41");

    // 第一行嗰個 deadline 而家到期。如果佢個 interval 仲係孤兒咁行緊，佢會叫
    // `forgetPlaintext()`，而第二行嘅明文就會**早 5 秒**消失。
    //
    // 斷言 `clearInterval` 俾人叫過係唔夠嘅（REV-050 F-L1）：一個「照樣叫
    // clearInterval，但叫錯 handle」嘅實作一樣過關，而個孤兒照樣行。呢度改成睇
    // 行為 —— 第二行夠唔夠命行完佢自己嗰 30 秒。
    vi.advanceTimersByTime(26_000);
    await flushPromises();
    expect(panelVm.revealed.id,
      "the first row's orphaned countdown must not cut the second row short").toBe(42);
    expect(document.body.innerHTML).toContain("ACCOUNT-42");
  });

  /**
   * REV-046 X5：第三個 dialog（設為預設／停用）嘅密碼本來**一個斷言都冇** ——
   * 由 `forgetEverything()` 度剝走佢兩行，19 條測試照樣全綠，而一個打咗一半嘅
   * 密碼就會跨 Supplier 同跨 session 留低。
   */
  it("wipes the confirm dialog's password on a Supplier change and on session expiry", async () => {
    const { router, body } = await mountPanel();
    await body.find('[aria-label="設為預設 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    expect(document.body.innerHTML).toContain("Correct-Horse-1!");

    await router.push("/suppliers/8");
    await flushPromises();
    expect(document.body.innerHTML,
      "a typed step-up password must not survive a Supplier change").not.toContain("Correct-Horse-1!");

    await body.find('[aria-label="停用 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    useSessionStore().user = null;
    await flushPromises();
    expect(document.body.innerHTML, "nor a session expiry").not.toContain("Correct-Horse-1!");
  });

  /**
   * REV-047 F-L1。`revealDialog.busy` 攔住重入 —— REV-046 探過話成立，但**冇嘢
   * 斷言佢**，拆走佢 595 條照綠。冇咗佢，撳兩下「確認查看」會發兩個
   * `POST …/reveal`，而 TASK-034 會為一次意圖上嘅披露寫**兩條**稽核。
   *
   * 呢個同上面嗰條係同一個擔憂嘅兩邊：一個令稽核少講咗，一個令稽核多講咗。兩邊
   * 之間唔可以只得一條斷言。
   */
  it("issues one reveal for a double-clicked confirm, because each one writes an audit row", async () => {
    supplierBankService.reveal.mockReturnValue(new Promise(() => {}));
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await byText(body, "查看完整帳號").trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "查看原因").find("textarea").setValue("核對付款帳號");
    // 兩下撳要喺**同一個 tick** 入面發 —— 中間 await 一次，Vue 就會 re-render，
    // 而個掣 `:loading` 之後 Quasar 會攔住第二下，令個測試分辨唔到有冇個 guard。
    // 真實嘅雙擊就係喺 re-render 之前到達嘅。
    const confirmButton = byText(body, "確認查看");
    confirmButton.trigger("click");
    confirmButton.trigger("click");
    await flushPromises();
    expect(supplierBankService.reveal,
      "a second click must not buy a second audit row").toHaveBeenCalledTimes(1);
  });

  /**
   * REV-046 個 Medium。`forgetPlaintext()` 撳大 generation，而**倒數 tick 都會叫佢**
   * —— 所以另一行嘅 30 秒啱啱喺呢個來回中間到期，就會令一次完全正常嘅 reveal 落到
   * 丟棄嗰條路。伺服器嗰邊已經解咗密、已經寫咗一條「有人睇過」嘅稽核。靜靜雞丟
   * 就會令嗰條稽核對應住一次根本冇出現過喺螢幕上嘅披露。
   */
  it("says so when a reveal is discarded, because the server already audited it", async () => {
    // 第一行：正常展開，個 30 秒倒數開始行。
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: "OTHER-ACCOUNT-99", revealedAt: 1 });
    const { body } = await mountPanel({ permissions: VIEW_BANK });
    await revealRow(body);
    expect(body.text()).toContain("OTHER-ACCOUNT-99");

    // 第二行：開始 reveal，但個 response 仲未返到。
    let resolveReveal;
    supplierBankService.reveal.mockReturnValue(new Promise((resolve) => { resolveReveal = resolve; }));
    await body.find('[aria-label="查看完整帳號 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "查看原因").find("textarea").setValue("核對第二個帳號");
    await byText(body, "確認查看").trigger("click");

    // 第一行嘅 30 秒啱啱喺呢個來回中間到期 —— `forgetPlaintext()` 撳大 generation。
    vi.advanceTimersByTime(31_000);
    await flushPromises();
    expect(document.body.innerHTML).not.toContain("OTHER-ACCOUNT-99");

    resolveReveal({ id: 42, accountNumber: SECRET, revealedAt: 1000 });
    await flushPromises();

    expect(document.body.innerHTML, "a discarded reveal must not show the account").not.toContain(SECRET);
    expect(body.find('[role="alert"]').exists(),
      "a discarded reveal must not be silent: the server audited a disclosure that never reached the screen").toBe(true);
    expect(body.find('[role="alert"]').text()).toMatch(/稽核|重新查看/u);
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
    // REV-046 X12：斷言「clearInterval 有被叫過」唔夠 —— 清一個**唔相干**嘅 handle
    // 一樣過關，而真個倒數照樣漏住。所以先記低個倒數真正攞到嗰個 handle。
    const armed = vi.spyOn(globalThis, "setInterval");
    await revealRow(result.body);
    const countdownHandle = armed.mock.results.at(-1).value;
    armed.mockRestore();
    // Unmount 本身就會拆走個節點，所以單睇 DOM 係一個**唔會失敗**嘅斷言 ——
    // 拆走 onUnmounted(forgetPlaintext) 佢一樣綠（REV-044 M-2）。數總 timer 數一樣
    // 唔得：unmount 會清埋 Quasar 自己嗰堆，個數點都會跌。要盯住嘅係**嗰一個**
    // handle 有冇被 clearInterval 收過。
    const cleared = vi.spyOn(globalThis, "clearInterval");
    result.wrapper.unmount();
    expect(cleared.mock.calls.map((call) => call[0]),
      "unmount must clear the countdown's own handle, not merely call clearInterval").toContain(countdownHandle);
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

  /**
   * REV-047 F-L2。失敗嗰條路個 dialog 係**開住**嘅 —— 成功路徑由 `@hide` 清、
   * route change 同 session 失效由 `forgetEverything()` 清，唯獨錯誤路徑淨係靠
   * `submitConfirm` 個 `finally`，而嗰行本來冇嘢斷言：拆走佢 595 條照綠，而打咗
   * 嘅 step-up 密碼會留喺一個 render 緊嘅 input 度直到使用者自己閂。
   */
  it("wipes the confirm password even when the dialog stays open on an error", async () => {
    supplierBankService.setDefault.mockRejectedValue(
      Object.assign(new Error("這個銀行帳戶已被其他人修改"), { code: "VERSION_CONFLICT" })
    );
    const { body } = await mountPanel();
    await body.find('[aria-label="設為預設 Other Bank"]').trigger("click");
    await flushPromises();
    await field(body, "密碼").find("input").setValue("Correct-Horse-1!");
    await field(body, "原因").find("textarea").setValue("轉出糧戶口");
    await byText(body, "確認").trigger("click");
    await flushPromises();

    expect(body.find('[role="alert"]').exists(), "the dialog stays open to show the conflict").toBe(true);
    expect(document.body.innerHTML,
      "a typed step-up password must not survive a failed attempt").not.toContain("Correct-Horse-1!");
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
