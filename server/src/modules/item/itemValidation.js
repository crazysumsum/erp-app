/**
 * Item／SKU 的純 domain 規則：completeness／activatability 檢查、decimal
 * 字串格式、UOM factor 邊界。設計說明見 docs/items_management/design_spec.md
 * §4.2、§4.3、§4.6。
 *
 * 全部是純函式，跟 adminGuard.js 同一個理由：它們要的東西（SKU、Item、UOM 列
 * 表、barcode 列表現況）全部由呼叫端查好、組成一個 plain object 傳進來，這裡
 * 只回答「這樣合不合法」。真正的 DB 查詢住在未來的 ItemAdminService／
 * SkuAdminService（T14 之後）。
 *
 * decimal 一律用字串比對，不轉成 JavaScript number：DECIMAL(19,4)／
 * DECIMAL(20,6) 的精度超過浮點數能安全表示的範圍一小步就會出事，而「這個字串
 * 是不是這個形狀」「是不是全部是零」都不需要真的做算術。
 */
import { itemNotActivatable } from "./itemErrors.js";
import { MONEY_DECIMAL, TRACKING_POLICIES, UOM_FACTOR_MAX, UOM_FACTOR_MIN } from "./itemConstants.js";

/**
 * 產生一個「整數位最多 integerDigits 位、小數位恰好 decimalPlaces 位」嘅
 * decimal 字串格式 regex，例如 DECIMAL(19,4) 對應
 * `^\d{1,15}\.\d{4}$`——冇正負號：呢個 schema 入面所有用到 decimal 字串嘅
 * 欄位（RRP、重量、尺寸、淨含量）都冇負數嘅業務意義。
 */
export function decimalStringPattern({ integerDigits, decimalPlaces }) {
  return new RegExp(`^\\d{1,${integerDigits}}\\.\\d{${decimalPlaces}}$`);
}

/** 純字串格式檢查，唔做任何算術。 */
export function isDecimalString(value, shape) {
  return typeof value === "string" && decimalStringPattern(shape).test(value);
}

/**
 * 呢個已經係合法 decimal 字串嘅值係咪大於零——淨係睇個字串入面有冇任何一個
 * 非零數字，唔轉成 number。呼叫端要先用 isDecimalString() 確認格式，呢度唔
 * 重複做格式檢查。
 */
export function isPositiveDecimalString(value) {
  return /[1-9]/.test(value);
}

/**
 * to_base_factor 允許嘅範圍：1 到 1,000,000 嘅整數，唔接受小數——同 JSON 入面
 * 傳嘅係 number 唔係字串（呢個唔係 DECIMAL 欄，普通 INT UNSIGNED，安全整數
 * 範圍之內冇浮點數精度問題）。
 */
export function isBoundedUomFactor(value) {
  return Number.isInteger(value) && value >= UOM_FACTOR_MIN && value <= UOM_FACTOR_MAX;
}

function addIssue(issues, field, code, message) {
  issues.push({ field, code, message });
}

/**
 * SKU 啟用前嘅完整性檢查，一次收集晒全部問題，唔係揾到第一個就停低——見
 * design_spec.md §4.3。冚唪唥問題都收集埋一齊拋出（`ITEM_NOT_ACTIVATABLE`，
 * 422，`details.issues` 帶埋完整清單），等前端一次過顯示晒俾使用者，唔使
 * 「改一個、再撞下一個」咁樣一步步試。
 *
 * 唔包括「Standard Item 只可以有一個 SKU」呢條规则：嗰個係
 * `STANDARD_ITEM_SKU_LIMIT`（409），喺 createSku()／改 productType 嗰陣檢查，
 * 唔係呢個「呢粒 SKU 本身夠唔夠格啟用」嘅檢查嘅範圍。
 *
 * @param {object} input
 * @param {object} input.item
 * @param {"standard"|"variant"} input.item.productType
 * @param {boolean} input.item.hasActiveLeafCategory 父 Item 而家嘅
 *   category_id 係咪指向一個 active 嘅 leaf category（由呼叫端查好）。
 * @param {object} input.sku
 * @param {string} input.sku.code
 * @param {string} input.sku.name
 * @param {string|null} input.sku.variantSignature Standard SKU 必須係
 *   null；Variant SKU 必須有值（完整 attribute value 组合嘅檢查是 T23／24
 *   Attribute 表建成之後嘅事，呢度只驗證「有冇 signature」呢一層）。
 * @param {Array<{isBase: boolean, isDefaultPurchase: boolean, isDefaultSale: boolean, toBaseFactor: number}>} input.sku.uoms
 * @param {string} input.sku.trackingPolicy
 * @param {number|null} input.sku.shelfLifeDays
 * @param {number|null} input.sku.minReceiptLifeDays
 * @param {number|null} input.sku.minSaleLifeDays
 * @param {boolean} input.sku.sellable
 * @param {string|null} input.sku.suggestedPriceAmount decimal 字串，例如 "128.0000"。
 * @param {number|null} input.sku.effectiveFrom
 * @param {number|null} input.sku.effectiveTo
 * @param {Array<{normalizedBarcode: string}>} input.sku.barcodes
 */
export function assertSkuActivatable({ item, sku }) {
  const issues = [];

  if (!sku.code || !sku.code.trim()) {
    addIssue(issues, "code", "SKU_CODE_REQUIRED", "SKU Code 不可空白");
  }
  if (!sku.name || !sku.name.trim()) {
    addIssue(issues, "name", "SKU_NAME_REQUIRED", "SKU 名稱不可空白");
  }

  if (!item.hasActiveLeafCategory) {
    addIssue(issues, "categoryId", "CATEGORY_NOT_USABLE", "商品必須屬於一個啟用中的末端分類");
  }

  if (item.productType === "standard") {
    if (sku.variantSignature !== null && sku.variantSignature !== undefined) {
      addIssue(issues, "variantSignature", "STANDARD_SKU_HAS_VARIANT", "一般商品的 SKU 不可以有規格組合");
    }
  } else if (!sku.variantSignature) {
    addIssue(issues, "variantSignature", "VARIANT_SIGNATURE_REQUIRED", "多規格商品的 SKU 必須有完整的規格組合");
  }

  const uoms = sku.uoms ?? [];
  const baseUoms = uoms.filter((row) => row.isBase);
  if (baseUoms.length !== 1) {
    addIssue(issues, "uoms", "BASE_UOM_REQUIRED", "必須恰好指定一個 Base 單位");
  } else if (baseUoms[0].toBaseFactor !== 1) {
    addIssue(issues, "uoms", "BASE_UOM_FACTOR_INVALID", "Base 單位的換算係數必須是 1");
  }
  if (uoms.filter((row) => row.isDefaultPurchase).length > 1) {
    addIssue(issues, "uoms", "DEFAULT_PURCHASE_UOM_DUPLICATED", "預設採購單位最多只可以有一個");
  }
  if (uoms.filter((row) => row.isDefaultSale).length > 1) {
    addIssue(issues, "uoms", "DEFAULT_SALE_UOM_DUPLICATED", "預設銷售單位最多只可以有一個");
  }
  for (const row of uoms) {
    if (!isBoundedUomFactor(row.toBaseFactor)) {
      addIssue(issues, "uoms", "UOM_FACTOR_OUT_OF_RANGE", "單位換算係數必須是 1 到 1,000,000 之間的整數");
    }
  }

  if (sku.trackingPolicy === "batch_expiry") {
    if (!Number.isInteger(sku.shelfLifeDays) || sku.shelfLifeDays <= 0) {
      addIssue(issues, "shelfLifeDays", "SHELF_LIFE_REQUIRED", "追蹤政策為效期時，保存期限必須是正整數");
    } else {
      if (sku.minReceiptLifeDays != null && sku.minReceiptLifeDays > sku.shelfLifeDays) {
        addIssue(issues, "minReceiptLifeDays", "MIN_RECEIPT_LIFE_EXCEEDS_SHELF_LIFE", "最短到貨可用天數不可以大於保存期限");
      }
      if (sku.minSaleLifeDays != null && sku.minSaleLifeDays > sku.shelfLifeDays) {
        addIssue(issues, "minSaleLifeDays", "MIN_SALE_LIFE_EXCEEDS_SHELF_LIFE", "最短銷售可用天數不可以大於保存期限");
      }
    }
  }
  if (!TRACKING_POLICIES.includes(sku.trackingPolicy)) {
    addIssue(issues, "trackingPolicy", "TRACKING_POLICY_INVALID", "追蹤政策不是已知的選項");
  }

  if (sku.sellable) {
    if (!isDecimalString(sku.suggestedPriceAmount, MONEY_DECIMAL)) {
      addIssue(issues, "suggestedPriceAmount", "SUGGESTED_PRICE_REQUIRED", "可銷售的 SKU 必須填寫建議售價");
    } else if (!isPositiveDecimalString(sku.suggestedPriceAmount)) {
      addIssue(issues, "suggestedPriceAmount", "SUGGESTED_PRICE_MUST_BE_POSITIVE", "建議售價必須大於零");
    }
  }

  if (sku.effectiveFrom != null && sku.effectiveTo != null && sku.effectiveTo < sku.effectiveFrom) {
    addIssue(issues, "effectiveTo", "EFFECTIVE_RANGE_INVALID", "生效結束日不可以早於生效開始日");
  }

  const barcodes = sku.barcodes ?? [];
  const seenBarcodes = new Set();
  for (const row of barcodes) {
    if (seenBarcodes.has(row.normalizedBarcode)) {
      addIssue(issues, "barcodes", "BARCODE_DUPLICATED_IN_REQUEST", "同一次提交裡有重複的條碼");
    }
    seenBarcodes.add(row.normalizedBarcode);
  }

  if (issues.length > 0) {
    throw itemNotActivatable(issues);
  }
}
