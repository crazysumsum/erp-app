import { describe, expect, it } from "vitest";
import { validatePages } from "@/framework/discovery/validatePages.js";

const component = {};

function discovered(overrides = {}) {
  return [
    {
      filePath: "src/pages/orders.vue",
      component,
      page: {
        name: "orderList",
        path: "/orders",
        title: "訂單管理",
        menu: { group: "system", order: 10, icon: "receipt" },
        ...overrides
      }
    }
  ];
}

describe("validatePages", () => {
  it("合法 metadata 唔會有錯誤", () => {
    expect(validatePages(discovered())).toEqual([]);
  });

  it("冇 export const page 會報錯，唔會繼續檢查其他規則", () => {
    const errors = validatePages([{ filePath: "src/pages/broken.vue", page: undefined, component }]);

    expect(errors).toEqual([{ filePath: "src/pages/broken.vue", message: "冇 export const page" }]);
  });

  it("冇 export default（component）會報錯", () => {
    const errors = validatePages([
      { filePath: "src/pages/broken.vue", page: { name: "x", path: "/x", title: "X" }, component: undefined }
    ]);

    expect(errors).toEqual([{ filePath: "src/pages/broken.vue", message: "冇 export default（Vue 元件本身）" }]);
  });

  it.each(["name", "path", "title"])("缺 page.%s 會報錯", (field) => {
    const errors = validatePages(discovered({ [field]: undefined }));

    expect(errors).toContainEqual({ filePath: "src/pages/orders.vue", message: `page.${field} 必須係非空字串` });
  });

  it("page.path 冇以「/」開頭會報錯", () => {
    const errors = validatePages(discovered({ path: "orders" }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.path 必須以「/」開頭：「orders」"
    });
  });

  it("兩個頁面撞 name 會報錯，並且指名邊個檔案", () => {
    const pages = [
      ...discovered(),
      {
        filePath: "src/pages/duplicateOrders.vue",
        component,
        page: { name: "orderList", path: "/orders2", title: "又係訂單" }
      }
    ];

    const errors = validatePages(pages);

    expect(errors).toContainEqual({
      filePath: "src/pages/duplicateOrders.vue",
      message: "page.name 重複：「orderList」（同 src/pages/orders.vue 撞）"
    });
  });

  it("兩個頁面撞 path 會報錯，並且指名邊個檔案", () => {
    const pages = [
      ...discovered(),
      {
        filePath: "src/pages/duplicatePath.vue",
        component,
        page: { name: "orderList2", path: "/orders", title: "又係訂單" }
      }
    ];

    const errors = validatePages(pages);

    expect(errors).toContainEqual({
      filePath: "src/pages/duplicatePath.vue",
      message: "page.path 重複：「/orders」（同 src/pages/orders.vue 撞）"
    });
  });

  it("page.public 唔係 boolean 會報錯", () => {
    const errors = validatePages(discovered({ public: "yes" }));

    expect(errors).toContainEqual({ filePath: "src/pages/orders.vue", message: "page.public 必須係 boolean" });
  });

  it("page.menu.group 冇喺 config/menu.js 定義會報錯", () => {
    const errors = validatePages(discovered({ menu: { group: "sales", order: 10, icon: "receipt" } }));

    expect(errors.some((error) => error.message.includes("page.menu.group"))).toBe(true);
  });

  it("page.menu.order 唔係數字會報錯", () => {
    const errors = validatePages(discovered({ menu: { group: "system", order: "10", icon: "receipt" } }));

    expect(errors).toContainEqual({ filePath: "src/pages/orders.vue", message: "page.menu.order 必須係數字" });
  });

  it("page.menu.icon 唔係非空字串會報錯", () => {
    const errors = validatePages(discovered({ menu: { group: "system", order: 10, icon: "" } }));

    expect(errors).toContainEqual({ filePath: "src/pages/orders.vue", message: "page.menu.icon 必須係非空字串" });
  });

  it("page.requires.permissions 唔係字串陣列會報錯", () => {
    const errors = validatePages(discovered({ menu: undefined, requires: { permissions: "order.read" } }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.requires.permissions 必須係非空字串陣列"
    });
  });

  it("page.requires.match 唔係 all/any 會報錯", () => {
    const errors = validatePages(
      discovered({ menu: undefined, requires: { permissions: ["order.read"], match: "everything" } })
    );

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: 'page.requires.match 必須係 "all" 或 "any"'
    });
  });

  it("合法 requires 唔會報錯", () => {
    const errors = validatePages(
      discovered({ menu: undefined, requires: { roles: ["admin"], permissions: ["order.read"], match: "any" } })
    );

    expect(errors).toEqual([]);
  });

  it("page.requires 冇 roles 亦冇 permissions 會報錯（唔可以 fail-open）", () => {
    const errors = validatePages(discovered({ menu: undefined, requires: {} }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.requires 必須至少設定 roles 或 permissions 其中一個"
    });
  });

  it("page.requires.roles 係空陣列會報錯（唔可以 fail-open）", () => {
    const errors = validatePages(discovered({ menu: undefined, requires: { roles: [] } }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.requires.roles 必須係非空字串陣列"
    });
  });

  it("page.requires.permissions 係空陣列會報錯（唔可以 fail-open）", () => {
    const errors = validatePages(discovered({ menu: undefined, requires: { permissions: [] } }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.requires.permissions 必須係非空字串陣列"
    });
  });

  it("page.requires 有未知欄位（例如拼錯 permission）會報錯", () => {
    const errors = validatePages(discovered({ menu: undefined, requires: { permission: ["order.read"] } }));

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.requires 有未知欄位：「permission」"
    });
  });

  it("page.public 同 page.requires 同時設定會報錯", () => {
    const errors = validatePages(
      discovered({ menu: undefined, public: true, requires: { roles: ["admin"] } })
    );

    expect(errors).toContainEqual({
      filePath: "src/pages/orders.vue",
      message: "page.public 同 page.requires 唔可以同時設定"
    });
  });
});
