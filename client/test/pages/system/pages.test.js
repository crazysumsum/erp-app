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

  it("items 呢個 menu group 入面每一頁嘅 order 都唔可以撞", () => {
    const itemsPages = discoverPages()
      .map(({ page }) => page)
      .filter((page) => page.menu?.group === "items");

    const orders = itemsPages.map((page) => page.menu.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("Category／Brand／UOM 呢三頁純管理，要 item.mgmt——冇 read-only 用途，item.view 唔應該見到呢幾頁", () => {
    const pages = Object.fromEntries(discoverPages().map(({ page }) => [page.name, page]));

    expect(pages.categories.requires).toEqual({ permissions: ["item.mgmt"] });
    expect(pages.brands.requires).toEqual({ permissions: ["item.mgmt"] });
    expect(pages.uoms.requires).toEqual({ permissions: ["item.mgmt"] });
  });
});
