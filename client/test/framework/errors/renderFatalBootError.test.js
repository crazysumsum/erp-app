import { describe, expect, it } from "vitest";
import { renderFatalBootError } from "@/framework/errors/renderFatalBootError.js";

describe("renderFatalBootError", () => {
  it("將每個錯誤列出，帶埋檔案路徑同訊息", () => {
    const container = document.createElement("div");

    renderFatalBootError(container, [
      { filePath: "src/pages/orders.vue", message: "page.name 重複：「orderList」" }
    ]);

    expect(container.textContent).toContain("src/pages/orders.vue");
    expect(container.textContent).toContain("page.name 重複：「orderList」");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("HTML 特殊字元會被跳脫，唔會當做 markup 插入", () => {
    const container = document.createElement("div");

    renderFatalBootError(container, [{ filePath: "<script>", message: "x" }]);

    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });
});
