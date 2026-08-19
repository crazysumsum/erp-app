import { describe, expect, it } from "vitest";
import { buildRoutes } from "@/framework/routing/buildRoutes.js";

const LoginComponent = {};
const HomeComponent = {};
const OrdersComponent = {};

function discoveredPages() {
  return [
    { page: { name: "login", path: "/login", title: "登入", public: true }, component: LoginComponent },
    { page: { name: "home", path: "/", title: "首頁" }, component: HomeComponent },
    {
      page: { name: "orderList", path: "/orders", title: "訂單管理", requires: { permissions: ["order.read"] } },
      component: OrdersComponent
    }
  ];
}

describe("buildRoutes", () => {
  it("public 頁面留喺頂層，帶埋 meta.public", () => {
    const routes = buildRoutes(discoveredPages());
    const loginRoute = routes.find((route) => route.name === "login");

    expect(loginRoute).toMatchObject({ path: "/login", component: LoginComponent, meta: { public: true } });
  });

  it("非 public 頁面包做 AppShell 呢個父路由嘅 children，path 斬走開頭嘅「/」", () => {
    const routes = buildRoutes(discoveredPages());
    const shellRoute = routes.find((route) => route.path === "/" && route.children);

    expect(shellRoute.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "home", path: "", component: HomeComponent }),
        expect.objectContaining({ name: "orderList", path: "orders", component: OrdersComponent })
      ])
    );
  });

  it("非 public 頁面嘅 meta.requires 會原樣傳落 route.meta", () => {
    const routes = buildRoutes(discoveredPages());
    const shellRoute = routes.find((route) => route.path === "/" && route.children);
    const ordersRoute = shellRoute.children.find((route) => route.name === "orderList");

    expect(ordersRoute.meta.requires).toEqual({ permissions: ["order.read"] });
  });

  it("唔理有冇 discovered pages，403 同 404 都一定喺度", () => {
    const routes = buildRoutes([]);

    expect(routes.find((route) => route.path === "/403")).toMatchObject({ name: "forbidden", meta: { public: true } });
    expect(routes.find((route) => route.name === "not-found")).toMatchObject({
      path: "/:pathMatch(.*)*",
      meta: { public: true }
    });
  });
});
