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

  it("有 item.mgmt 先入得 /items/categories，冇就導去 /403", async () => {
    const withPermission = useSessionStore();
    withPermission.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouterWithPermission = router(withPermission);
    await appRouterWithPermission.push("/items/categories");
    expect(appRouterWithPermission.currentRoute.value.name).toBe("categories");

    const withoutPermission = useSessionStore();
    withoutPermission.user = { id: 1, username: "sam", roles: [], permissions: [] };
    const appRouterWithoutPermission = router(withoutPermission);
    await appRouterWithoutPermission.push("/items/categories");
    expect(appRouterWithoutPermission.currentRoute.value.name).toBe("forbidden");
  });

  it("/items/categories、/items/brands、/items/uoms 都係各自獨立嘅 static route，唔會撞名", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.mgmt"] };
    const appRouter = router(session);

    await appRouter.push("/items/brands");
    expect(appRouter.currentRoute.value.name).toBe("brands");

    await appRouter.push("/items/uoms");
    expect(appRouter.currentRoute.value.name).toBe("uoms");
  });

  /**
   * `/items/:id`（Item 詳情頁）要等 Phase B 先會加，但呢度提前用一份假嘅
   * discovered pages 證明：即使 dynamic route 喺 discovery 順序中排喺 static
   * route 前面，vue-router 都唔會誤將 /items/categories 接去 /items/:id——呢個
   * 係 vue-router 4 本身嘅路徑匹配規則（static 優先於 dynamic），唔靠登記順序，
   * 但寫一條測試釘住呢個假設，避免將來真係加咗 /items/:id 之後靜靜哋回歸。
   * 見 docs/items_management/design_spec.md §11.3。
   */
  it("即使 discovery 順序將 dynamic /items/:id 排喺 static /items/categories 前面，都唔會誤接", async () => {
    const ItemDetailComponent = {};
    const CategoriesComponent = {};
    const fixturePages = [
      {
        page: {
          name: "itemDetail",
          path: "/items/:id",
          title: "商品詳情",
          requires: { permissions: ["item.view"] }
        },
        component: ItemDetailComponent
      },
      {
        page: {
          name: "categories",
          path: "/items/categories",
          title: "商品分類",
          requires: { permissions: ["item.mgmt"] }
        },
        component: CategoriesComponent
      }
    ];

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["item.view", "item.mgmt"] };
    const appRouter = createAppRouter({ session, history: createMemoryHistory(), pages: fixturePages });

    await appRouter.push("/items/categories");
    expect(appRouter.currentRoute.value.name).toBe("categories");

    await appRouter.push("/items/999");
    expect(appRouter.currentRoute.value.name).toBe("itemDetail");
    expect(appRouter.currentRoute.value.params.id).toBe("999");
  });
});
