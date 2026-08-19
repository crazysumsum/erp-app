import { describe, expect, it } from "vitest";
import { buildMenu } from "@/framework/discovery/buildMenu.js";

function session({ authenticated = true, roles = [], permissions = [] } = {}) {
  return { isAuthenticated: authenticated, roles, permissions };
}

function page(overrides) {
  return { page: { name: "x", path: "/x", title: "X", ...overrides } };
}

describe("buildMenu", () => {
  it("冇 menu 欄位嘅頁面唔會出現喺菜單", () => {
    const menu = buildMenu([page({ name: "detail", path: "/orders/1", title: "訂單詳情" })], session());

    expect(menu.flatMap((group) => group.items)).toHaveLength(0);
  });

  it("group 入面嘅項目跟 menu.order 排", () => {
    const pages = [
      page({ name: "b", path: "/b", title: "B", menu: { group: "system", order: 20, icon: "b" } }),
      page({ name: "a", path: "/a", title: "A", menu: { group: "system", order: 10, icon: "a" } })
    ];

    const menu = buildMenu(pages, session());

    expect(menu[0].items.map((item) => item.name)).toEqual(["a", "b"]);
  });

  it("permissions 唔夠會被自動過濾，唔會出現喺菜單", () => {
    const pages = [
      page({
        name: "orderDelete",
        path: "/orders/delete",
        title: "刪除訂單",
        menu: { group: "system", order: 10, icon: "delete" },
        requires: { permissions: ["order.delete"] }
      })
    ];

    expect(buildMenu(pages, session({ permissions: [] })).flatMap((g) => g.items)).toHaveLength(0);
    expect(
      buildMenu(pages, session({ permissions: ["order.delete"] })).flatMap((g) => g.items)
    ).toHaveLength(1);
  });

  it("冇項目嘅 group 唔會出現喺結果入面", () => {
    const menu = buildMenu([], session());

    expect(menu).toEqual([]);
  });

  it("有項目嘅 group 保留晒 config 入面嘅 label／icon／order", () => {
    const pages = [page({ name: "a", path: "/a", title: "A", menu: { group: "system", order: 10, icon: "a" } })];

    const menu = buildMenu(pages, session());

    expect(menu[0]).toMatchObject({ name: "system", label: "系統管理", icon: "settings", order: 900 });
  });
});
