import assert from "node:assert/strict";
import test from "node:test";
import { parseAndValidateCsv } from "../src/modules/item/import/ItemImportProcessor.js";

// ItemImportProcessor 唔開交易、唔寫 items／item_skus，淨係讀（category／
// brand／UOM／SKU 查表）——一個識答呢幾條 SELECT 嘅假 queryable 就夠，唔使
// 成個 fakeItemCatalogDatabase.js 嗰種假關聯式 DB。真正嘅 SQL 語法（IN
// 子句、collation）唔係呢度嘅責任，交俾 itemImport.integration.test.js
// 對真 MySQL 驗證。

function fakeConnection({ categories = [], brands = [], uoms = [], skusByCode = [], skusById = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM item_categories")) {
        const [names] = params;
        return [categories.filter((row) => names.includes(row.name)).map((row) => ({ id: row.id, matchValue: row.name }))];
      }
      if (sql.includes("FROM item_brands")) {
        const [names] = params;
        return [brands.filter((row) => names.includes(row.name)).map((row) => ({ id: row.id, matchValue: row.name }))];
      }
      if (sql.includes("FROM item_uoms")) {
        const [codes] = params;
        return [uoms.filter((row) => codes.includes(row.code)).map((row) => ({ id: row.id, matchValue: row.code }))];
      }
      if (sql.includes("sku_code AS matchValue")) {
        const [codes] = params;
        return [
          skusByCode
            .filter((row) => codes.includes(row.sku_code))
            .map((row) => ({ id: row.id, matchValue: row.sku_code }))
        ];
      }
      if (sql.includes("item_id, sku_code, version")) {
        const [ids] = params;
        return [skusById.filter((row) => ids.includes(row.id))];
      }
      throw new Error(`Unexpected query in fakeConnection: ${sql}`);
    }
  };
}

const CATEGORY = { id: 1, name: "飲品" };
const BRAND = { id: 2, name: "測試品牌" };
const UOM = { id: 3, code: "EA" };

function baseConnection(overrides = {}) {
  return fakeConnection({ categories: [CATEGORY], brands: [BRAND], uoms: [UOM], ...overrides });
}

function createRow({ skuCode = "SKU-1", skuName = "測試商品", itemName = "測試 Item", categoryName = "飲品", brandName = "測試品牌", baseUomCode = "EA", ...rest } = {}) {
  return { skuCode, skuName, itemName, categoryName, brandName, baseUomCode, ...rest };
}

function csvFrom(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => {
      const value = row[key] ?? "";
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// --- 解析層面：BOM、quoting、malformed、空檔、超列數 ------------------------

test("BOM 會被移除，唔會混入第一個欄位名", async () => {
  const csvText = "﻿" + csvFrom([createRow()]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].status, "valid");
  assert.equal(result.rows[0].normalizedPayload.skuCode, "SKU-1");
});

test("quoted comma／換行喺欄位值入面會原樣保留", async () => {
  const csvText = csvFrom([createRow({ skuName: "貨品, 附逗號\n第二行" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].normalizedPayload.skuName, "貨品, 附逗號\n第二行");
});

test("Unicode 內容原樣通過", async () => {
  const csvText = csvFrom([createRow({ skuName: "維他命 C 90 粒裝 🍊" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].normalizedPayload.skuName, "維他命 C 90 粒裝 🍊");
});

test("未知欄位唔會令解析或驗證失敗，已知欄位一樣讀得到", async () => {
  const csvText = "skuCode,skuName,itemName,categoryName,brandName,baseUomCode,notARealColumn\r\n" +
    "SKU-1,測試商品,測試 Item,飲品,測試品牌,EA,whatever\r\n";
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].status, "valid");
});

test("完全解析唔到嘅 CSV 回 job-level error，唔係拋錯", async () => {
  const csvText = 'skuCode,skuName\r\n"unterminated quote,x\r\n';
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.jobLevelError.code, "CSV_MALFORMED");
});

test("冇任何資料列回 CSV_EMPTY", async () => {
  const csvText = "skuCode,skuName\r\n";
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.jobLevelError.code, "CSV_EMPTY");
});

test("超過 maxRows 回 CSV_TOO_MANY_ROWS，唔會逐列驗證", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => createRow({ skuCode: `SKU-${index}` }));
  const csvText = csvFrom(rows);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 3 });

  assert.equal(result.jobLevelError.code, "CSV_TOO_MANY_ROWS");
  assert.match(result.jobLevelError.message, /5.*3|3.*5/);
});

// --- Create 列驗證 -------------------------------------------------------------

test("Create 列缺必填欄位：REQUIRED_FIELD，status invalid", async () => {
  const csvText = csvFrom([createRow({ itemName: "" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(result.rows[0].errors.some((e) => e.field === "itemName" && e.code === "REQUIRED_FIELD"));
});

test("欄位超過長度上限：FIELD_TOO_LONG，但值會截斷唔會整份 crash", async () => {
  const csvText = csvFrom([createRow({ skuCode: "A".repeat(200) })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].status, "invalid");
  assert.ok(result.rows[0].errors.some((e) => e.field === "skuCode" && e.code === "FIELD_TOO_LONG"));
});

test("categoryName／brandName／baseUomCode 查唔到：對應嘅 NOT_FOUND", async () => {
  const csvText = csvFrom([createRow({ categoryName: "唔存在嘅分類", brandName: "唔存在嘅品牌", baseUomCode: "ZZ" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  const codes = result.rows[0].errors.map((e) => e.code);
  assert.deepEqual(codes.sort(), ["BRAND_NOT_FOUND", "CATEGORY_NOT_FOUND", "UOM_NOT_FOUND"]);
});

test("categoryName 對應多過一個分類（同名唔同 parent）：CATEGORY_NAME_AMBIGUOUS", async () => {
  const connection = baseConnection({ categories: [{ id: 1, name: "飲品" }, { id: 11, name: "飲品" }] });
  const csvText = csvFrom([createRow()]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection, maxRows: 100 });

  assert.ok(result.rows[0].errors.some((e) => e.code === "CATEGORY_NAME_AMBIGUOUS"));
});

test("skuCode 已經存在於 DB：SKU_CODE_TAKEN", async () => {
  const connection = baseConnection({ skusByCode: [{ id: 99, sku_code: "SKU-1" }] });
  const csvText = csvFrom([createRow({ skuCode: "SKU-1" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection, maxRows: 100 });

  assert.ok(result.rows[0].errors.some((e) => e.code === "SKU_CODE_TAKEN"));
});

test("同一份 CSV 入面兩列用相同 skuCode：SKU_CODE_DUPLICATED_IN_FILE", async () => {
  const csvText = csvFrom([createRow({ skuCode: "DUP" }), createRow({ skuCode: "DUP" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection: baseConnection(), maxRows: 100 });

  assert.equal(result.rows[0].status, "valid");
  assert.equal(result.rows[1].status, "invalid");
  assert.ok(result.rows[1].errors.some((e) => e.code === "SKU_CODE_DUPLICATED_IN_FILE"));
});

// --- Update 列驗證（upsert） -----------------------------------------------

test("Update 列：mode 係 create_only 就 MODE_MISMATCH", async () => {
  const connection = baseConnection({ skusById: [{ id: 5, item_id: 1, sku_code: "SKU-5", version: 2 }] });
  const csvText = csvFrom([createRow({ skuId: "5", expectedSkuVersion: "2", itemName: "", categoryName: "", brandName: "", baseUomCode: "" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "create_only", connection, maxRows: 100 });

  assert.ok(result.rows[0].errors.some((e) => e.code === "MODE_MISMATCH"));
});

test("Update 列：skuId 唔存在，SKU_NOT_FOUND", async () => {
  const csvText = csvFrom([createRow({ skuId: "999", expectedSkuVersion: "1" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "upsert", connection: baseConnection(), maxRows: 100 });

  assert.ok(result.rows[0].errors.some((e) => e.field === "skuId" && e.code === "SKU_NOT_FOUND"));
});

test("Update 列：冇提供 expectedSkuVersion，REQUIRED_FIELD", async () => {
  const connection = baseConnection({ skusById: [{ id: 5, item_id: 1, sku_code: "SKU-5", version: 2 }] });
  const csvText = csvFrom([createRow({ skuId: "5", expectedSkuVersion: "" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "upsert", connection, maxRows: 100 });

  assert.ok(result.rows[0].errors.some((e) => e.field === "expectedSkuVersion" && e.code === "REQUIRED_FIELD"));
});

test("Update 列：skuCode 同配對到嘅 SKU 現況唔一致，係 warning 唔係 error，唔會擋住成列", async () => {
  const connection = baseConnection({ skusById: [{ id: 5, item_id: 1, sku_code: "REAL-CODE", version: 2 }] });
  const csvText = csvFrom([createRow({ skuId: "5", expectedSkuVersion: "2", skuCode: "STALE-CODE" })]);
  const result = await parseAndValidateCsv({ csvText, mode: "upsert", connection, maxRows: 100 });

  assert.equal(result.rows[0].status, "warning");
  assert.equal(result.rows[0].errors.length, 0);
  assert.ok(result.rows[0].warnings.some((w) => w.field === "skuCode" && w.code === "SKU_CODE_MISMATCH"));
});

test("Update 列合法：operation=update，match_sku_id／expectedSkuVersion 填好，唔驗 Item 相關欄位", async () => {
  const connection = baseConnection({ skusById: [{ id: 5, item_id: 1, sku_code: "SKU-5", version: 2 }] });
  const csvText = csvFrom([
    { skuId: "5", expectedSkuVersion: "2", skuCode: "SKU-5", skuName: "改咗個名", itemName: "", categoryName: "", brandName: "", baseUomCode: "" }
  ]);
  const result = await parseAndValidateCsv({ csvText, mode: "upsert", connection, maxRows: 100 });

  assert.equal(result.rows[0].status, "valid");
  assert.equal(result.rows[0].operation, "update");
  assert.equal(result.rows[0].matchSkuId, 5);
  assert.equal(result.rows[0].expectedSkuVersion, 2);
  assert.equal(result.rows[0].normalizedPayload.itemName, undefined);
});

// --- 共用欄位正規化 -------------------------------------------------------------

test("defaultTrackingPolicy 唔識嘅值：TRACKING_POLICY_INVALID；空白預設 none", async () => {
  const invalid = await parseAndValidateCsv({
    csvText: csvFrom([createRow({ defaultTrackingPolicy: "not-a-policy" })]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.ok(invalid.rows[0].errors.some((e) => e.code === "TRACKING_POLICY_INVALID"));

  const blank = await parseAndValidateCsv({
    csvText: csvFrom([createRow()]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.equal(blank.rows[0].normalizedPayload.defaultTrackingPolicy, "none");
});

test("suggestedPriceAmount 格式錯誤：SUGGESTED_PRICE_INVALID；空白視為未提供", async () => {
  const invalid = await parseAndValidateCsv({
    csvText: csvFrom([createRow({ suggestedPriceAmount: "12.3" })]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.ok(invalid.rows[0].errors.some((e) => e.code === "SUGGESTED_PRICE_INVALID"));

  const valid = await parseAndValidateCsv({
    csvText: csvFrom([createRow({ suggestedPriceAmount: "128.0000" })]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.equal(valid.rows[0].normalizedPayload.suggestedPriceAmount, "128.0000");
});

test("purchasable／sellable 只接受 true／false 字面值；空白預設 true", async () => {
  const invalid = await parseAndValidateCsv({
    csvText: csvFrom([createRow({ purchasable: "yes" })]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.ok(invalid.rows[0].errors.some((e) => e.field === "purchasable" && e.code === "INVALID_BOOLEAN"));

  const blank = await parseAndValidateCsv({
    csvText: csvFrom([createRow()]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.equal(blank.rows[0].normalizedPayload.purchasable, true);
  assert.equal(blank.rows[0].normalizedPayload.sellable, true);

  const explicit = await parseAndValidateCsv({
    csvText: csvFrom([createRow({ purchasable: "false", sellable: "false" })]),
    mode: "create_only",
    connection: baseConnection(),
    maxRows: 100
  });
  assert.equal(explicit.rows[0].normalizedPayload.purchasable, false);
  assert.equal(explicit.rows[0].normalizedPayload.sellable, false);
});

// --- Job 層級統計 ----------------------------------------------------------------

test("counts 正確反映 valid／warning／invalid 列數", async () => {
  const connection = baseConnection({ skusById: [{ id: 5, item_id: 1, sku_code: "REAL", version: 1 }] });
  const csvText = csvFrom([
    createRow({ skuCode: "OK-1" }),
    createRow({ skuCode: "BAD-1", categoryName: "唔存在" }),
    { skuId: "5", expectedSkuVersion: "1", skuCode: "MISMATCH", skuName: "x", itemName: "", categoryName: "", brandName: "", baseUomCode: "" }
  ]);
  const result = await parseAndValidateCsv({ csvText, mode: "upsert", connection, maxRows: 100 });

  assert.deepEqual(result.counts, { total: 3, valid: 1, warning: 1, invalid: 1 });
});
