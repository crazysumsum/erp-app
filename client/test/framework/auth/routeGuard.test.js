import { describe, expect, it } from "vitest";
import { createAuthGuard, resolveNavigation } from "@/framework/auth/routeGuard.js";

function session({ authenticated = false, roles = [], permissions = [] } = {}) {
  return { isAuthenticated: authenticated, roles, permissions };
}

describe("resolveNavigation", () => {
  it("public 路由永遠放行，唔理有冇登入", () => {
    const to = { meta: { public: true }, fullPath: "/login" };

    expect(resolveNavigation(to, session())).toEqual({ allow: true });
  });

  it("未登入打 protected 路由會轉去登入頁，帶埋原本路徑等登入後跳返去", () => {
    const to = { meta: {}, fullPath: "/orders/1" };

    expect(resolveNavigation(to, session())).toEqual({
      allow: false,
      redirect: { name: "login", query: { redirect: "/orders/1" } }
    });
  });

  it("已登入但權限唔夠會轉去 403，而唔係登入頁", () => {
    const to = { meta: { requires: { permissions: ["order.delete"] } }, fullPath: "/orders/1" };
    const authenticatedButUnderPermissioned = session({
      authenticated: true,
      permissions: ["order.read"]
    });

    expect(resolveNavigation(to, authenticatedButUnderPermissioned)).toEqual({
      allow: false,
      redirect: { name: "forbidden" }
    });
  });

  it("已登入而且權限夠就放行", () => {
    const to = { meta: { requires: { permissions: ["order.read"] } }, fullPath: "/orders/1" };
    const authorized = session({ authenticated: true, permissions: ["order.read"] });

    expect(resolveNavigation(to, authorized)).toEqual({ allow: true });
  });

  it("已登入而且冇 requires 就放行", () => {
    const to = { meta: {}, fullPath: "/" };

    expect(resolveNavigation(to, session({ authenticated: true }))).toEqual({ allow: true });
  });
});

describe("createAuthGuard", () => {
  it("包住 resolveNavigation：放行回 true，唔放行回 redirect location", () => {
    const guardWhenLoggedOut = createAuthGuard(session());

    expect(guardWhenLoggedOut({ meta: { public: true }, fullPath: "/login" })).toBe(true);
    expect(guardWhenLoggedOut({ meta: {}, fullPath: "/x" })).toEqual({
      name: "login",
      query: { redirect: "/x" }
    });
  });
});
