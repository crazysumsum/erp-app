/**
 * `variantSignature.js` 嘅純函式行為。設計說明見
 * docs/items_management/design_spec.md §4.4；canonical form／分隔符號／
 * Unicode normalization 呢幾個細節嘅確認見 variantSignature.js 檔頭註解。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { computeVariantSignature, typedValueToCanonicalString } from "../src/modules/item/variantSignature.js";

// --- computeVariantSignature -------------------------------------------------

test("輸入順序唔影響結果：排序之後先計 hash", () => {
  const a = computeVariantSignature([
    { attributeId: 1, typedValue: "red" },
    { attributeId: 2, typedValue: "M" }
  ]);
  const b = computeVariantSignature([
    { attributeId: 2, typedValue: "M" },
    { attributeId: 1, typedValue: "red" }
  ]);

  assert.equal(a, b);
});

test("回傳 64 字元嘅 hex 字串", () => {
  const signature = computeVariantSignature([{ attributeId: 1, typedValue: "red" }]);

  assert.equal(signature.length, 64);
  assert.match(signature, /^[0-9a-f]{64}$/);
});

test("唔同嘅值計出唔同嘅 signature", () => {
  const red = computeVariantSignature([{ attributeId: 1, typedValue: "red" }]);
  const blue = computeVariantSignature([{ attributeId: 1, typedValue: "blue" }]);

  assert.notEqual(red, blue);
});

test("唔同嘅 attributeId 組合都計出唔同嘅 signature", () => {
  const oneAttr = computeVariantSignature([{ attributeId: 1, typedValue: "red" }]);
  const twoAttrs = computeVariantSignature([
    { attributeId: 1, typedValue: "red" },
    { attributeId: 2, typedValue: "M" }
  ]);

  assert.notEqual(oneAttr, twoAttrs);
});

test("同一個 attributeId 出現兩次：拋錯，唔會靜靜哋得返一個", () => {
  assert.throws(
    () =>
      computeVariantSignature([
        { attributeId: 1, typedValue: "red" },
        { attributeId: 1, typedValue: "blue" }
      ]),
    TypeError
  );
});

test("空陣列：拋錯", () => {
  assert.throws(() => computeVariantSignature([]), TypeError);
});

test("Unicode normalization：precomposed 同 decomposed 嘅同一個字，正規化之後計出同一個 signature", () => {
  // "cafe" + é 兩種等價寫法：precomposed（é 係單一個 code point U+00E9）
  // 同 decomposed（e + combining acute accent U+0301）。NFC 會將兩者統一做
  // precomposed 形式。刻意用 String.fromCodePoint 逐個 code point 砌，唔
  // 直接喺原始碼度打呢個字——工具鏈傳輸文字嗰陣好大機會會靜靜哋將佢正規化
  // 做同一種形式，令呢個測試冧唔到真正想測嘅嘢。
  const precomposed = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9); // c a f é(U+00E9)
  const decomposed = String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x0301); // c a f e + combining acute
  assert.notEqual(precomposed, decomposed, "呢兩個字串本身嘅 code point 序列應該唔一樣，先至測到啲嘢");
  assert.equal(precomposed.length, 4);
  assert.equal(decomposed.length, 5);

  const signatureA = computeVariantSignature([{ attributeId: 1, typedValue: precomposed }]);
  const signatureB = computeVariantSignature([{ attributeId: 1, typedValue: decomposed }]);

  assert.equal(signatureA, signatureB, "NFC 正規化之後，兩種寫法應該計出同一個 signature");
});

// --- typedValueToCanonicalString ---------------------------------------------

test("single_option：optionId 轉做字串", () => {
  assert.equal(typedValueToCanonicalString("single_option", 42), "42");
});

test("text／long_text：去頭尾空白", () => {
  assert.equal(typedValueToCanonicalString("text", "  紅色  "), "紅色");
  assert.equal(typedValueToCanonicalString("long_text", "  多行文字  "), "多行文字");
});

test("decimal：固定 6 位小數，唔同輸入形式嘅同一個數值要一致", () => {
  assert.equal(typedValueToCanonicalString("decimal", "1"), "1.000000");
  assert.equal(typedValueToCanonicalString("decimal", "1.0"), "1.000000");
  assert.equal(typedValueToCanonicalString("decimal", 1.5), "1.500000");
});

test("boolean：true／false 字面值", () => {
  assert.equal(typedValueToCanonicalString("boolean", true), "true");
  assert.equal(typedValueToCanonicalString("boolean", false), "false");
});

test("date：epoch 毫秒轉做字串", () => {
  assert.equal(typedValueToCanonicalString("date", 1700000000000), "1700000000000");
});

test("未知嘅 data type：拋錯", () => {
  assert.throws(() => typedValueToCanonicalString("currency", "HKD"), TypeError);
});

test("由 typedValueToCanonicalString 到 computeVariantSignature 完整走一次：小數輸入形式唔同都算同一個組合", () => {
  const entriesA = [
    { attributeId: 1, typedValue: typedValueToCanonicalString("decimal", "500") },
    { attributeId: 2, typedValue: typedValueToCanonicalString("single_option", 7) }
  ];
  const entriesB = [
    { attributeId: 1, typedValue: typedValueToCanonicalString("decimal", "500.000000") },
    { attributeId: 2, typedValue: typedValueToCanonicalString("single_option", 7) }
  ];

  assert.equal(computeVariantSignature(entriesA), computeVariantSignature(entriesB));
});
