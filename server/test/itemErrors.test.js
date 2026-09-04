import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../src/framework/errors/ApplicationError.js";
import * as itemErrors from "../src/modules/item/itemErrors.js";

// 對齊 docs/items_management/design_spec.md §6.11 的錯誤代碼表：每一個 factory
// 都要回傳正確的 HTTP status、code == publicCode，以及一句繁體中文
// publicMessage（不是英文 debug message 外洩到使用者畫面）。表本身就是這份
// 測試存在的理由——code 或 status 打錯字，症狀是某個情境回錯 HTTP status 或
// 洩漏英文字串，而不會有任何地方報錯。
const CASES = [
  [() => itemErrors.skuCodeInvalid("too long"), "SKU_CODE_INVALID", 400],
  [() => itemErrors.gtinInvalid("12345"), "GTIN_INVALID", 400],
  [() => itemErrors.uomConversionInvalid("factor must be positive"), "UOM_CONVERSION_INVALID", 400],
  [() => itemErrors.skuChildMismatch("uom", 9), "SKU_CHILD_MISMATCH", 400],
  [() => itemErrors.attributeValueInvalid("wrong data type"), "ATTRIBUTE_VALUE_INVALID", 400],
  [() => itemErrors.itemNotFound(1), "ITEM_NOT_FOUND", 404],
  [() => itemErrors.skuNotFound(1), "SKU_NOT_FOUND", 404],
  [() => itemErrors.categoryNotFound(1), "CATEGORY_NOT_FOUND", 404],
  [() => itemErrors.brandNotFound(1), "BRAND_NOT_FOUND", 404],
  [() => itemErrors.uomNotFound(1), "UOM_NOT_FOUND", 404],
  [() => itemErrors.attributeNotFound(1), "ATTRIBUTE_NOT_FOUND", 404],
  [() => itemErrors.skuCodeTaken("VC-001"), "SKU_CODE_TAKEN", 409],
  [() => itemErrors.barcodeTaken("4891234567890"), "BARCODE_TAKEN", 409],
  [() => itemErrors.variantCombinationTaken(), "VARIANT_COMBINATION_TAKEN", 409],
  [() => itemErrors.standardItemSkuLimit(), "STANDARD_ITEM_SKU_LIMIT", 409],
  [() => itemErrors.versionConflict(), "VERSION_CONFLICT", 409],
  [() => itemErrors.statusTransitionInvalid("archived", "active"), "STATUS_TRANSITION_INVALID", 409],
  [() => itemErrors.lastActiveSku(), "LAST_ACTIVE_SKU", 409],
  [() => itemErrors.itemReferenced(["sku"]), "ITEM_REFERENCED", 409],
  [() => itemErrors.skuReferenced(["barcode"]), "SKU_REFERENCED", 409],
  [() => itemErrors.catalogInUse(["item"]), "CATALOG_IN_USE", 409],
  [() => itemErrors.categoryHasChildren(), "CATEGORY_HAS_CHILDREN", 409],
  [() => itemErrors.categoryNameTaken("Vitamins"), "CATEGORY_NAME_TAKEN", 409],
  [() => itemErrors.brandNameTaken("Brand A"), "BRAND_NAME_TAKEN", 409],
  [() => itemErrors.uomCodeTaken("EA"), "UOM_CODE_TAKEN", 409],
  [() => itemErrors.categoryCycle(), "CATEGORY_CYCLE", 400],
  [() => itemErrors.categoryMaxDepthExceeded(8), "CATEGORY_MAX_DEPTH_EXCEEDED", 400],
  [() => itemErrors.categoryParentNotActive(), "CATEGORY_PARENT_NOT_ACTIVE", 409],
  [() => itemErrors.uomChangeBlocked(), "UOM_CHANGE_BLOCKED", 409],
  [() => itemErrors.trackingPolicyChangeBlocked(), "TRACKING_POLICY_CHANGE_BLOCKED", 409],
  [() => itemErrors.itemNotActivatable([{ field: "category", code: "REQUIRED" }]), "ITEM_NOT_ACTIVATABLE", 422],
  [() => itemErrors.importNotReady(), "IMPORT_NOT_READY", 409],
  [() => itemErrors.importStateConflict(), "IMPORT_STATE_CONFLICT", 409],
  [() => itemErrors.importFileExpired(), "IMPORT_FILE_EXPIRED", 410]
];

for (const [build, code, statusCode] of CASES) {
  test(`${code} is an ApplicationError with statusCode ${statusCode}, matching public/internal code, and a Chinese public message`, () => {
    const error = build();

    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, code);
    assert.equal(error.publicCode, code);
    assert.equal(error.statusCode, statusCode);
    assert.ok(error.publicMessage, "publicMessage must not be empty");
    // 粗略斷言含有中日韓統一表意文字（CJK），排除有人不小心把英文 debug
    // message 直接複製當成 publicMessage。
    assert.match(error.publicMessage, /[一-鿿]/);
    // publicMessage 不應該就是丟給開發者看的英文 message 本身。
    assert.notEqual(error.publicMessage, error.message);
  });
}

test("issues/details survive onto the response-facing error for the two composite factories", () => {
  const notActivatable = itemErrors.itemNotActivatable([
    { field: "suggestedPriceAmount", code: "REQUIRED" }
  ]);
  assert.deepEqual(notActivatable.details, {
    issues: [{ field: "suggestedPriceAmount", code: "REQUIRED" }]
  });

  const referenced = itemErrors.itemReferenced(["sku", "audit"]);
  assert.deepEqual(referenced.details, { referenceTypes: ["sku", "audit"] });
});

test("PERMISSION_STALE is deliberately not defined here; it is reused from adminGuard", () => {
  assert.equal(Object.hasOwn(itemErrors, "permissionStale"), false);
});
