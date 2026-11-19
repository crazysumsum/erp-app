import { purchasingError } from "./purchasingErrors.js";
import { localDate, reason as policyReason } from "./purchasingValidation.js";
import { normalizeQuantity, toBaseQuantity } from "./quantityMath.js";

/**
 * TASK-028 收貨政策（設計 §8.6、§3.6）：純函式，唔讀 DB、唔睇時鐘，所有事實由 caller 傳入。
 * 可修正嘅欄位問題一次過以 issues 回傳；資料完整性問題即時 throw PURCHASING_DEPENDENCY_UNAVAILABLE。
 * Issue 只帶 path、code 同數字／path meta，永遠唔帶用戶輸入（SEC-014）。
 */

/** Draft 保存只擋呢四個 code（§8.5）；其餘 code 到 Confirm 先擋。 */
export const DRAFT_BLOCKING_CODES = Object.freeze([
  "PURCHASING_QUANTITY_INVALID", "UOM_CONVERSION_INVALID", "PURCHASING_INPUT_INVALID", "DUPLICATE_RECEIPT_DIMENSION"
]);

const TRACKING = ["none", "batch", "batch_expiry"];
const SUPPLIER_RULES = Object.freeze({ active: "none", suspended: "reason", archived: "reason", blocked: "quarantine" });
const PROVIDER_WARNINGS = new Set(["STATUS_NOT_ACTIVE", "NOT_PURCHASABLE", "NOT_INVENTORY_TRACKED", "OUTSIDE_EFFECTIVE_RANGE"]);
const DAY_MS = 86_400_000;

const issue = (path, code, meta = {}) => ({ path, code, messageKey: code, meta });
const absent = (value) => value === undefined || value === null || value === "";
const blank = (value) => absent(value) || (typeof value === "string" && value.trim() === "");
const dependencyUnavailable = () => purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");

/** §5.1 一般原因：trim 後 5～500 個 code point，可以多行。 */
function generalReason(value, path, requiredCode, meta) {
  if (blank(value)) return { value: "", issues: [issue(path, requiredCode, meta)] };
  try {
    return { value: policyReason(value, path), issues: [] };
  } catch {
    return { value: "", issues: [issue(path, "PURCHASING_INPUT_INVALID")] };
  }
}

/**
 * 會傳去 Inventory 嘅兩個原因（skuExceptionReason、expiryOverrideReason；TL RULING Q3＝B，Sam 已批）：
 * trim 後 5～500 個 UTF-8 byte、單行，唔准 code point ≤ 31 同 127，同 Inventory purchase contract 一致。
 * 下限都係 byte：兩個中文字（6 byte）有效。唔會先行 §5.1 嘅 reason()（佢嘅 5 code point 下限同多行規則唔同）。
 * 但保留 Purchasing 原有嘅 malformed Unicode 保護（SEC-013）：lone surrogate 一律拒絕。
 */
export function inventoryBoundReason(value, path, requiredCode, meta) {
  if (blank(value)) return { value: "", issues: [issue(path, requiredCode, meta)] };
  const invalid = { value: "", issues: [issue(path, "PURCHASING_INPUT_INVALID")] };
  if (typeof value !== "string") return invalid;
  const trimmed = value.trim();
  if (!trimmed.isWellFormed()) return invalid;
  const bytes = Buffer.byteLength(trimmed, "utf8");
  const control = [...trimmed].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
  if (bytes < 5 || bytes > 500 || control) return invalid;
  return { value: trimmed, issues: [] };
}

/** quantity × factor；factor 由 caller 揀（PO Purchase UOM 快照 factor，或 Base 嘅 1；§3.6）。 */
export function calculateBaseQuantity({ quantity, factor, maxBaseQuantity = Number.MAX_SAFE_INTEGER }) {
  try {
    const receivedBaseQuantity = toBaseQuantity(quantity, factor, { maxBaseQuantity });
    return { receivedQuantity: normalizeQuantity(quantity), receivedBaseQuantity, issues: [] };
  } catch (error) {
    if (error.code !== "PURCHASING_QUANTITY_INVALID" && error.code !== "UOM_CONVERSION_INVALID") throw error;
    return { receivedQuantity: null, receivedBaseQuantity: null, issues: [issue("receivedQuantity", error.code)] };
  }
}

/**
 * §3.6：Suspended／Archived 要原因；Blocked 要原因而且每個 detail 都要 QUARANTINED；其他狀態 fail closed。
 * Caller 前提：details 係 array（每項有 stockStatus）；唔係 array 屬 caller 結構錯誤，fail closed，唔係業務限制。
 */
export function evaluateSupplierException({ currentStatus, details, reason }) {
  if (!Object.hasOwn(SUPPLIER_RULES, currentStatus) || !Array.isArray(details)) throw dependencyUnavailable();
  const rule = SUPPLIER_RULES[currentStatus];
  if (rule === "none") return { supplierStatusAtConfirm: currentStatus, supplierExceptionReason: "", issues: [] };
  const checked = generalReason(reason, "supplierExceptionReason", "SUPPLIER_EXCEPTION_REASON_REQUIRED");
  const issues = [...checked.issues];
  if (rule === "quarantine") {
    details.forEach((detail, index) => {
      if (detail.stockStatus !== "QUARANTINED") {
        issues.push(issue(`details[${index}].stockStatus`, "BLOCKED_SUPPLIER_QUARANTINE_REQUIRED"));
      }
    });
  }
  return { supplierStatusAtConfirm: currentStatus, supplierExceptionReason: checked.value, issues };
}

/**
 * §3.6：PO 確認後 SKU 狀態／flags／Tracking／UOM 改咗，要 warning＋原因。
 * Warning＝Item provider 原文 code，加 Purchasing 自己嘅 TRACKING_CHANGED、BASE_UOM_CHANGED、PURCHASE_UOM_CHANGED；
 * 呢個集合涵蓋 Inventory checkProfile 嘅 drift 判斷。
 * Provider warning 只接受目前已審嘅四個 code（ItemLookupService.findManyForCommittedReceipt 嘅 closed contract）；
 * provider 日後加 code 要先做 consumer contract review，所以未知 code fail closed，冇寬鬆 fallback。
 * Base UOM 唔係剛好一個（同 Inventory checkProfile 一樣）亦 fail closed，唔會自行揀一個。
 */
export function evaluateSkuCommitment({ poSnapshot, currentSku, reason }) {
  const bases = Array.isArray(currentSku?.uoms) ? currentSku.uoms.filter((uom) => uom.isBase) : [];
  if (!currentSku || currentSku.skuId !== poSnapshot.skuId || !Array.isArray(currentSku.warnings) || bases.length !== 1
    || currentSku.warnings.some((warning) => !PROVIDER_WARNINGS.has(warning))) {
    throw dependencyUnavailable();
  }
  const codes = new Set(currentSku.warnings);
  if (currentSku.trackingPolicy !== poSnapshot.trackingPolicySnapshot) codes.add("TRACKING_CHANGED");
  if (bases[0].uomId !== poSnapshot.baseUomIdSnapshot || bases[0].uomCode !== poSnapshot.baseUomCodeSnapshot) {
    codes.add("BASE_UOM_CHANGED");
  }
  const purchase = currentSku.uoms.find((uom) => uom.skuUomId === poSnapshot.purchaseSkuUomIdSnapshot);
  if (!purchase || purchase.status !== "active" || purchase.toBaseFactor !== poSnapshot.uomToBaseFactorSnapshot) {
    codes.add("PURCHASE_UOM_CHANGED");
  }
  const warningCodes = [...codes].sort();
  if (!warningCodes.length) return { warningCodes, skuExceptionReason: "", issues: [] };
  const checked = inventoryBoundReason(reason, "skuExceptionReason", "SKU_COMMITMENT_REASON_REQUIRED");
  return { warningCodes, skuExceptionReason: checked.value, issues: checked.issues };
}

/** §3.6、FR-VAL-004～006：policy 係 PO 確認快照；serial 或未知 policy fail closed，唔降級。 */
export function validateTracking({ policy, lotNumber, expiryDate, manufactureDate }) {
  if (!TRACKING.includes(policy)) throw dependencyUnavailable();
  const issues = [];
  if (policy === "none") {
    for (const [field, value] of [["lotNumber", lotNumber], ["expiryDate", expiryDate], ["manufactureDate", manufactureDate]]) {
      if (!absent(value)) issues.push(issue(field, "PURCHASING_INPUT_INVALID"));
    }
    return { lotNumber: "", normalizedLotNumber: "", expiryDate: null, manufactureDate: null, issues };
  }

  // 同 Inventory lotNumber() 一樣：trim、保留大細楷、最多 100 code point、唔准 control character。
  let lot = "";
  if (blank(lotNumber)) issues.push(issue("lotNumber", "LOT_REQUIRED"));
  else if (typeof lotNumber !== "string" || [...lotNumber.trim()].length > 100 || /\p{Cc}/u.test(lotNumber.trim())) {
    issues.push(issue("lotNumber", "PURCHASING_INPUT_INVALID"));
  } else lot = lotNumber.trim();

  const date = (value, field) => {
    if (absent(value)) return null;
    try {
      return localDate(value, field);
    } catch {
      issues.push(issue(field, "PURCHASING_INPUT_INVALID"));
      return null;
    }
  };
  const expiry = date(expiryDate, "expiryDate");
  const manufacture = date(manufactureDate, "manufactureDate");
  if (policy === "batch_expiry" && absent(expiryDate)) issues.push(issue("expiryDate", "EXPIRY_REQUIRED"));
  if (expiry !== null && manufacture !== null && manufacture > expiry) issues.push(issue("manufactureDate", "LOT_DATA_CONFLICT"));
  return { lotNumber: lot, normalizedLotNumber: lot, expiryDate: expiry, manufactureDate: manufacture, issues };
}

/**
 * TL RULING Q1（Sam 已批）：過期同剩餘效期以 confirmDate（Inventory 同一個 time.fileDate()）計；
 * 另外 expiry 唔可以早過 businessReceiptDate（FR-VAL-007 字面）。門檻＝PO 快照同目前值較嚴格嘅非空值。
 * 冇 expiry 就唔計 minimum life（同 Inventory 現況一樣）。Expired 任何權限都唔可以 override。
 * Caller 前提：expiryDate 必須係 validateTracking 輸出嘅合法日期或 null；snapshotDays／currentDays 係已驗證、
 * 非負嘅可信事實。本函式只驗 businessReceiptDate 同 confirmDate，唔會獨立驗 expiry／days 嘅型別，唔係 raw input 驗證。
 */
export function evaluateMinimumLife({ businessReceiptDate, confirmDate, expiryDate, snapshotDays, currentDays, canOverride, reason }) {
  localDate(businessReceiptDate, "businessReceiptDate");
  localDate(confirmDate, "confirmDate");
  const minimumLifeDaysApplied = snapshotDays == null && currentDays == null ? null : Math.max(snapshotDays ?? 0, currentDays ?? 0);
  const none = { minimumLifeDaysApplied, expiryOverrideReason: "", evidence: null };
  if (expiryDate == null) return { ...none, actualRemainingLifeDays: null, issues: [] };

  const actualRemainingLifeDays = (Date.parse(`${expiryDate}T00:00:00.000Z`) - Date.parse(`${confirmDate}T00:00:00.000Z`)) / DAY_MS;
  const result = { ...none, actualRemainingLifeDays };
  if (expiryDate < confirmDate || expiryDate < businessReceiptDate) return { ...result, issues: [issue("expiryDate", "LOT_EXPIRED")] };
  if (minimumLifeDaysApplied === null || actualRemainingLifeDays >= minimumLifeDaysApplied) return { ...result, issues: [] };

  const meta = { minimumLifeDaysApplied, actualRemainingLifeDays };
  if (canOverride !== true) {
    return { ...result, issues: blank(reason) ? [issue("expiryDate", "MINIMUM_RECEIPT_LIFE_FAILED", meta)]
      : [issue("expiryOverrideReason", "EXPIRY_OVERRIDE_DENIED")] };
  }
  const checked = inventoryBoundReason(reason, "expiryOverrideReason", "MINIMUM_RECEIPT_LIFE_FAILED", meta);
  if (checked.issues.length) return { ...result, issues: checked.issues };
  return { ...result, expiryOverrideReason: checked.value, evidence: { reason: checked.value, ...meta }, issues: [] };
}

/** FR-VAL-013～015：超收按 caller 鎖定嘅 outstanding 計，要原因；少收唔使原因。冇額外 permission（BR-023）。 */
export function calculateOverReceipt({ outstandingBefore, receivedBaseQuantity, reason }) {
  if (!Number.isSafeInteger(outstandingBefore) || outstandingBefore < 0
    || !Number.isSafeInteger(receivedBaseQuantity) || receivedBaseQuantity < 1) {
    throw new TypeError("Over-receipt quantities must be safe integers from the locked PO");
  }
  const overReceivedBaseQuantity = Math.max(0, receivedBaseQuantity - outstandingBefore);
  if (overReceivedBaseQuantity === 0) return { overReceivedBaseQuantity, overReceiptReason: "", issues: [] };
  const checked = generalReason(reason, "overReceiptReason", "OVER_RECEIPT_REASON_REQUIRED", { overReceivedBaseQuantity });
  return { overReceivedBaseQuantity, overReceiptReason: checked.value, issues: checked.issues };
}

/**
 * §3.4、uq_gr_detail_dimension：同一 PO line／Warehouse／Bin／SKU／normalized Lot／Status 只可以一個 detail；
 * 輸入 UOM 唔計。Lot 再 trim 一次（idempotent），同 Inventory 嘅 normalisation 一致。
 */
export function assertUniqueDimensions(details) {
  if (!Array.isArray(details)) throw new TypeError("Receipt details must be an array");
  const first = new Map(), issues = [];
  for (const detail of details) {
    const key = JSON.stringify([detail.purchaseOrderLineId, detail.warehouseId, detail.binId, detail.skuId,
      String(detail.normalizedLotNumber ?? "").trim(), detail.stockStatus]);
    if (first.has(key)) issues.push(issue(detail.path, "DUPLICATE_RECEIPT_DIMENSION", { duplicateOf: first.get(key) }));
    else first.set(key, detail.path);
  }
  return { issues };
}
