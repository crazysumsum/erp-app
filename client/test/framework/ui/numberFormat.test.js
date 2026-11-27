import { describe, expect, it } from "vitest";
import { formatMoney, formatQuantity } from "@/framework/ui/numberFormat.js";

describe("formatMoney", () => {
  it("uses the currency precision unless the caller supplies its own", () => {
    expect(formatMoney("1234567.5", "HKD")).toBe("1,234,567.50");
    expect(formatMoney("1234.5", "JPY")).toBe("1,235");
    expect(formatMoney("-1234.5", "HKD")).toBe("-1,234.50");
    expect(formatMoney("1.2345", "HKD", 4)).toBe("1.2345");
  });

  it("preserves source precision for unknown or unspecified currencies", () => {
    expect(formatMoney("1234.56789", "XYZ")).toBe("1,234.56789");
    expect(formatMoney("1234.5000")).toBe("1,234.5000");
  });

  it("keeps significant digits beyond the safe integer range", () => {
    expect(formatMoney("12345678901234567.89", "HKD")).toBe("12,345,678,901,234,567.89");
  });

  it("preserves nonnumeric text and labels missing values", () => {
    expect(formatMoney("待確認", "HKD")).toBe("待確認");
    expect(formatMoney(null, "HKD")).toBe("—");
    expect(formatMoney("", "HKD")).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("removes only fractional trailing zeros", () => {
    expect(formatQuantity("2.000000")).toBe("2");
    expect(formatQuantity("-0.500")).toBe("-0.5");
    expect(formatQuantity("1200")).toBe("1200");
    expect(formatQuantity("12345678901234567.00100")).toBe("12345678901234567.001");
  });
});
