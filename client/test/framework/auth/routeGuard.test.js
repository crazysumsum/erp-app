import { describe, expect, it } from "vitest";
import { createAuthGuard, resolveNavigation } from "@/framework/auth/routeGuard.js";

function session({ authenticated = false, roles = [], permissions = [], mustChangePassword = false } = {}) {
  return {
    isAuthenticated: authenticated,
    roles,
    permissions,
    user: authenticated ? { mustChangePassword } : null
  };
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

  it("mustChangePassword 嘅使用者打任何頁都會轉去改密碼頁，即使權限本身夠", () => {
    const to = { name: "orders", meta: { requires: { permissions: ["order.read"] } }, fullPath: "/orders" };
    const forcedChange = session({ authenticated: true, permissions: ["order.read"], mustChangePassword: true });

    expect(resolveNavigation(to, forcedChange)).toEqual({
      allow: false,
      redirect: { name: "change-password" }
    });
  });

  it("mustChangePassword 唔會擋改密碼頁本身，否則使用者永遠去唔到", () => {
    const to = { name: "change-password", meta: {}, fullPath: "/password/change" };
    const forcedChange = session({ authenticated: true, mustChangePassword: true });

    expect(resolveNavigation(to, forcedChange)).toEqual({ allow: true });
  });

  it("mustChangePassword 排喺權限檢查之前：權限唔夠都係轉去改密碼頁，唔係 403", () => {
    const to = { name: "orders", meta: { requires: { permissions: ["order.delete"] } }, fullPath: "/orders" };
    const forcedChange = session({ authenticated: true, permissions: [], mustChangePassword: true });

    expect(resolveNavigation(to, forcedChange)).toEqual({
      allow: false,
      redirect: { name: "change-password" }
    });
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
