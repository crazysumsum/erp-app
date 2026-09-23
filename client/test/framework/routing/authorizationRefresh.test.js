import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";
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
