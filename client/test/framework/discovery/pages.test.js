import { describe, expect, it } from "vitest";
import { discoverPages } from "@/framework/discovery/pages.js";

describe("discoverPages", () => {
  it("將 glob 結果轉做 { filePath, page, component } 陣列", () => {
    const fakePageComponent = {};
    const globModules = {
      "../../pages/orders.vue": { page: { name: "orderList", path: "/orders" }, default: fakePageComponent }
    };

    const result = discoverPages(globModules);

    expect(result).toEqual([
      { filePath: "../../pages/orders.vue", page: { name: "orderList", path: "/orders" }, component: fakePageComponent }
    ]);
  });

  it("唔傳 globModules 就用真正 pages 目錄嘅結果，搵到 login 同 home", () => {
    const result = discoverPages();
    const names = result.map(({ page }) => page.name);

    expect(names).toContain("login");
    expect(names).toContain("home");
  });
});
