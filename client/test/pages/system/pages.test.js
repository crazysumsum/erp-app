import { describe, expect, it } from "vitest";
import { discoverPages } from "@/framework/discovery/pages.js";
import { validatePages } from "@/framework/discovery/validatePages.js";

describe("Phase 5 頁面 metadata", () => {
  it("真正嘅頁面 metadata 過得到開機驗證", () => {
    expect(validatePages(discoverPages())).toEqual([]);
  });

  it("用戶管理要 user.mgmt，角色管理要 role.mgmt，修改密碼頁已登入即可", () => {
    const pages = Object.fromEntries(discoverPages().map(({ page }) => [page.name, page]));

    expect(pages.users.requires).toEqual({ permissions: ["user.mgmt"] });
    expect(pages.roles.requires).toEqual({ permissions: ["role.mgmt"] });
    expect(pages["change-password"].requires).toBeUndefined();
    expect(pages["change-password"].public).toBeUndefined();
    expect(pages["change-password"].menu).toBeUndefined();
  });

  it("system 呢個 menu group 入面每一頁嘅 order 都唔可以撞", () => {
    const systemPages = discoverPages()
      .map(({ page }) => page)
      .filter((page) => page.menu?.group === "system");

    const orders = systemPages.map((page) => page.menu.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
