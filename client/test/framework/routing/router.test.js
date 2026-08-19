import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";
import { createAppRouter } from "@/framework/routing/router.js";
import { useSessionStore } from "@/stores/session.js";

/**
 * 用 createMemoryHistory 而唔係真正嘅 createWebHistory：後者綁住瀏覽器 history
 * API，多個測試共用同一個 jsdom window 會互相干擾（見 router.js 頂部註解）。
 */
function router(session) {
  return createAppRouter({ session, history: createMemoryHistory() });
}

describe("createAppRouter", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("未登入打 protected 路由會被導去登入頁，帶埋原本路徑", async () => {
    const session = useSessionStore();
    const appRouter = router(session);

    await appRouter.push("/");

    expect(appRouter.currentRoute.value.name).toBe("login");
    expect(appRouter.currentRoute.value.query.redirect).toBe("/");
  });

  it("已登入就可以直接去 protected 路由", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: [] };
    const appRouter = router(session);

    await appRouter.push("/");

    expect(appRouter.currentRoute.value.name).toBe("home");
  });

  it("public 路由（login）唔使登入都去得", async () => {
    const session = useSessionStore();
    const appRouter = router(session);

    await appRouter.push("/login");

    expect(appRouter.currentRoute.value.name).toBe("login");
  });
});
