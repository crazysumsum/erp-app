import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCsvCell } from "../src/modules/item/csvSafety.js";

test("開頭係 =／+／-／@ 就前面加單引號，等試算表當純文字唔會執行做公式", () => {
  assert.equal(sanitizeCsvCell("=1+1"), "'=1+1");
  assert.equal(sanitizeCsvCell("+1"), "'+1");
  assert.equal(sanitizeCsvCell("-1"), "'-1");
  assert.equal(sanitizeCsvCell("@SUM(A1)"), "'@SUM(A1)");
});

test("開頭係 tab／CR 都算觸發字元", () => {
  assert.equal(sanitizeCsvCell("\t=cmd"), "'\t=cmd");
  assert.equal(sanitizeCsvCell("\rfoo"), "'\rfoo");
});

test("普通字串（包括中間有呢幾隻字元）原樣返回", () => {
  assert.equal(sanitizeCsvCell("維他命 C 90 粒裝"), "維他命 C 90 粒裝");
  assert.equal(sanitizeCsvCell("VITC-90"), "VITC-90");
  assert.equal(sanitizeCsvCell("A=B"), "A=B");
});

test("空字串、null、undefined、非字串原樣返回，唔會拋錯", () => {
  assert.equal(sanitizeCsvCell(""), "");
  assert.equal(sanitizeCsvCell(null), null);
  assert.equal(sanitizeCsvCell(undefined), undefined);
  assert.equal(sanitizeCsvCell(123), 123);
});
