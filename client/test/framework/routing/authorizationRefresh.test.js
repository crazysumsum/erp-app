import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { h } from "vue";
import { RouterView, createMemoryHistory } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplier.js", () => ({
  default: { getById: vi.fn(), completeness: vi.fn() }, service: { name: "supplier" }
}));
vi.mock("@/services/supplierBank.js", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setDefault: vi.fn(), deactivate: vi.fn(), reveal: vi.fn() },
  service: { name: "supplierBank" }
}));
vi.mock("@/services/businessMaster.js", () => ({
  default: { currencyList: vi.fn().mockResolvedValue({ rows: [] }), paymentTermList: vi.fn().mockResolvedValue({ rows: [] }) },
  service: { name: "businessMaster" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import supplierService from "@/services/supplier.js";
import supplierBankService from "@/services/supplierBank.js";
import SupplierDetailPage, { page as supplierDetailPage } from "@/pages/suppliers/SupplierDetailPage.vue";
import { createAppRouter } from "@/framework/routing/router.js";
import { useSessionStore } from "@/stores/session.js";
import { installFakeLocalStorage } from "../../support/fakeLocalStorage.js";

/**
 * session.refresh() 換走成個 user object（見 stores/session.js）。守衛只喺導航
 * 嗰陣行過一次，所以呢幾個案例全部唔經 push()——刻意模擬「用戶坐喺原地冇郁，
 * 而佢嘅權限喺背景被撤走」。
 */
/**
 * 重新評估之後嗰次 router.replace() 係一連串 microtask（守衛、解析、confirm），
 * 一個 nextTick() 唔夠——測過淨係 nextTick 嘅話，就算真係跳咗都仲會讀到舊路由。
 * 借一個 macrotask 一次過抽乾所有待處理嘅 microtask：呢度冇真正嘅 async 工作
 * （memory history、同步守衛），所以係確定性嘅，唔係「瞓一陣算數」。
 *
 * 正反兩種案例都用同一個等待：反面案例等得太短嘅話，就算個機制真係錯到無條件
 * 踢人走，嗰幾個測試一樣會綠——即係一個永遠唔會紅嘅檢查。
 */
function flushNavigation() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function refreshInto(session, permissions) {
  session.user = { id: 1, username: "sam", roles: [], permissions };
  return flushNavigation();
}

function routerAt(session) {
  return createAppRouter({ session, history: createMemoryHistory() });
}

describe("續期之後重新評估授權", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    // session.clear() 會經 tokenStorage 寫 localStorage，而呢個 jsdom 冇提供。
    installFakeLocalStorage();
  });

  it("撤走頁面要求嘅權限，人會即刻由嗰頁被導去 403，唔使等佢自己導航", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouter = routerAt(session);
    await appRouter.push("/items/categories");
    expect(appRouter.currentRoute.value.name).toBe("categories");

    await refreshInto(session, []);

    expect(appRouter.currentRoute.value.name).toBe("forbidden");
  });

  // 反面對照：冇呢個案例，上面嗰個「撤權就跳走」淨係證明咗「user 一換就跳走」，
  // 而唔係「權限唔夠先跳走」——一個無條件 replace 都會令上面嗰個綠。
  it("續期回一組一樣嘅權限唔會郁到人——續期每 15 分鐘一次，唔可以次次踢走佢", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouter = routerAt(session);
    await appRouter.push("/items/categories");

    await refreshInto(session, ["item.mgmt"]);

    expect(appRouter.currentRoute.value.name).toBe("categories");
  });

  it("續期加咗權限唔會郁到人", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouter = routerAt(session);
    await appRouter.push("/items/categories");

    await refreshInto(session, ["item.mgmt", "item.view"]);

    expect(appRouter.currentRoute.value.name).toBe("categories");
  });

  // 撤走嘅權限同當前頁無關嗰陣唔應該郁——例如 supplier.bank.* 咁嘅頁內權限，
  // 個頁本身淨係要求 supplier.view。呢種情況由元件自己嘅 computed 處理。
  it("撤走一個同當前頁無關嘅權限唔會郁到人", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt", "supplier.bank.view"] };
    const appRouter = routerAt(session);
    await appRouter.push("/items/categories");

    await refreshInto(session, ["item.mgmt"]);

    expect(appRouter.currentRoute.value.name).toBe("categories");
  });


  // 登出唔應該行呢條路：行咗嘅話用戶會落喺 /login?redirect=<啱啱嗰頁>，
  // 再登入就彈返入去——同「我要登出」嘅意思相反。
  it("清 session（登出／401）唔會由呢個機制帶走，留返畀原本嗰兩條登出路徑", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouter = routerAt(session);
    await appRouter.push("/items/categories");

    session.clear();
    await flushNavigation();

    expect(appRouter.currentRoute.value.name).toBe("categories");
  });
});

/**
 * 呢兩個案例用真 `SupplierDetailPage` + 真 `createAppRouter`，因為佢哋問嘅係
 * **兩個修法夾唔夾得埋**，唔係其中一個自己啱唔啱。
 *
 * 現有嘅測試各自證到一半：`bank.test.js` 嗰個 session watch 案例用一個冇守衛嘅
 * 合成 router，而上面幾個案例用嘅頁面冇頁內權限。兩者都唔會發現「加咗守衛之後
 * 個 panel 反而清唔到」或者相反。
 *
 * 兩條路係互補嘅，唔係冗餘：
 *   - 撤 supplier.view（頁本身要求）→ 守衛踢走 → unmount → forgetEverything()
 *   - 撤 supplier.bank.view（淨係 panel 要求）→ 守衛**唔應該**郁（佢仲入得呢頁）
 *     → 得 panel 自己個 watch 清到明文
 * 所以 panel 嗰個 watch 唔可以由呢個框架機制取代。
 */
describe("同 SupplierBankPanel 夾埋", () => {
  const SECRET = "1234567890123456";
  // `attachTo: document.body` 會留低一個掛住嘅 app：淨係清 innerHTML 唔會 unmount
  // 佢，上一個案例嘅 DOM 同 watcher 會跟住入下一個。試過唔清——一個案例一紅，
  // 下一個就搵唔到自己嗰粒掣。
  let mounted = [];
  afterEach(() => {
    for (const w of mounted) w.unmount();
    mounted = [];
    document.body.innerHTML = "";
  });

  async function mountDetail(permissions) {
    supplierService.getById.mockResolvedValue({
      id: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen",
      defaultCurrencyCode: "HKD", defaultPaymentTermId: null, status: "active", version: 2,
      website: "", generalPhone: "", generalEmail: "", notes: "",
      createdAt: 100, updatedAt: 200, addresses: [], contacts: [], identifiers: [],
      bankAccounts: [], warnings: []
    });
    supplierService.completeness.mockResolvedValue({ supplierId: 7, issues: [], warnings: [] });
    supplierBankService.list.mockResolvedValue([{
      id: 41, bankName: "Test Bank", accountHolderName: "Evergreen Trading",
      maskedAccountNumber: "•••• 3456", status: "active", isDefault: true, version: 1
    }]);
    supplierBankService.reveal.mockResolvedValue({ id: 41, accountNumber: SECRET, revealedAt: 1000 });

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions };
    const appRouter = createAppRouter({
      session,
      history: createMemoryHistory(),
      pages: [{ page: supplierDetailPage, component: SupplierDetailPage }]
    });
    await appRouter.push("/suppliers/7");
    await appRouter.isReady();
    const wrapper = mount({ render: () => h(RouterView) },
      { global: { plugins: [Quasar, appRouter] }, attachTo: document.body });
    mounted.push(wrapper);
    await flushPromises();

    const body = new DOMWrapper(document.body);
    await body.findAll(".q-tab").find((t) => t.text().includes("銀行資料")).trigger("click");
    await flushPromises();
    return { wrapper, appRouter, body, session };
  }

  async function reveal(body) {
    await body.findAll(".q-btn").find((b) => b.text().includes("查看完整帳號")).trigger("click");
    await flushPromises();
    await body.findAll(".q-field").find((f) => f.text().includes("密碼")).find("input")
      .setValue("Correct-Horse-1!");
    await body.findAll(".q-field").find((f) => f.text().includes("查看原因")).find("textarea")
      .setValue("核對付款帳號");
    await body.findAll(".q-btn").find((b) => b.text().includes("確認查看")).trigger("click");
    await flushPromises();
  }

  it("撤走頁內權限（supplier.bank.view）：守衛唔郁人，但明文要冇咗", async () => {
    const { body, appRouter, session } = await mountDetail(["supplier.view", "supplier.bank.view"]);
    await reveal(body);
    expect(document.body.innerHTML).toContain(SECRET);

    session.user = { id: 1, username: "sam", roles: [], permissions: ["supplier.view"] };
    await flushPromises();
    await flushNavigation();

    expect(appRouter.currentRoute.value.name,
      "佢仲有 supplier.view，唔應該被踢出呢一頁").toBe("supplier-detail");
    expect(document.body.innerHTML,
      "守衛幫唔到手嗰陣，要靠 panel 自己個 watch 清明文").not.toContain(SECRET);
  });

  it("撤走頁面權限（supplier.view）：守衛踢去 403，unmount 順手清走明文", async () => {
    const { body, appRouter, session } = await mountDetail(["supplier.view", "supplier.bank.view"]);
    await reveal(body);
    expect(document.body.innerHTML).toContain(SECRET);

    session.user = { id: 1, username: "sam", roles: [], permissions: ["supplier.bank.view"] };
    await flushPromises();
    await flushNavigation();
    await flushPromises();

    expect(appRouter.currentRoute.value.name).toBe("forbidden");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});
