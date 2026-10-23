import { describe, expect, it } from "vitest";

// AUTH-001 嘅頁面一半：Supplier 頁面冇一個係 public，每個都宣告權限，router guard 先會擋匿名導航（REV-096 M-3）。
const pages = import.meta.glob("@/pages/suppliers/*.vue", { eager: true });

describe("Supplier page guards", () => {
  it("TC-121 (UI-001): every Supplier page requires permissions and none is public", () => {
    const entries = Object.entries(pages);
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const [file, module] of entries) {
      expect(module.page, file).toBeTruthy();
      expect(module.page.public, file).not.toBe(true);
      expect(module.page.requires?.permissions?.length, file).toBeGreaterThan(0);
    }
  });
});
