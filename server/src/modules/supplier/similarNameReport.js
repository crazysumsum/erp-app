/**
 * 舊資料導入前嘅相似名稱例外清單（HD-057 A；需求 §16.2）。只讀資料庫，唔寫、唔合併任何嘢，交業務決定。
 *
 *   node src/modules/supplier/similarNameReport.js --database=<DB_NAME> --mode=<create_only|upsert> --input=<legacy.csv> --output=<report.csv>
 *
 * 輸入係準備匯入嘅 CSV（範本 v1）：header 規則、CSV 解析、範本說明列、全空白列同行號都同匯入一樣，所以 `row` 對得返
 * 匯入結果嘅行號。每行名稱：
 *   - 同現有 Supplier 比：用 UI 新增時同一個 `SupplierDuplicateCandidates`（同一個門檻同正規化，每行最多 10 個）。
 *     門檻同 UI 一樣讀 `SUPPLIER_DUPLICATE_NAME_THRESHOLD`（DEF-030 修好之後，HD-116 A），冇設就係 0.85。
 *     upsert 模式下，行本身指向嘅 Supplier（按 supplierId，冇就按 Code，同匯入一樣）唔同自己比；名稱留空即係唔改名，唔比較。
 *   - 同檔案入面其他行比：同一條 Dice 公式同門檻。名稱 key 完全一樣嘅行歸做一組，每行指向組入面第一行；
 *     唔同 key 之間每行最多列 10 對（分數高嘅先），超出嘅只計數，咁成千行同名或者近似名都唔會撐爆記憶體。
 * 名稱唔合法（空白、過長、控制字元）嘅行唔比較，只計數：匯入時佢哋本身就會失敗。
 */
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { CsvError, parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

import { CSV_OPTIONS, isTemplateRow, uploadHeaderError } from "./import/SupplierImportProcessor.js";
import { guardSpreadsheetCell, SUPPLIER_CSV_STRINGIFY_OPTIONS, unguardSpreadsheetCell } from "./import/supplierCsvSchema.js";
import { normalizeSupplierConfig } from "./normalizeSupplierConfig.js";
import { SupplierDuplicateCandidates, uniqueBigrams } from "./supplierDuplicateCandidates.js";
import { normalizeSupplierCode, normalizeSupplierName } from "./supplierNormalization.js";

export const REPORT_HEADER = ["row", "supplierCode", "supplierName", "matchKind", "matchRow", "matchSupplierId",
  "matchSupplierCode", "matchSupplierName", "score", "exact"];
export const FILE_MATCHES_PER_ROW = 10;
const MODES = ["create_only", "upsert"];

/** 匯入點揀 target：有 supplierId 用 ID，冇就用 Code（SupplierImportProcessor `match`）。 */
async function upsertTarget(connection, idText, codeText) {
  if (idText) {
    if (!/^[1-9][0-9]{0,15}$/u.test(idText)) return null;
    const [rows] = await connection.query("SELECT id FROM suppliers WHERE id = ?", [Number(idText)]);
    return rows[0] ? Number(rows[0].id) : null;
  }
  let key;
  try {
    key = normalizeSupplierCode(codeText).key;
  } catch {
    return null;
  }
  const [rows] = await connection.query("SELECT id FROM suppliers WHERE supplier_code_key = ?", [key]);
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * `csv`：Buffer。`duplicates` 預設用類別預設門檻；CLI 傳入讀咗設定嘅（同 UI 一樣，DEF-030）。
 * 回傳 `{ rows: [...REPORT_HEADER 次序嘅陣列], counts }`。
 */
export async function buildSimilarNameReport({ connection, csv, mode, duplicates = new SupplierDuplicateCandidates() }) {
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
  const headerError = uploadHeaderError(csv);
  if (headerError) throw new Error(`${headerError.code}: ${headerError.message}`);
  let records;
  try {
    records = parse(csv, CSV_OPTIONS);
  } catch (error) {
    // csv-parse 嘅 message 帶住 cell 內容，唔可以印出嚟（REV-064 H-1）。
    if (error instanceof CsvError) throw new Error("SUPPLIER_IMPORT_CSV_MALFORMED: CSV 格式不符合 RFC 4180（引號或欄數不正確）");
    throw error;
  }
  const [headers, ...body] = records;
  const column = (name) => headers.findIndex((header) => header.trim() === name);
  const [idAt, codeAt, nameAt] = [column("supplierId"), column("supplierCode"), column("supplierName")];
  const threshold = duplicates.threshold;

  const entries = [];
  const counts = { rows: 0, invalidNames: 0, keptNames: 0, existingMatches: 0, identicalRows: 0, fileMatches: 0, fileMatchesNotListed: 0 };
  for (const values of body) {
    if (isTemplateRow(values[0] ?? "") || values.every((value) => !value.trim())) continue;
    counts.rows += 1;
    const cell = (index) => unguardSpreadsheetCell(String(values[index] ?? "").trim());
    const target = mode === "upsert" ? await upsertTarget(connection, cell(idAt), cell(codeAt)) : null;
    if (!cell(nameAt) && target !== null) {
      counts.keptNames += 1;
      continue;
    }
    let key;
    try {
      key = normalizeSupplierName(cell(nameAt)).key;
    } catch {
      counts.invalidNames += 1;
      continue;
    }
    entries.push({ row: counts.rows, code: cell(codeAt), name: cell(nameAt), key, target });
  }

  const report = [];
  const found = new Map();
  for (const entry of entries) {
    const cacheKey = `${entry.key}\u0000${entry.target}`;
    if (!found.has(cacheKey)) found.set(cacheKey, await duplicates.find(connection, { nameKey: entry.key, excludeSupplierId: entry.target }));
    for (const match of found.get(cacheKey)) {
      report.push([entry.row, entry.code, entry.name, "existing", "", match.supplierId, match.supplierCode, match.supplierName,
        match.score.toFixed(4), match.exact]);
      counts.existingMatches += 1;
    }
  }

  // 同一個 key 嘅行：每行指向第一行，O(n)。
  const groups = new Map();
  for (const entry of entries) {
    const first = groups.get(entry.key);
    if (!first) {
      groups.set(entry.key, entry);
      continue;
    }
    report.push([entry.row, entry.code, entry.name, "file", first.row, "", first.code, first.name, (1).toFixed(4), true]);
    counts.identicalRows += 1;
  }

  // 唔同 key 之間：倒排 index 數共有 gram，Dice = 2c/(a+b)，同 bigramDiceScore 一樣。
  // ponytail: 好常見嘅 gram（例如「有限公司」）令計算變成 O(n²)；輸出有上限，所以記憶體唔會爆。
  const keys = [...groups.values()];
  const grams = keys.map((entry) => [...uniqueBigrams(entry.key)]);
  const postings = new Map();
  grams.forEach((list, index) => list.forEach((gram) => {
    if (!postings.has(gram)) postings.set(gram, []);
    postings.get(gram).push(index);
  }));
  const common = new Int32Array(keys.length);
  for (let left = 0; left < keys.length; left += 1) {
    const touched = [];
    for (const gram of grams[left]) {
      for (const right of postings.get(gram)) {
        if (right <= left) continue;
        if (common[right] === 0) touched.push(right);
        common[right] += 1;
      }
    }
    const matches = [];
    for (const right of touched) {
      const score = (2 * common[right]) / (grams[left].length + grams[right].length);
      common[right] = 0;
      if (score >= threshold) matches.push({ right, score });
    }
    matches.sort((a, b) => b.score - a.score || a.right - b.right);
    counts.fileMatches += matches.length;
    counts.fileMatchesNotListed += Math.max(0, matches.length - FILE_MATCHES_PER_ROW);
    for (const { right, score } of matches.slice(0, FILE_MATCHES_PER_ROW)) {
      report.push([keys[left].row, keys[left].code, keys[left].name, "file", keys[right].row, "", keys[right].code, keys[right].name,
        score.toFixed(4), false]);
    }
  }
  counts.fileMatches += counts.identicalRows;
  report.sort((a, b) => a[0] - b[0]);
  return { rows: report, counts, threshold };
}

export function formatSimilarNameReport(rows) {
  return stringify([REPORT_HEADER, ...rows.map((row) => row.map(guardSpreadsheetCell))], SUPPLIER_CSV_STRINGIFY_OPTIONS);
}

const USAGE = "usage: node src/modules/supplier/similarNameReport.js --database=<DB_NAME> --mode=<create_only|upsert> --input=<legacy.csv> --output=<report.csv>";

/** `--name=value` 同 `--name value` 都收。 */
function readArgs(argv) {
  const arg = (name) => {
    const found = argv.find((value) => value.startsWith(`--${name}=`));
    if (found) return found.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : undefined;
  };
  return { database: arg("database"), mode: arg("mode"), input: arg("input"), output: arg("output") };
}

export async function main(argv, env) {
  const { database, mode, input, output } = readArgs(argv);
  if (!input || !output || !MODES.includes(mode)) throw new Error(USAGE);
  const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]
    .filter((key) => (key === "DB_PASSWORD" ? env[key] === undefined : !env[key]));
  if (missing.length > 0) throw new Error(`set ${missing.join(", ")} explicitly`);
  if (database !== env.DB_NAME) throw new Error(`--database must repeat DB_NAME (${env.DB_NAME})`);
  const { default: mysql } = await import("mysql2/promise");
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME });
  try {
    // 之後每句都喺唯讀交易入面跑（autocommit，逐句各自一個 snapshot）；腳本本身只有 SELECT。
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    // 同 server 一樣驗證同讀設定：超出範圍就失敗，唔會靜靜雞用另一個門檻。
    const { duplicateNameThreshold } = normalizeSupplierConfig({ duplicateNameThreshold: env.SUPPLIER_DUPLICATE_NAME_THRESHOLD || undefined });
    const { rows, counts, threshold } = await buildSimilarNameReport({ connection, csv: fs.readFileSync(input), mode,
      duplicates: new SupplierDuplicateCandidates({ threshold: duplicateNameThreshold }) });
    fs.writeFileSync(output, formatSimilarNameReport(rows), { flag: "wx" });
    return { threshold, mode, ...counts, output };
  } finally {
    await connection.end();
  }
}

// realpath：經 symlink 執行時 argv[1] 係 link，import.meta.url 係真路徑（REV-101 L-2）。
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((summary) => console.log(JSON.stringify(summary)), (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
