/**
 * 將後端錯誤嘅 `error.details` 拆做 `{ field: message }`，俾表單逐個欄位
 * 顯示錯誤。後端有兩種唔同形狀嘅 `details`，呢度要識分：
 *
 *   1. Request schema 驗證錯誤（見 server/src/framework/validation/
 *      requestValidator.js）：`[{ location, path, keyword, message }]`，
 *      `path` 係 JSON pointer（例如 `/item/name`、`/skus/0/skuCode`）。
 *      同 FormPanel.vue 嘅 `detailsToFieldErrors()` 用嘅係同一種形狀。
 *   2. Domain 完整性錯誤（例如 `ITEM_NOT_ACTIVATABLE`，見
 *      server/src/modules/item/itemValidation.js 嘅 `assertSkuActivatable()`）：
 *      `{ issues: [{ field, code, message }] }`，`field` 已經係扁平字串
 *      （唔係 JSON pointer）。
 *
 * FormPanel.vue 淨係識形狀 1——呢個頁面唔用 FormPanel（表單太複雜、要分幾個
 * section，唔係一個扁平物件），所以自己處理埋形狀 2。
 */
export function mapValidationDetailsToFieldErrors(details, options = {}) {
  if (!details) {
    return {};
  }

  if (Array.isArray(details)) {
    return fromSchemaDetails(details);
  }

  if (Array.isArray(details.issues)) {
    return fromIssues(details.issues, options);
  }

  return {};
}

/**
 * `assertSkuActivatable()` 嘅 `issue.field` 係扁平、冧住個 SKU 本身概念嘅
 * 名（例如 `categoryId`、`uoms`、`suggestedPriceAmount`），唔係表單提交
 * body 嗰個巢狀 JSON path——呢個對照表將佢哋翻譯做表單實際用緊嘅
 * dotted path，等呢啲錯誤都可以做到 field-level binding，唔淨係跌落
 * 摘要。`categoryId` 係 Item 層面嘅欄位，其餘全部屬於 SKU（見
 * server/src/modules/item/itemValidation.js 嘅 `addIssue()` 呼叫）。
 */
const ITEM_LEVEL_ISSUE_FIELDS = new Set(["categoryId"]);
const SKU_ISSUE_FIELD_ALIASES = Object.freeze({
  code: "skuCode",
  name: "skuName"
});

function fromSchemaDetails(details) {
  const result = {};

  for (const detail of details) {
    if (detail.location !== "body" || !detail.path) {
      continue;
    }

    const field = detail.path.replace(/^\//, "").replace(/\//g, ".");
    if (!result[field]) {
      result[field] = detail.message;
    }
  }

  return result;
}

function fromIssues(issues, { skuFieldPrefix = "skus.0." } = {}) {
  const result = {};

  for (const issue of issues) {
    if (!issue.field) {
      continue;
    }

    const field = ITEM_LEVEL_ISSUE_FIELDS.has(issue.field)
      ? `item.${issue.field}`
      : `${skuFieldPrefix}${SKU_ISSUE_FIELD_ALIASES[issue.field] ?? issue.field}`;

    if (!result[field]) {
      result[field] = issue.message;
    }
  }

  return result;
}

/** 攞返未對應到任何已知欄位嘅錯誤，做摘要用（design_spec §7.4：「無法對應
 * 的顯示於摘要」）。`knownFields` 係頁面實際有做 field-level binding 嘅
 * 欄位名集合；冧唔到嘅（例如巢狀陣列入面某一列）留喺摘要度，唔會靜靜哋
 * 唔見咗。 */
export function unmatchedFieldErrors(fieldErrors, knownFields) {
  return Object.entries(fieldErrors)
    .filter(([field]) => !knownFields.has(field))
    .map(([field, message]) => ({ field, message }));
}
