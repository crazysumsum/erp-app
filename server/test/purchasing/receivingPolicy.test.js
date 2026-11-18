/**
 * TASK-028／TC-005（部分）：ReceivingPolicyService 純政策（設計 §8.6、§3.6；FR-VAL、BR-025～039、AC-025～035）。
 * 31 個登記、135 次 call（113 次 policy、22 次 Inventory normalizePurchaseReceipt）；冇 DB、網絡、fixture 檔或 timer。
 * Case 31 只驗 normalisation：template 唔係可以真正過帳嘅 command（唔叫 checkProfile／posting）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizePurchaseReceipt } from "../../src/modules/inventory/inventoryPurchaseValidation.js";
import {
  assertUniqueDimensions, calculateBaseQuantity, calculateOverReceipt, evaluateMinimumLife, evaluateSkuCommitment,
  evaluateSupplierException, validateTracking
} from "../../src/modules/purchasing/ReceivingPolicyService.js";

const found = (result) => result.issues.map(({ path, code }) => ({ path, code }));
const dependencyUnavailable = (error) => error.code === "PURCHASING_DEPENDENCY_UNAVAILABLE";

const snapshot = Object.freeze({ skuId: 7, trackingPolicySnapshot: "batch", baseUomIdSnapshot: 1, baseUomCodeSnapshot: "PCS",
  purchaseSkuUomIdSnapshot: 72, uomToBaseFactorSnapshot: 12 });
const sku = ({ uoms, ...over } = {}) => ({
  skuId: 7, trackingPolicy: "batch", warnings: [],
  uoms: uoms ?? [
    { uomId: 1, uomCode: "PCS", toBaseFactor: 1, isBase: true, skuUomId: 71, status: "active" },
    { uomId: 2, uomCode: "BOX", toBaseFactor: 12, isBase: false, skuUomId: 72, status: "active" }
  ],
  ...over
});
const life = (over) => evaluateMinimumLife({ businessReceiptDate: "2026-09-08", confirmDate: "2026-09-08", expiryDate: null,
  snapshotDays: null, currentDays: null, canOverride: false, reason: undefined, ...over });
const detail = (path, over = {}) => ({ path, purchaseOrderLineId: 101, warehouseId: 1, binId: 11, skuId: 7,
  normalizedLotNumber: "LOT-A", stockStatus: "AVAILABLE", inputUomId: 1, ...over });

test("TASK-028 P028-01 calculateBaseQuantity 精確換算正整數 Base 並正規化數量", () => {
  assert.deepEqual(calculateBaseQuantity({ quantity: "1.5", factor: 2 }),
    { receivedQuantity: "1.500000", receivedBaseQuantity: 3, issues: [] });
  assert.deepEqual(calculateBaseQuantity({ quantity: "12", factor: 1 }),
    { receivedQuantity: "12.000000", receivedBaseQuantity: 12, issues: [] });
});

test("TASK-028 P028-02 calculateBaseQuantity 拒絕 0、負數、指數、超過 6 位小數、空字串同非字串", () => {
  for (const quantity of ["0", "-1", "1e3", "1.0000001", "", 5]) {
    const result = calculateBaseQuantity({ quantity, factor: 1 });
    assert.deepEqual(found(result), [{ path: "receivedQuantity", code: "PURCHASING_QUANTITY_INVALID" }], JSON.stringify(quantity));
    assert.equal(result.receivedBaseQuantity, null);
  }
});

test("TASK-028 P028-03 calculateBaseQuantity 非整數 Base 或非法 factor 係 UOM_CONVERSION_INVALID", () => {
  for (const [quantity, factor] of [["1.5", 3], ["1", 0], ["1", 1_000_001], ["1", 1.5]]) {
    assert.deepEqual(found(calculateBaseQuantity({ quantity, factor })),
      [{ path: "receivedQuantity", code: "UOM_CONVERSION_INVALID" }], `${quantity}×${factor}`);
  }
});

test("TASK-028 P028-04 calculateBaseQuantity 遵守系統 Base 上限", () => {
  assert.equal(calculateBaseQuantity({ quantity: "10", factor: 1, maxBaseQuantity: 10 }).receivedBaseQuantity, 10);
  assert.deepEqual(found(calculateBaseQuantity({ quantity: "11", factor: 1, maxBaseQuantity: 10 })),
    [{ path: "receivedQuantity", code: "PURCHASING_QUANTITY_INVALID" }]);
});

test("TASK-028 P028-05 Active Supplier 唔使原因，送咗都唔保存", () => {
  for (const reason of [undefined, "供應商已恢復合作"]) {
    assert.deepEqual(evaluateSupplierException({ currentStatus: "active", details: [], reason }),
      { supplierStatusAtConfirm: "active", supplierExceptionReason: "", issues: [] });
  }
});

test("TASK-028 P028-06 Suspended／Archived Supplier 要原因（BR-038）", () => {
  for (const currentStatus of ["suspended", "archived"]) {
    assert.deepEqual(found(evaluateSupplierException({ currentStatus, details: [], reason: undefined })),
      [{ path: "supplierExceptionReason", code: "SUPPLIER_EXCEPTION_REASON_REQUIRED" }]);
    const accepted = evaluateSupplierException({ currentStatus, details: [], reason: "  供應商暫停但貨已到  " });
    assert.deepEqual(accepted.issues, []);
    assert.equal(accepted.supplierExceptionReason, "供應商暫停但貨已到");
  }
});

test("TASK-028 P028-07 Blocked Supplier 要原因而且每個 detail 都要 QUARANTINED", () => {
  const ok = evaluateSupplierException({ currentStatus: "blocked",
    details: [{ stockStatus: "QUARANTINED" }, { stockStatus: "QUARANTINED" }], reason: "供應商已封鎖，先隔離" });
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(found(evaluateSupplierException({ currentStatus: "blocked",
    details: [{ stockStatus: "QUARANTINED" }, { stockStatus: "AVAILABLE" }, { stockStatus: "DAMAGED" }], reason: undefined })), [
    { path: "supplierExceptionReason", code: "SUPPLIER_EXCEPTION_REASON_REQUIRED" },
    { path: "details[1].stockStatus", code: "BLOCKED_SUPPLIER_QUARANTINE_REQUIRED" },
    { path: "details[2].stockStatus", code: "BLOCKED_SUPPLIER_QUARANTINE_REQUIRED" }
  ]);
});

test("TASK-028 P028-08 已確認 PO 嘅 Supplier 唔可能係 draft、pending_approval 或未知狀態，fail closed", () => {
  for (const currentStatus of ["draft", "pending_approval", "unknown", null]) {
    assert.throws(() => evaluateSupplierException({ currentStatus, details: [], reason: "任何原因都唔得" }),
      dependencyUnavailable, String(currentStatus));
  }
});

test("TASK-028 P028-09 一般原因：空白要求原因，少於 5 或多過 500 code point 拒絕，前後空白會 trim", () => {
  const supplier = (reason) => evaluateSupplierException({ currentStatus: "suspended", details: [], reason });
  assert.deepEqual(found(supplier("   ")), [{ path: "supplierExceptionReason", code: "SUPPLIER_EXCEPTION_REASON_REQUIRED" }]);
  assert.deepEqual(found(supplier("abcd")), [{ path: "supplierExceptionReason", code: "PURCHASING_INPUT_INVALID" }]);
  assert.deepEqual(found(supplier("原".repeat(501))), [{ path: "supplierExceptionReason", code: "PURCHASING_INPUT_INVALID" }]);
  assert.equal(supplier("  原因五個字  ").supplierExceptionReason, "原因五個字");
});

test("TASK-028 P028-10 SKU 冇變就冇 warning，原因唔保存", () => {
  assert.deepEqual(evaluateSkuCommitment({ poSnapshot: snapshot, currentSku: sku(), reason: "多餘原因" }),
    { warningCodes: [], skuExceptionReason: "", issues: [] });
});

test("TASK-028 P028-11 Item provider 嘅 warning 原文傳出，要原因（BR-039）", () => {
  for (const warning of ["STATUS_NOT_ACTIVE", "NOT_PURCHASABLE", "NOT_INVENTORY_TRACKED", "OUTSIDE_EFFECTIVE_RANGE"]) {
    const currentSku = sku({ warnings: [warning] });
    assert.deepEqual(found(evaluateSkuCommitment({ poSnapshot: snapshot, currentSku, reason: undefined })),
      [{ path: "skuExceptionReason", code: "SKU_COMMITMENT_REASON_REQUIRED" }], warning);
    const accepted = evaluateSkuCommitment({ poSnapshot: snapshot, currentSku, reason: "此SKU已停用但仍完成在途收貨" });
    assert.deepEqual(accepted.warningCodes, [warning]);
    assert.deepEqual(accepted.issues, []);
  }
});

test("TASK-028 P028-12 Purchasing 自己偵測 Tracking、Base UOM 同 Purchase UOM 改變，並同 provider warning 合併排序", () => {
  const reason = "主檔改咗但仍完成在途收貨";
  const base = (over) => sku({ uoms: [{ uomId: 1, uomCode: "PCS", toBaseFactor: 1, isBase: true, skuUomId: 71, status: "active", ...over },
    { uomId: 2, uomCode: "BOX", toBaseFactor: 12, isBase: false, skuUomId: 72, status: "active" }] });
  const purchase = (over) => sku({ uoms: [{ uomId: 1, uomCode: "PCS", toBaseFactor: 1, isBase: true, skuUomId: 71, status: "active" },
    ...(over === null ? [] : [{ uomId: 2, uomCode: "BOX", toBaseFactor: 12, isBase: false, skuUomId: 72, status: "active", ...over }])] });
  for (const [currentSku, expected] of [
    [sku({ trackingPolicy: "batch_expiry" }), ["TRACKING_CHANGED"]],
    [base({ uomId: 9 }), ["BASE_UOM_CHANGED"]],
    [base({ uomCode: "EA" }), ["BASE_UOM_CHANGED"]],
    [purchase({ toBaseFactor: 10 }), ["PURCHASE_UOM_CHANGED"]],
    [purchase(null), ["PURCHASE_UOM_CHANGED"]],
    [purchase({ status: "inactive" }), ["PURCHASE_UOM_CHANGED"]],
    [sku({ trackingPolicy: "batch_expiry", warnings: ["STATUS_NOT_ACTIVE"] }), ["STATUS_NOT_ACTIVE", "TRACKING_CHANGED"]]
  ]) {
    const result = evaluateSkuCommitment({ poSnapshot: snapshot, currentSku, reason });
    assert.deepEqual(result.warningCodes, expected);
    assert.deepEqual(result.issues, []);
  }
});

test("TASK-028 P028-13 SKU projection 冇咗或者 skuId 唔對，fail closed", () => {
  assert.throws(() => evaluateSkuCommitment({ poSnapshot: snapshot, currentSku: null, reason: "原因原因" }), dependencyUnavailable);
  assert.throws(() => evaluateSkuCommitment({ poSnapshot: snapshot, currentSku: sku({ skuId: 8 }), reason: "原因原因" }),
    dependencyUnavailable);
});

test("TASK-028 P028-14 Tracking none：空值當冇，有 Lot／Expiry／Manufacture 就拒絕", () => {
  assert.deepEqual(validateTracking({ policy: "none" }),
    { lotNumber: "", normalizedLotNumber: "", expiryDate: null, manufactureDate: null, issues: [] });
  assert.deepEqual(validateTracking({ policy: "none", lotNumber: "", expiryDate: null, manufactureDate: "" }).issues, []);
  assert.deepEqual(found(validateTracking({ policy: "none", lotNumber: "L1" })), [{ path: "lotNumber", code: "PURCHASING_INPUT_INVALID" }]);
  assert.deepEqual(found(validateTracking({ policy: "none", expiryDate: "2027-01-01" })),
    [{ path: "expiryDate", code: "PURCHASING_INPUT_INVALID" }]);
  assert.deepEqual(found(validateTracking({ policy: "none", manufactureDate: "2026-01-01" })),
    [{ path: "manufactureDate", code: "PURCHASING_INPUT_INVALID" }]);
});

test("TASK-028 P028-15 Tracking batch：要 Lot，trim 後保留大細楷，Expiry 選填", () => {
  assert.deepEqual(found(validateTracking({ policy: "batch" })), [{ path: "lotNumber", code: "LOT_REQUIRED" }]);
  assert.deepEqual(found(validateTracking({ policy: "batch", lotNumber: "   " })), [{ path: "lotNumber", code: "LOT_REQUIRED" }]);
  assert.deepEqual(validateTracking({ policy: "batch", lotNumber: " L-1 " }),
    { lotNumber: "L-1", normalizedLotNumber: "L-1", expiryDate: null, manufactureDate: null, issues: [] });
});

test("TASK-028 P028-16 Tracking batch_expiry：Lot 同 Expiry 一齊要求", () => {
  assert.deepEqual(found(validateTracking({ policy: "batch_expiry" })), [
    { path: "lotNumber", code: "LOT_REQUIRED" }, { path: "expiryDate", code: "EXPIRY_REQUIRED" }]);
});

test("TASK-028 P028-17 非法日期、生產日期遲過到期日、超長或含 control character 嘅 Lot 都拒絕", () => {
  assert.deepEqual(found(validateTracking({ policy: "batch", lotNumber: "L-1", expiryDate: "2026-02-30" })),
    [{ path: "expiryDate", code: "PURCHASING_INPUT_INVALID" }]);
  assert.deepEqual(found(validateTracking({ policy: "batch", lotNumber: "L-1", expiryDate: "2027-01-01", manufactureDate: "2027-01-02" })),
    [{ path: "manufactureDate", code: "LOT_DATA_CONFLICT" }]);
  assert.deepEqual(found(validateTracking({ policy: "batch", lotNumber: "L".repeat(101) })),
    [{ path: "lotNumber", code: "PURCHASING_INPUT_INVALID" }]);
  assert.deepEqual(found(validateTracking({ policy: "batch", lotNumber: "L\u0007-1" })),
    [{ path: "lotNumber", code: "PURCHASING_INPUT_INVALID" }]);
});

test("TASK-028 P028-18 serial 或未知 Tracking fail closed，唔降級（AC-028）", () => {
  for (const policy of ["serial", "unknown"]) {
    assert.throws(() => validateTracking({ policy, lotNumber: "L-1" }), dependencyUnavailable, policy);
  }
});

test("TASK-028 P028-19 Minimum Receipt Life 門檻取 PO 快照同目前值較嚴格嘅非空值", () => {
  for (const [snapshotDays, currentDays, expected] of [[30, 60, 60], [null, 45, 45], [90, null, 90], [null, null, null]]) {
    const result = life({ expiryDate: "2027-09-08", snapshotDays, currentDays });
    assert.equal(result.minimumLifeDaysApplied, expected);
    assert.equal(result.actualRemainingLifeDays, 365);
    assert.deepEqual(result.issues, []);
    assert.equal(result.evidence, null);
  }
});

test("TASK-028 P028-20 剩餘效期等於門檻就合格；少一日而冇權限冇原因就 MINIMUM_RECEIPT_LIFE_FAILED", () => {
  const equal = life({ expiryDate: "2026-10-08", snapshotDays: 30, reason: "多餘原因" });
  assert.deepEqual([equal.issues, equal.evidence, equal.expiryOverrideReason], [[], null, ""]);
  const below = life({ expiryDate: "2026-10-07", snapshotDays: 30 });
  assert.deepEqual(below.issues, [{ path: "expiryDate", code: "MINIMUM_RECEIPT_LIFE_FAILED", messageKey: "MINIMUM_RECEIPT_LIFE_FAILED",
    meta: { minimumLifeDaysApplied: 30, actualRemainingLifeDays: 29 } }]);
});

test("TASK-028 P028-21 有 override 權限加原因就產生同 Inventory 一致嘅 evidence；原因空白仍然拒絕", () => {
  const accepted = life({ expiryDate: "2026-10-07", snapshotDays: 30, canOverride: true, reason: "  批准低效期收貨  " });
  assert.deepEqual(accepted.issues, []);
  assert.deepEqual(accepted.evidence, { reason: "批准低效期收貨", minimumLifeDaysApplied: 30, actualRemainingLifeDays: 29 });
  assert.equal(accepted.expiryOverrideReason, "批准低效期收貨");
  const blank = life({ expiryDate: "2026-10-07", snapshotDays: 30, canOverride: true, reason: "  " });
  assert.deepEqual(found(blank), [{ path: "expiryOverrideReason", code: "MINIMUM_RECEIPT_LIFE_FAILED" }]);
  assert.equal(blank.evidence, null);
});

test("TASK-028 P028-22 冇 override 權限但送原因就 EXPIRY_OVERRIDE_DENIED", () => {
  assert.deepEqual(found(life({ expiryDate: "2026-10-07", snapshotDays: 30, canOverride: false, reason: "我想照收呢批貨" })),
    [{ path: "expiryOverrideReason", code: "EXPIRY_OVERRIDE_DENIED" }]);
});

test("TASK-028 P028-23 已過期任何權限都唔可以 override；當日到期唔算過期但仍要過門檻", () => {
  const expired = life({ expiryDate: "2026-09-07", snapshotDays: 30, canOverride: true, reason: "批准低效期收貨" });
  assert.deepEqual(found(expired), [{ path: "expiryDate", code: "LOT_EXPIRED" }]);
  assert.equal(expired.evidence, null);
  const today = life({ expiryDate: "2026-09-08", snapshotDays: 30 });
  assert.equal(today.actualRemainingLifeDays, 0);
  assert.deepEqual(found(today), [{ path: "expiryDate", code: "MINIMUM_RECEIPT_LIFE_FAILED" }]);
});

test("TASK-028 P028-24 冇 Expiry 就唔計 Minimum Receipt Life（同 Inventory 現況一致）", () => {
  assert.deepEqual(life({ expiryDate: null, snapshotDays: 30, reason: "多餘原因" }),
    { minimumLifeDaysApplied: 30, expiryOverrideReason: "", evidence: null, actualRemainingLifeDays: null, issues: [] });
});

test("TASK-028 P028-25 少收唔會有超收，亦唔要求原因（FR-VAL-015）", () => {
  assert.deepEqual(calculateOverReceipt({ outstandingBefore: 10, receivedBaseQuantity: 8, reason: undefined }),
    { overReceivedBaseQuantity: 0, overReceiptReason: "", issues: [] });
});

test("TASK-028 P028-26 超收按提交前 Outstanding 計並要求原因（AC-034）", () => {
  assert.equal(calculateOverReceipt({ outstandingBefore: 10, receivedBaseQuantity: 10 }).overReceivedBaseQuantity, 0);
  assert.deepEqual(calculateOverReceipt({ outstandingBefore: 10, receivedBaseQuantity: 12, reason: undefined }).issues,
    [{ path: "overReceiptReason", code: "OVER_RECEIPT_REASON_REQUIRED", messageKey: "OVER_RECEIPT_REASON_REQUIRED",
      meta: { overReceivedBaseQuantity: 2 } }]);
  assert.deepEqual(calculateOverReceipt({ outstandingBefore: 10, receivedBaseQuantity: 12, reason: "供應商按外箱多送2件" }),
    { overReceivedBaseQuantity: 2, overReceiptReason: "供應商按外箱多送2件", issues: [] });
});

test("TASK-028 P028-27 Outstanding 已係 0 都可以超收但要原因；數量唔係 safe integer 就係程式錯誤", () => {
  assert.deepEqual(found(calculateOverReceipt({ outstandingBefore: 0, receivedBaseQuantity: 5, reason: undefined })),
    [{ path: "overReceiptReason", code: "OVER_RECEIPT_REASON_REQUIRED" }]);
  for (const [outstandingBefore, receivedBaseQuantity] of [["10", 5], [-1, 5], [10, 2 ** 53]]) {
    assert.throws(() => calculateOverReceipt({ outstandingBefore, receivedBaseQuantity, reason: "原因原因原因" }), TypeError);
  }
});

test("TASK-028 P028-28 同一 PO line 可以拆 Lot／位置／Status；Lot 大細楷唔同就係唔同 bucket（AC-023）", () => {
  assert.deepEqual(assertUniqueDimensions([
    detail("d0"), detail("d1", { normalizedLotNumber: "LOT-B" }),
    detail("d2", { warehouseId: 2, binId: 21 }), detail("d3", { warehouseId: 2, binId: 21, normalizedLotNumber: "LOT-B" })
  ]).issues, []);
  assert.deepEqual(assertUniqueDimensions([detail("d0"), detail("d1", { stockStatus: "QUARANTINED" })]).issues, []);
  assert.deepEqual(assertUniqueDimensions([detail("d0", { normalizedLotNumber: "lot-1" }),
    detail("d1", { normalizedLotNumber: "LOT-1" })]).issues, []);
});

test("TASK-028 P028-29 同一 physical bucket 唔可以重複，唔理輸入 UOM，Lot 前後空白唔算唔同", () => {
  assert.deepEqual(assertUniqueDimensions([detail("d0"), detail("d1", { inputUomId: 2 })]).issues,
    [{ path: "d1", code: "DUPLICATE_RECEIPT_DIMENSION", messageKey: "DUPLICATE_RECEIPT_DIMENSION", meta: { duplicateOf: "d0" } }]);
  assert.deepEqual(found(assertUniqueDimensions([detail("d0", { normalizedLotNumber: " LOT-1" }),
    detail("d1", { normalizedLotNumber: "LOT-1" })])), [{ path: "d1", code: "DUPLICATE_RECEIPT_DIMENSION" }]);
  assert.deepEqual(assertUniqueDimensions([detail("d0"), detail("d1"), detail("d2")]).issues.map(({ path, meta }) => [path, meta.duplicateOf]),
    [["d1", "d0"], ["d2", "d0"]]);
});

test("TASK-028 P028-30 Expiry 唔可以早過業務收貨日期，即使 Confirm 日仲未到期（FR-VAL-007、TL Q1）", () => {
  const between = life({ businessReceiptDate: "2026-09-10", confirmDate: "2026-09-08", expiryDate: "2026-09-09" });
  assert.deepEqual(found(between), [{ path: "expiryDate", code: "LOT_EXPIRED" }]);
  const sameDay = life({ businessReceiptDate: "2026-09-10", confirmDate: "2026-09-08", expiryDate: "2026-09-10" });
  assert.deepEqual(sameDay.issues, []);
  assert.equal(sameDay.actualRemainingLifeDays, 2);
});

// Case 31 嘅 normalisation-only template：所有其他欄位有效，每次只變一個原因位（TL Q3＝B；CI delta D1／D2）。
const receiptCommand = ({ skuExceptionReason = null, minimumLifeEvidence = null }) => ({
  actor: { userId: 1, serviceName: "", claimedRoles: ["receiving"], claimedPermissions: ["purchasing.view", "receiving.operation"] },
  correlationId: "",
  source: { documentId: "1", eventId: "00000000-0000-4000-8000-000000000001" },
  lines: [{
    sourceLineId: "1", skuId: 1, baseQuantity: 1, warehouseId: 1, binId: 1,
    lotNumber: null, expiryDate: null, manufactureDate: null, stockStatus: "AVAILABLE",
    commitment: { purchaseOrderId: 1, purchaseOrderLineId: 1, confirmedVersion: 1, skuId: 1, inventoryTrackedSnapshot: true,
      trackingPolicySnapshot: "none", baseUomIdSnapshot: 1, baseUomCodeSnapshot: "PCS", minimumReceiptLifeDaysSnapshot: null,
      skuExceptionReason },
    minimumLifeEvidence
  }]
});
const inventoryRefused = (field) => (error) => error.code === "INVENTORY_INPUT_INVALID" && error.details?.field === field;
const CJK = "貨";
const REASONS = [
  { raw: "abcd", refused: "PURCHASING_INPUT_INVALID" },
  { raw: "abcde" },
  { raw: "原因" },
  { raw: CJK.repeat(166) + "ab" },
  { raw: CJK.repeat(167), refused: "PURCHASING_INPUT_INVALID" },
  { raw: `  ${CJK.repeat(166)}ab  ` },
  { raw: "原因\t說明", refused: "PURCHASING_INPUT_INVALID" },
  { raw: "原因\n說明", refused: "PURCHASING_INPUT_INVALID" },
  { raw: "原因\r說明", refused: "PURCHASING_INPUT_INVALID" },
  { raw: "原因\u007f說明", refused: "PURCHASING_INPUT_INVALID" },
  { raw: "     ", refused: "REQUIRED" }
];

test("TASK-028 P028-31 傳去 Inventory 嘅兩個原因按 trim 後 5～500 UTF-8 byte 單行，同 Inventory normalizePurchaseReceipt 判斷一致", () => {
  for (const { raw, refused } of REASONS) {
    const label = JSON.stringify(raw.slice(0, 12));

    const commitment = evaluateSkuCommitment({ poSnapshot: snapshot, currentSku: sku({ warnings: ["STATUS_NOT_ACTIVE"] }), reason: raw });
    if (!refused) {
      assert.deepEqual(commitment.issues, [], label);
      assert.equal(commitment.skuExceptionReason, raw.trim(), label);
      assert.equal(normalizePurchaseReceipt(receiptCommand({ skuExceptionReason: commitment.skuExceptionReason }))
        .lines[0].commitment.skuExceptionReason, commitment.skuExceptionReason, label);
    } else {
      assert.deepEqual(found(commitment), [{ path: "skuExceptionReason",
        code: refused === "REQUIRED" ? "SKU_COMMITMENT_REASON_REQUIRED" : refused }], label);
      // 刻意嘅負向 probe：Purchasing 已拒絕，032 唔會送呢個 command。
      assert.throws(() => normalizePurchaseReceipt(receiptCommand({ skuExceptionReason: raw.trim() })),
        inventoryRefused("skuExceptionReason"), label);
    }

    const override = life({ expiryDate: "2026-09-18", snapshotDays: 30, canOverride: true, reason: raw });
    if (!refused) {
      assert.deepEqual(override.issues, [], label);
      assert.deepEqual(override.evidence, { reason: raw.trim(), minimumLifeDaysApplied: 30, actualRemainingLifeDays: 10 }, label);
      assert.deepEqual(normalizePurchaseReceipt(receiptCommand({ minimumLifeEvidence: override.evidence }))
        .lines[0].minimumLifeEvidence, override.evidence, label);
    } else {
      assert.deepEqual(found(override), [{ path: "expiryOverrideReason",
        code: refused === "REQUIRED" ? "MINIMUM_RECEIPT_LIFE_FAILED" : refused }], label);
      assert.equal(override.evidence, null, label);
      assert.throws(() => normalizePurchaseReceipt(receiptCommand({
        minimumLifeEvidence: { reason: raw.trim(), minimumLifeDaysApplied: 30, actualRemainingLifeDays: 10 } })),
      inventoryRefused("reason"), label);
    }
  }
});
