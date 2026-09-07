import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSkuActivatable,
  decimalStringPattern,
  isBoundedUomFactor,
  isDecimalString,
  isPositiveDecimalString
} from "../src/modules/item/itemValidation.js";

// --- decimal 字串／UOM factor ---------------------------------------------

test("isDecimalString 只接受整數位不超過上限、小數位剛好指定位數的字串", () => {
  const shape = { integerDigits: 15, decimalPlaces: 4 };
  assert.equal(isDecimalString("128.0000", shape), true);
  assert.equal(isDecimalString("0.0001", shape), true);
  assert.equal(isDecimalString("128.00", shape), false, "小數位數不對");
  assert.equal(isDecimalString("128", shape), false, "完全冇小數點");
  assert.equal(isDecimalString("-128.0000", shape), false, "呢個 schema 冇負數欄位");
  assert.equal(isDecimalString("1e5.0000", shape), false, "唔接受科學記數法");
  assert.equal(isDecimalString(128.0, shape), false, "唔接受 number，一定要係字串");
});

test("decimalStringPattern 產生嘅 regex 正確涵蓋 15 位整數／4 位小數呢個邊界", () => {
  const pattern = decimalStringPattern({ integerDigits: 15, decimalPlaces: 4 });
  assert.ok(pattern.test(`${"9".repeat(15)}.0000`));
  assert.ok(!pattern.test(`${"9".repeat(16)}.0000`));
});

test("isPositiveDecimalString 純睇字串有冇非零數字，唔轉做 number", () => {
  assert.equal(isPositiveDecimalString("0.0000"), false);
  assert.equal(isPositiveDecimalString("0.0001"), true);
  assert.equal(isPositiveDecimalString("100.0000"), true);
});

test("isBoundedUomFactor 只接受 1 到 1,000,000 之間嘅整數", () => {
  assert.equal(isBoundedUomFactor(1), true);
  assert.equal(isBoundedUomFactor(1_000_000), true);
  assert.equal(isBoundedUomFactor(0), false);
  assert.equal(isBoundedUomFactor(1_000_001), false);
  assert.equal(isBoundedUomFactor(1.5), false, "唔接受小數");
  assert.equal(isBoundedUomFactor("1"), false, "唔接受字串");
});

// --- assertSkuActivatable --------------------------------------------------

function validStandardSku(overrides = {}) {
  return {
    item: {
      productType: "standard",
      hasActiveLeafCategory: true
    },
    sku: {
      code: "SKU-001",
      name: "Standard SKU",
      variantSignature: null,
      uoms: [{ isBase: true, isDefaultPurchase: true, isDefaultSale: true, toBaseFactor: 1 }],
      trackingPolicy: "none",
      shelfLifeDays: null,
      minReceiptLifeDays: null,
      minSaleLifeDays: null,
      sellable: true,
      suggestedPriceAmount: "100.0000",
      effectiveFrom: null,
      effectiveTo: null,
      barcodes: [],
      ...overrides
    }
  };
}

function issueCodesOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    assert.equal(error.code, "ITEM_NOT_ACTIVATABLE");
    assert.equal(error.statusCode, 422);
    return error.details.issues.map((issue) => issue.code);
  }
}

test("assertSkuActivatable 對一個乾淨嘅 standard SKU 唔會拋錯", () => {
  assert.doesNotThrow(() => assertSkuActivatable(validStandardSku()));
});

test("SKU Code／名稱空白：一次過收集埋兩個問題，唔係得一個", () => {
  const input = validStandardSku({ code: "  ", name: "" });
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.ok(codes.includes("SKU_CODE_REQUIRED"));
  assert.ok(codes.includes("SKU_NAME_REQUIRED"));
});

test("父 Item 冇可用嘅 leaf category", () => {
  const input = validStandardSku();
  input.item.hasActiveLeafCategory = false;
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.deepEqual(codes, ["CATEGORY_NOT_USABLE"]);
});

test("Standard SKU 唔可以有 variant signature", () => {
  const input = validStandardSku({ variantSignature: "a".repeat(64) });
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.deepEqual(codes, ["STANDARD_SKU_HAS_VARIANT"]);
});

test("Variant Item 嘅 SKU 一定要有 variant signature", () => {
  const input = validStandardSku({ variantSignature: null });
  input.item.productType = "variant";
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.deepEqual(codes, ["VARIANT_SIGNATURE_REQUIRED"]);

  input.sku.variantSignature = "a".repeat(64);
  assert.doesNotThrow(() => assertSkuActivatable(input));
});

test("Base UOM：必須恰好一個，factor 必須係 1", () => {
  assert.deepEqual(
    issueCodesOf(() => assertSkuActivatable(validStandardSku({ uoms: [] }))),
    ["BASE_UOM_REQUIRED"]
  );

  const twoBases = validStandardSku({
    uoms: [
      { isBase: true, isDefaultPurchase: false, isDefaultSale: false, toBaseFactor: 1 },
      { isBase: true, isDefaultPurchase: false, isDefaultSale: false, toBaseFactor: 1 }
    ]
  });
  assert.deepEqual(issueCodesOf(() => assertSkuActivatable(twoBases)), ["BASE_UOM_REQUIRED"]);

  const wrongFactor = validStandardSku({
    uoms: [{ isBase: true, isDefaultPurchase: false, isDefaultSale: false, toBaseFactor: 2 }]
  });
  assert.deepEqual(issueCodesOf(() => assertSkuActivatable(wrongFactor)), ["BASE_UOM_FACTOR_INVALID"]);
});

test("預設採購／銷售單位最多一個", () => {
  const input = validStandardSku({
    uoms: [
      { isBase: true, isDefaultPurchase: true, isDefaultSale: false, toBaseFactor: 1 },
      { isBase: false, isDefaultPurchase: true, isDefaultSale: true, toBaseFactor: 12 },
      { isBase: false, isDefaultPurchase: false, isDefaultSale: true, toBaseFactor: 24 }
    ]
  });
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.ok(codes.includes("DEFAULT_PURCHASE_UOM_DUPLICATED"));
  assert.ok(codes.includes("DEFAULT_SALE_UOM_DUPLICATED"));
});

test("UOM factor 超出 1–1,000,000 範圍", () => {
  const input = validStandardSku({
    uoms: [
      { isBase: true, isDefaultPurchase: false, isDefaultSale: false, toBaseFactor: 1 },
      { isBase: false, isDefaultPurchase: false, isDefaultSale: false, toBaseFactor: 1_000_001 }
    ]
  });
  assert.deepEqual(issueCodesOf(() => assertSkuActivatable(input)), ["UOM_FACTOR_OUT_OF_RANGE"]);
});

test("batch_expiry 必須有正整數 shelf life，min receipt／sale life 唔可以大過佢", () => {
  const missingShelfLife = validStandardSku({ trackingPolicy: "batch_expiry", shelfLifeDays: null });
  assert.deepEqual(
    issueCodesOf(() => assertSkuActivatable(missingShelfLife)),
    ["SHELF_LIFE_REQUIRED"]
  );

  const exceeded = validStandardSku({
    trackingPolicy: "batch_expiry",
    shelfLifeDays: 30,
    minReceiptLifeDays: 40,
    minSaleLifeDays: 35
  });
  const codes = issueCodesOf(() => assertSkuActivatable(exceeded));
  assert.ok(codes.includes("MIN_RECEIPT_LIFE_EXCEEDS_SHELF_LIFE"));
  assert.ok(codes.includes("MIN_SALE_LIFE_EXCEEDS_SHELF_LIFE"));

  const withinRange = validStandardSku({
    trackingPolicy: "batch_expiry",
    shelfLifeDays: 30,
    minReceiptLifeDays: 10,
    minSaleLifeDays: 20
  });
  assert.doesNotThrow(() => assertSkuActivatable(withinRange));
});

test("未知嘅 tracking policy 拒絕", () => {
  const input = validStandardSku({ trackingPolicy: "unknown" });
  const codes = issueCodesOf(() => assertSkuActivatable(input));
  assert.ok(codes.includes("TRACKING_POLICY_INVALID"));
});

test("Sellable SKU 必須有大於零嘅建議售價", () => {
  assert.deepEqual(
    issueCodesOf(() => assertSkuActivatable(validStandardSku({ suggestedPriceAmount: null }))),
    ["SUGGESTED_PRICE_REQUIRED"]
  );
  assert.deepEqual(
    issueCodesOf(() => assertSkuActivatable(validStandardSku({ suggestedPriceAmount: "0.0000" }))),
    ["SUGGESTED_PRICE_MUST_BE_POSITIVE"]
  );
  // 唔可以銷售嘅 SKU 唔使填 RRP。
  assert.doesNotThrow(() =>
    assertSkuActivatable(validStandardSku({ sellable: false, suggestedPriceAmount: null }))
  );
});

test("effectiveTo 唔可以早過 effectiveFrom", () => {
  const input = validStandardSku({ effectiveFrom: 2000, effectiveTo: 1000 });
  assert.deepEqual(issueCodesOf(() => assertSkuActivatable(input)), ["EFFECTIVE_RANGE_INVALID"]);

  const equal = validStandardSku({ effectiveFrom: 1000, effectiveTo: 1000 });
  assert.doesNotThrow(() => assertSkuActivatable(equal));
});

test("同一次提交入面唔可以有重複嘅條碼", () => {
  const input = validStandardSku({
    barcodes: [{ normalizedBarcode: "4006381333931" }, { normalizedBarcode: "4006381333931" }]
  });
  assert.deepEqual(issueCodesOf(() => assertSkuActivatable(input)), ["BARCODE_DUPLICATED_IN_REQUEST"]);
});

test("冇條碼嘅 SKU 都可以啟用", () => {
  assert.doesNotThrow(() => assertSkuActivatable(validStandardSku({ barcodes: [] })));
});
