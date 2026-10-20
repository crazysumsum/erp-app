/**
 * 舊資料導入前嘅相似名稱例外清單（HD-057 A；需求 §16.2）。只讀資料庫，唔寫、唔合併任何嘢，交業務決定。
 *
 *   node src/modules/supplier/similarNameReport.js --database=<DB_NAME> --input <legacy.csv> --output <report.csv>
 *
 * 輸入係準備匯入嘅 CSV（範本 v1）：header 規則、範本說明列、全空白列同行號都同匯入一樣，所以 `row` 對得返
 * 匯入結果嘅行號。每行名稱：
 *   - 同現有 Supplier 比：用 UI 新增時同一個 `SupplierDuplicateCandidates`（同一個門檻 `SUPPLIER_DUPLICATE_NAME_THRESHOLD`、
 *     同一套正規化，每行最多 10 個，同 UI 一樣）；
 *   - 同檔案入面其他行比：同一條 Dice 公式同門檻，key 完全一樣都算。每對只出一次。
 * 名稱唔合法（空白、過長、控制字元）嘅行唔比較，只計數：匯入時佢哋本身就會失敗。
 */
import fs from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

import { isTemplateRow, uploadHeaderError } from "./import/SupplierImportProcessor.js";
import { guardSpreadsheetCell, SUPPLIER_CSV_STRINGIFY_OPTIONS, unguardSpreadsheetCell } from "./import/supplierCsvSchema.js";
import { normalizeSupplierConfig } from "./normalizeSupplierConfig.js";
import { SupplierDuplicateCandidates, uniqueBigrams } from "./supplierDuplicateCandidates.js";
import { normalizeSupplierName } from "./supplierNormalization.js";

export const REPORT_HEADER = ["row", "supplierCode", "supplierName", "matchKind", "matchRow", "matchSupplierId",
  "matchSupplierCode", "matchSupplierName", "score", "exact"];

/** `csv`：Buffer。回傳 `{ rows: [...REPORT_HEADER 次序嘅陣列], counts }`。 */
export async function buildSimilarNameReport({ connection, csv, threshold }) {
  const headerError = uploadHeaderError(csv);
  if (headerError) throw new Error(`${headerError.code}: ${headerError.message}`);
  const [headers, ...records] = parse(csv, { bom: true, skip_empty_lines: true });
  const column = (name) => headers.findIndex((header) => header.trim() === name);
  const [codeAt, nameAt] = [column("supplierCode"), column("supplierName")];

  const entries = [];
  const counts = { rows: 0, invalidNames: 0, existingMatches: 0, fileMatches: 0 };
  for (const values of records) {
    if (isTemplateRow(values[0] ?? "") || values.every((value) => !value.trim())) continue;
    counts.rows += 1;
    const cell = (index) => unguardSpreadsheetCell(String(values[index] ?? "").trim());
    let key;
    try {
      key = normalizeSupplierName(cell(nameAt)).key;
    } catch {
      counts.invalidNames += 1;
      continue;
    }
    entries.push({ row: counts.rows, code: cell(codeAt), name: cell(nameAt), key });
  }

  const report = [];
  const duplicates = new SupplierDuplicateCandidates({ threshold });
  for (const entry of entries) {
    for (const match of await duplicates.find(connection, { nameKey: entry.key })) {
      report.push([entry.row, entry.code, entry.name, "existing", "", match.supplierId, match.supplierCode, match.supplierName,
        match.score.toFixed(4), match.exact]);
      counts.existingMatches += 1;
    }
  }

  // 檔案內：倒排 index 數共有 gram，Dice = 2c/(a+b)，同 bigramDiceScore 一樣。
  // ponytail: 好常見嘅 gram（例如「有限公司」）令呢度變成 O(n²)；匯入上限 10,000 行時仍然係秒級。
  const grams = entries.map((entry) => [...uniqueBigrams(entry.key)]);
  const postings = new Map();
  grams.forEach((list, index) => list.forEach((gram) => {
    if (!postings.has(gram)) postings.set(gram, []);
    postings.get(gram).push(index);
  }));
  const common = new Int32Array(entries.length);
  for (let left = 0; left < entries.length; left += 1) {
    const touched = [];
    for (const gram of grams[left]) {
      for (const right of postings.get(gram)) {
        if (right <= left) continue;
        if (common[right] === 0) touched.push(right);
        common[right] += 1;
      }
    }
    // 少過兩個字元嘅名稱冇 gram，只會完全一樣先算。
    if (grams[left].length === 0) {
      for (let right = left + 1; right < entries.length; right += 1) if (entries[right].key === entries[left].key) touched.push(right);
    }
    for (const right of touched.sort((a, b) => a - b)) {
      const exact = entries[left].key === entries[right].key;
      const score = exact ? 1 : (2 * common[right]) / (grams[left].length + grams[right].length);
      common[right] = 0;
      if (!exact && score < threshold) continue;
      report.push([entries[left].row, entries[left].code, entries[left].name, "file", entries[right].row, "",
        entries[right].code, entries[right].name, score.toFixed(4), exact]);
      counts.fileMatches += 1;
    }
  }
  return { rows: report, counts };
}

export function formatSimilarNameReport(rows) {
  return stringify([REPORT_HEADER, ...rows.map((row) => row.map(guardSpreadsheetCell))], SUPPLIER_CSV_STRINGIFY_OPTIONS);
}

async function main(argv, env) {
  const arg = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [input, output] = [arg("input"), arg("output")];
  if (!input || !output) {
    throw new Error("usage: node src/modules/supplier/similarNameReport.js --database=<DB_NAME> --input <legacy.csv> --output <report.csv>");
  }
  const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]
    .filter((key) => (key === "DB_PASSWORD" ? env[key] === undefined : !env[key]));
  if (missing.length > 0) throw new Error(`set ${missing.join(", ")} explicitly`);
  if (arg("database") !== env.DB_NAME) throw new Error(`--database must repeat DB_NAME (${env.DB_NAME})`);
  const { duplicateNameThreshold: threshold } = normalizeSupplierConfig({ duplicateNameThreshold: env.SUPPLIER_DUPLICATE_NAME_THRESHOLD || 0.85 });
  const { default: mysql } = await import("mysql2/promise");
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME });
  try {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    const { rows, counts } = await buildSimilarNameReport({ connection, csv: await fs.readFile(input), threshold });
    await fs.writeFile(output, formatSimilarNameReport(rows), { flag: "wx" });
    console.log(JSON.stringify({ threshold, ...counts, output }));
  } finally {
    await connection.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
