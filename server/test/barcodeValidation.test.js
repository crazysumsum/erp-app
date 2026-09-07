import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBarcode } from "../src/modules/item/barcodeValidation.js";

/**
 * 四組 check digit 已經用一份跟實作完全獨立的小算式驗算過（見 PR 說明），
 * 不是「跑一次自己的實作、把輸出貼過來當期望值」那種循環論證：
 * - EAN-13 4006381333931：常見於條碼函式庫的範例值。
 * - UPC-A 036000291452：同上。
 * - GTIN-8 12345670、GTIN-14 12345678901231：手算驗證，body 用連號數字方便核對，check digit 都用同一條 GS1 演算法獨立算過一次。
 */
const VALID_GTINS = {
  gtin8: "12345670",
  upca: "036000291452",
  ean13: "4006381333931",
  gtin14: "12345678901231"
};

test("每種 GTIN 類型：合法 check digit 通過，正規化後回傳純數字", () => {
  for (const [type, code] of Object.entries(VALID_GTINS)) {
    assert.equal(normalizeBarcode(code, type), code, `${type} ${code} 應該通過`);
  }
});

test("GTIN：移除空格與連字號之後再驗證，不是直接拒絕", () => {
  assert.equal(normalizeBarcode("4006-3813-33931", "ean13"), "4006381333931");
  assert.equal(normalizeBarcode("400 638 133 3931", "ean13"), "4006381333931");
  assert.equal(normalizeBarcode(" 4006381333931 ", "ean13"), "4006381333931");
});

test("GTIN：長度不對就拒絕，不會被誤判成別種類型", () => {
  for (const [type, code] of Object.entries(VALID_GTINS)) {
    assert.throws(() => normalizeBarcode(code.slice(1), type), { code: "GTIN_INVALID" });
    assert.throws(() => normalizeBarcode(`${code}0`, type), { code: "GTIN_INVALID" });
  }
});

test("GTIN：check digit 錯誤就拒絕", () => {
  for (const [type, code] of Object.entries(VALID_GTINS)) {
    const lastDigit = Number(code.at(-1));
    const wrongLastDigit = (lastDigit + 1) % 10;
    const tampered = code.slice(0, -1) + wrongLastDigit;
    assert.throws(() => normalizeBarcode(tampered, type), { code: "GTIN_INVALID" });
  }
});

test("GTIN：移除空格連字號之後仍有非數字字元就拒絕，包含 Unicode 全形數字", () => {
  assert.throws(() => normalizeBarcode("400638133393X", "ean13"), { code: "GTIN_INVALID" });
  // 全形數字（U+FF10-FF19）視覺上像數字，但 /^\d+$/ 冇 u flag／Unicode
  // property escape 嘅話唔會當佢係 \d——刻意驗證呢個假設冇被之後
  // 嘅改動推翻。
  assert.throws(() => normalizeBarcode("４００６３８１３３３９３１", "ean13"), { code: "GTIN_INVALID" });
  assert.throws(() => normalizeBarcode("", "ean13"), { code: "GTIN_INVALID" });
});

test("internal：trim 首尾空白，接受任意非控制字元（包括Unicode）", () => {
  assert.equal(normalizeBarcode("  ITM-0001  ", "internal"), "ITM-0001");
  assert.equal(normalizeBarcode("內部條碼-001", "internal"), "內部條碼-001");
});

test("internal：拒絕空字串、控制字元，以及超過 190 字元；一般空白（非首尾）唔算控制字元", () => {
  assert.throws(() => normalizeBarcode("   ", "internal"), { code: "GTIN_INVALID" });
  assert.throws(() => normalizeBarcode("bad" + String.fromCharCode(9) + "value", "internal"), { code: "GTIN_INVALID" });
  assert.throws(() => normalizeBarcode("bad" + String.fromCharCode(0) + "value", "internal"), { code: "GTIN_INVALID" });
  assert.throws(() => normalizeBarcode("bad" + String.fromCharCode(127) + "value", "internal"), { code: "GTIN_INVALID" });
  // 中間有一般空白唔係控制字元，規格只要求 trim 首尾，唔要求成串冇空白。
  assert.equal(normalizeBarcode("bad value", "internal"), "bad value");

  assert.equal(normalizeBarcode("a".repeat(190), "internal"), "a".repeat(190));
  assert.throws(() => normalizeBarcode("a".repeat(191), "internal"), { code: "GTIN_INVALID" });
});
