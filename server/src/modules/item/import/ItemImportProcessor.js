/**
 * CSV parse、mapping、normalization、逐列 domain validation。設計說明見
 * docs/items_management/design_spec.md §5.13、§8.6。
 *
 * 純 business module，唔進 service container，依賴（DB queryable）由呼叫端
 * 傳入——同 ItemAdminService／ItemCatalogService 一路以嚟嘅慣例一致。
 *
 * 呢個模組只做 PREFLIGHT：讀 CSV、驗證、寫 `item_import_rows`，唔碰
 * `items`／`item_skus`。真正套用（confirm 之後嘅 execution）係 T29 嘅事。
 *
 * 只支援 Standard 商品：一列 CSV 對應一個 Item＋SKU pair。`skuId` 空白代表
 * create，有值代表 update（配對用 SKU ID，`skuCode` 淨係顯示／交叉檢查）。
 */
import { parse } from "csv-parse/sync";
import { MONEY_DECIMAL, TRACKING_POLICIES } from "../itemConstants.js";
import { decimalStringPattern, normalizeAndValidateSkuCode } from "../itemValidation.js";
import { IMPORT_TEXT_FIELD_MAX_LENGTH } from "./itemCsvSchema.js";

const MONEY_PATTERN = decimalStringPattern(MONEY_DECIMAL);
const TRUE_FALSE_PATTERN = /^(true|false)$/;

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(list, field, code, message) {
  list.push({ field, code, message });
}

/**
 * 由 DB 查一批 name／code 對 id 嘅對照表。用 exact match（DB collation 本身
 * 就係 case-insensitive），撞到多過一筆就當做 ambiguous——目前 category 只
 * 保證同一父分類底下唯一，唔係全域唯一（見 itemErrors.js
 * `categoryNameTaken()` 的說明），CSV 冇提供 parent 資訊，多過一筆冇辦法
 * 安全咁揀一筆當結果。
 */
async function lookupByColumn(connection, { table, column, values }) {
  const map = new Map();
  const ambiguous = new Set();

  if (values.length === 0) {
    return { map, ambiguous };
  }

  const [rows] = await connection.query(
    `SELECT id, ${column} AS matchValue FROM ${table} WHERE ${column} IN (?)`,
    [values]
  );

  for (const row of rows) {
    const key = row.matchValue.toLowerCase();
    if (map.has(key)) {
      ambiguous.add(key);
    } else {
      map.set(key, row.id);
    }
  }

  return { map, ambiguous };
}

async function lookupSkusByCode(connection, codes) {
  if (codes.length === 0) {
    return new Map();
  }
  const [rows] = await connection.query(
    "SELECT id, sku_code AS matchValue FROM item_skus WHERE sku_code IN (?)",
    [codes]
  );
  return new Map(rows.map((row) => [row.matchValue.toLowerCase(), row.id]));
}

async function lookupSkusById(connection, ids) {
  if (ids.length === 0) {
    return new Map();
  }
  const [rows] = await connection.query(
    "SELECT id, item_id, sku_code, version FROM item_skus WHERE id IN (?)",
    [ids]
  );
  return new Map(rows.map((row) => [row.id, row]));
}

function parseCsv(csvText) {
  try {
    const records = parse(csvText, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true
    });
    return { records };
  } catch (error) {
    return {
      jobLevelError: {
        code: "CSV_MALFORMED",
        message: `CSV 格式錯誤，無法解析：${error.message}`
      }
    };
  }
}

function validateTextField(record, field, { required, errors }) {
  const value = trimmed(record[field]);

  if (!value) {
    if (required) {
      addIssue(errors, field, "REQUIRED_FIELD", `${field} 不可空白`);
    }
    return "";
  }

  if (value.length > IMPORT_TEXT_FIELD_MAX_LENGTH) {
    addIssue(errors, field, "FIELD_TOO_LONG", `${field} 不可超過 ${IMPORT_TEXT_FIELD_MAX_LENGTH} 字`);
    return value.slice(0, IMPORT_TEXT_FIELD_MAX_LENGTH);
  }

  return value;
}

function validateBoolean(record, field, { defaultValue, errors }) {
  const raw = trimmed(record[field]);

  if (!raw) {
    return defaultValue;
  }
  if (!TRUE_FALSE_PATTERN.test(raw)) {
    addIssue(errors, field, "INVALID_BOOLEAN", `${field} 只接受 true 或 false`);
    return defaultValue;
  }
  return raw === "true";
}

function validateTrackingPolicy(record, { errors }) {
  const raw = trimmed(record.defaultTrackingPolicy);

  if (!raw) {
    return "none";
  }
  if (!TRACKING_POLICIES.includes(raw)) {
    addIssue(
      errors,
      "defaultTrackingPolicy",
      "TRACKING_POLICY_INVALID",
      `defaultTrackingPolicy 必須是 ${TRACKING_POLICIES.join("／")} 其中之一`
    );
    return "none";
  }
  return raw;
}

function validatePrice(record, { errors }) {
  const raw = trimmed(record.suggestedPriceAmount);

  if (!raw) {
    return null;
  }
  if (!MONEY_PATTERN.test(raw)) {
    addIssue(
      errors,
      "suggestedPriceAmount",
      "SUGGESTED_PRICE_INVALID",
      `suggestedPriceAmount 必須是最多 ${MONEY_DECIMAL.integerDigits} 位整數、${MONEY_DECIMAL.decimalPlaces} 位小數的金額字串`
    );
    return null;
  }
  return raw;
}

/**
 * 解析並驗證一份 CSV，回傳 `{ jobLevelError }`（成份檔案層級問題，例如超過
 * 列數上限、完全解析唔到）或者 `{ rows, counts }`（逐列結果）。唔會拋錯——
 * 呼叫端（`validateItemImportJob.js`）唔使用 try/catch 包呢個函式嚟區分
 * 「業務層面嘅無效」同「真正嘅程式錯誤」。
 */
export async function parseAndValidateCsv({ csvText, mode, connection, maxRows }) {
  const parsed = parseCsv(csvText);
  if (parsed.jobLevelError) {
    return { jobLevelError: parsed.jobLevelError };
  }

  const { records } = parsed;

  if (records.length === 0) {
    return { jobLevelError: { code: "CSV_EMPTY", message: "CSV 沒有任何資料列" } };
  }
  if (records.length > maxRows) {
    return {
      jobLevelError: {
        code: "CSV_TOO_MANY_ROWS",
        message: `CSV 有 ${records.length} 列，超過 ${maxRows} 列上限`
      }
    };
  }

  const categoryNames = [];
  const brandNames = [];
  const uomCodes = [];
  const skuIds = [];
  const skuCodes = [];

  for (const record of records) {
    const categoryName = trimmed(record.categoryName);
    const brandName = trimmed(record.brandName);
    const baseUomCode = trimmed(record.baseUomCode);
    const skuId = trimmed(record.skuId);
    const skuCode = trimmed(record.skuCode);

    if (categoryName) categoryNames.push(categoryName);
    if (brandName) brandNames.push(brandName);
    if (baseUomCode) uomCodes.push(baseUomCode);
    if (skuId) skuIds.push(skuId);
    if (skuCode) skuCodes.push(skuCode);
  }

  const [categoryLookup, brandLookup, uomLookup, existingByCode, existingById] = await Promise.all([
    lookupByColumn(connection, { table: "item_categories", column: "name", values: [...new Set(categoryNames)] }),
    lookupByColumn(connection, { table: "item_brands", column: "name", values: [...new Set(brandNames)] }),
    lookupByColumn(connection, { table: "item_uoms", column: "code", values: [...new Set(uomCodes)] }),
    lookupSkusByCode(connection, [...new Set(skuCodes)]),
    lookupSkusById(connection, [...new Set(skuIds.map(Number).filter(Number.isFinite))])
  ]);

  const seenCodeInFile = new Map();
  const rows = [];

  records.forEach((record, index) => {
    const rowNumber = index + 1;
    const errors = [];
    const warnings = [];

    const skuIdRaw = trimmed(record.skuId);
    const isUpdate = skuIdRaw !== "";
    const operation = isUpdate ? "update" : "create";

    if (isUpdate && mode !== "upsert") {
      addIssue(errors, "skuId", "MODE_MISMATCH", "只有 upsert 模式的匯入才可以更新既有 SKU");
    }

    const skuCode = validateTextField(record, "skuCode", { required: true, errors });
    const skuName = validateTextField(record, "skuName", { required: true, errors });

    let matchSkuId = null;
    let expectedSkuVersion = null;

    if (isUpdate) {
      const parsedSkuId = Number(skuIdRaw);
      if (!Number.isInteger(parsedSkuId) || parsedSkuId <= 0) {
        addIssue(errors, "skuId", "SKU_ID_INVALID", "skuId 必須是正整數");
      } else {
        matchSkuId = parsedSkuId;
        const existing = existingById.get(parsedSkuId);
        if (!existing) {
          addIssue(errors, "skuId", "SKU_NOT_FOUND", `找不到 skuId ${parsedSkuId} 對應的 SKU`);
        } else if (skuCode && existing.sku_code.toLowerCase() !== skuCode.toLowerCase()) {
          addIssue(
            warnings,
            "skuCode",
            "SKU_CODE_MISMATCH",
            `skuCode 與 skuId ${parsedSkuId} 目前的 Code「${existing.sku_code}」不符，僅供顯示比對，不會用來改 Code`
          );
        }
      }

      const expectedVersionRaw = trimmed(record.expectedSkuVersion);
      if (!expectedVersionRaw) {
        addIssue(errors, "expectedSkuVersion", "REQUIRED_FIELD", "更新既有 SKU 時必須提供 expectedSkuVersion");
      } else {
        const parsedVersion = Number(expectedVersionRaw);
        if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
          addIssue(errors, "expectedSkuVersion", "SKU_VERSION_INVALID", "expectedSkuVersion 必須是正整數");
        } else {
          expectedSkuVersion = parsedVersion;
        }
      }
    } else {
      const codeKey = skuCode.toLowerCase();
      if (skuCode) {
        try {
          normalizeAndValidateSkuCode(skuCode);
        } catch (error) {
          addIssue(errors, "skuCode", error.publicCode ?? "SKU_CODE_INVALID", error.publicMessage ?? "SKU Code 格式不正確");
        }
        if (existingByCode.has(codeKey)) {
          addIssue(errors, "skuCode", "SKU_CODE_TAKEN", `SKU Code「${skuCode}」已被使用`);
        } else if (seenCodeInFile.has(codeKey)) {
          addIssue(
            errors,
            "skuCode",
            "SKU_CODE_DUPLICATED_IN_FILE",
            `SKU Code「${skuCode}」在同一份 CSV 內重複出現（第 ${seenCodeInFile.get(codeKey)} 及第 ${rowNumber} 列）`
          );
        } else {
          seenCodeInFile.set(codeKey, rowNumber);
        }
      }
    }

    const normalizedPayload = { operation, skuCode, skuName };

    if (!isUpdate) {
      const itemName = validateTextField(record, "itemName", { required: true, errors });
      const categoryName = validateTextField(record, "categoryName", { required: true, errors });
      const brandName = validateTextField(record, "brandName", { required: true, errors });
      const baseUomCode = validateTextField(record, "baseUomCode", { required: true, errors });

      let categoryId = null;
      if (categoryName) {
        const key = categoryName.toLowerCase();
        if (categoryLookup.ambiguous.has(key)) {
          addIssue(errors, "categoryName", "CATEGORY_NAME_AMBIGUOUS", `分類名稱「${categoryName}」對應多於一個分類，請改用 API 直接指定 categoryId`);
        } else if (!categoryLookup.map.has(key)) {
          addIssue(errors, "categoryName", "CATEGORY_NOT_FOUND", `找不到分類「${categoryName}」`);
        } else {
          categoryId = categoryLookup.map.get(key);
        }
      }

      let brandId = null;
      if (brandName) {
        const key = brandName.toLowerCase();
        if (brandLookup.ambiguous.has(key)) {
          addIssue(errors, "brandName", "BRAND_NAME_AMBIGUOUS", `品牌名稱「${brandName}」對應多於一個品牌`);
        } else if (!brandLookup.map.has(key)) {
          addIssue(errors, "brandName", "BRAND_NOT_FOUND", `找不到品牌「${brandName}」`);
        } else {
          brandId = brandLookup.map.get(key);
        }
      }

      let baseUomId = null;
      if (baseUomCode) {
        const key = baseUomCode.toLowerCase();
        if (uomLookup.ambiguous.has(key)) {
          addIssue(errors, "baseUomCode", "UOM_CODE_AMBIGUOUS", `單位代碼「${baseUomCode}」對應多於一個單位`);
        } else if (!uomLookup.map.has(key)) {
          addIssue(errors, "baseUomCode", "UOM_NOT_FOUND", `找不到單位「${baseUomCode}」`);
        } else {
          baseUomId = uomLookup.map.get(key);
        }
      }

      Object.assign(normalizedPayload, { itemName, categoryId, brandId, baseUomId });
    } else {
      Object.assign(normalizedPayload, { skuId: matchSkuId, expectedSkuVersion });
    }

    normalizedPayload.defaultTrackingPolicy = validateTrackingPolicy(record, { errors });
    normalizedPayload.suggestedPriceAmount = validatePrice(record, { errors });
    normalizedPayload.purchasable = validateBoolean(record, "purchasable", { defaultValue: true, errors });
    normalizedPayload.sellable = validateBoolean(record, "sellable", { defaultValue: true, errors });

    const status = errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid";

    rows.push({
      rowNumber,
      operation,
      matchSkuId,
      expectedSkuVersion,
      normalizedPayload,
      status,
      errors,
      warnings
    });
  });

  const counts = {
    total: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    warning: rows.filter((row) => row.status === "warning").length,
    invalid: rows.filter((row) => row.status === "invalid").length
  };

  return { rows, counts };
}

// CSV 已知欄位以外嘅任何 header 一律忽略，唔會令解析或驗證失敗——「正確
// 處理未知欄」嘅底線係唔崩潰、唔誤讀，唔要求特意顯示警告；已知欄位清單見
// itemCsvSchema.js。csv-parse 嘅 columns:true 本身就只會將已知 header 名
// 映射做 record 嘅屬性名，呢度嘅欄位存取（record.skuCode 等）自然只會揀到
// 已知欄位，未知欄位嘅內容單純冇被讀到，唔需要額外程式碼去「忽略」佢。
