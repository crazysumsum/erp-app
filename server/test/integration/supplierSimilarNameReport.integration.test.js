import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import mysql from "mysql2/promise";

import { buildSupplierImportTemplate, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { buildSimilarNameReport, formatSimilarNameReport, REPORT_HEADER } from "../../src/modules/supplier/similarNameReport.js";
import { bigramDiceScore, replaceSupplierNameGrams } from "../../src/modules/supplier/supplierDuplicateCandidates.js";
import { normalizeSupplierName } from "../../src/modules/supplier/supplierNormalization.js";

/** HD-057 A（需求 §16.2）：舊資料導入前嘅相似名稱例外清單，真 MySQL。 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const config = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const t = randomUUID().slice(0, 8);
const state = { connection: null, supplierIds: [], dir: null };

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  state.connection = await mysql.createConnection(config());
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), "similar-names-"));
});

after(async () => {
  if (!state.connection) return;
  if (state.supplierIds.length > 0) await state.connection.query("DELETE FROM suppliers WHERE id IN (?)", [state.supplierIds]);
  await state.connection.end();
  await fs.rm(state.dir, { recursive: true, force: true });
});

async function existingSupplier(name) {
  const now = Date.now();
  const key = normalizeSupplierName(name).key;
  const [inserted] = await state.connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', 'active', ?, ?)`, [`SN-${t}-${state.supplierIds.length}`, `sn-${t}-${state.supplierIds.length}`, name, key, now, now]);
  state.supplierIds.push(Number(inserted.insertId));
  await replaceSupplierNameGrams(state.connection, inserted.insertId, key);
  return Number(inserted.insertId);
}

/** 範本（header、說明列、範例列）加一條全空白列，再加資料列。 */
const legacyCsv = (rows) => Buffer.from(buildSupplierImportTemplate() + stringify([
  SUPPLIER_IMPORT_COLUMN_NAMES.map(() => ""),
  ...rows.map(([code, name]) => SUPPLIER_IMPORT_COLUMN_NAMES.map((column) => ({ supplierCode: code, supplierName: name })[column] ?? ""))
], { record_delimiter: "windows" }));

integrationTest("HD-057 A: legacy rows are matched against existing Suppliers with the create-time rules and against each other, row numbers follow the import, invalid names are only counted", async () => {
  const acme = await existingSupplier(`Acme Trading Limited ${t}`);
  const names = [
    ["L1", `ACME  trading limited ${t}`], // 1：同現有完全一樣（大小寫、空白正規化之後）
    ["L2", `Acme Tradin Limited ${t}`], // 2：相似
    ["L3", `Quiet River Bakery ${t}`], // 3：乜都唔似
    ["L4", ""], // 4：名稱唔合法
    ["L5", `Zeta Holdings ${t}`], // 5、6：檔案內相似
    ["L6", `Zeta Holding ${t}`],
    ["L7", "Ｑ"], // 7、8：一個字元，NFKC 之後完全一樣
    ["L8", "q"]
  ];
  const { rows, counts } = await buildSimilarNameReport({ connection: state.connection, csv: legacyCsv(names), threshold: 0.85 });
  assert.deepEqual(counts.rows, 8);
  assert.deepEqual(counts.invalidNames, 1);

  const existing = rows.filter((row) => row[3] === "existing" && row[5] === acme);
  assert.deepEqual(existing.map((row) => [row[0], row[9]]), [[1, true], [2, false]], JSON.stringify(rows));
  assert.ok(Number(existing[1][8]) >= 0.85);
  assert.equal(rows.some((row) => row[0] === 3), false);

  // 檔案內：每對只出一次，同逐對計 bigramDiceScore 嘅結果完全一樣。
  const valid = names.map(([code, name], index) => ({ row: index + 1, code, name })).filter(({ name }) => name);
  const expected = [];
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const [left, right] = [normalizeSupplierName(valid[i].name).key, normalizeSupplierName(valid[j].name).key];
      const score = bigramDiceScore(left, right);
      if (left === right || score >= 0.85) expected.push([valid[i].row, valid[j].row, score.toFixed(4), left === right]);
    }
  }
  const fileRows = rows.filter((row) => row[3] === "file");
  assert.deepEqual(fileRows.map((row) => [row[0], row[4], row[8], row[9]]), expected);
  assert.deepEqual(expected.map(([left, right]) => [left, right]), [[1, 2], [5, 6], [7, 8]], "control: the brute force finds the planted pairs");
  assert.equal(counts.fileMatches, 3);
});

integrationTest("HD-057 A: a stricter threshold drops a near match, header errors are refused like an upload, and formula-like names are guarded in the output", async () => {
  const pair = [["T1", `Harbour Freight Services ${t}`], ["T2", `Harbour Freight Service ${t}`]];
  const loose = await buildSimilarNameReport({ connection: state.connection, csv: legacyCsv(pair), threshold: 0.85 });
  const strict = await buildSimilarNameReport({ connection: state.connection, csv: legacyCsv(pair), threshold: 0.99 });
  assert.equal(loose.counts.fileMatches, 1);
  assert.equal(strict.counts.fileMatches, 0);

  await assert.rejects(() => buildSimilarNameReport({ connection: state.connection, csv: Buffer.from("supplierCode,supplierName,bankAccount\r\nA,B,1\r\n"), threshold: 0.85 }),
    /SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN/u);
  await assert.rejects(() => buildSimilarNameReport({ connection: state.connection, csv: Buffer.from("supplierCode\r\nA\r\n"), threshold: 0.85 }),
    /SUPPLIER_IMPORT_HEADER_MISSING/u);

  // 匯出防公式加嘅 `'` 讀入時拎走；寫報告時再加返，試算表唔會執行。
  const formula = await buildSimilarNameReport({ connection: state.connection,
    csv: legacyCsv([["F1", `'=Hyperlink Trading ${t}`], ["F2", `=Hyperlink Trading ${t}`]]), threshold: 0.85 });
  assert.deepEqual(formula.rows.map((row) => [row[2], row[9]]), [[`=Hyperlink Trading ${t}`, true]]);
  const [header, line] = parse(formatSimilarNameReport(formula.rows), { bom: true });
  assert.deepEqual(header, REPORT_HEADER);
  assert.equal(line[2], `'=Hyperlink Trading ${t}`);
});

integrationTest("HD-057 A: the command writes the report, prints counts, and never overwrites an existing file", async () => {
  await existingSupplier(`Northwind Paper Company ${t}`);
  const input = path.join(state.dir, "legacy.csv");
  const output = path.join(state.dir, "report.csv");
  await fs.writeFile(input, legacyCsv([["N1", `Northwind Paper Company ${t}`]]));
  const entry = new URL("../../src/modules/supplier/similarNameReport.js", import.meta.url).pathname;
  const run = (args) => promisify(execFile)(process.execPath, [entry, ...args], { env: { ...process.env } });
  const { stdout } = await run([`--database=${process.env.DB_NAME}`, `--input=${input}`, `--output=${output}`]);
  assert.deepEqual(JSON.parse(stdout), { threshold: Number(process.env.SUPPLIER_DUPLICATE_NAME_THRESHOLD || 0.85), rows: 1, invalidNames: 0,
    existingMatches: 1, fileMatches: 0, output });
  const [, line] = parse(await fs.readFile(output), { bom: true });
  assert.deepEqual([line[0], line[3], line[9]], ["1", "existing", "true"]);
  await assert.rejects(run([`--database=${process.env.DB_NAME}`, `--input=${input}`, `--output=${output}`]), /EEXIST/u);
  await assert.rejects(run([`--database=other`, `--input=${input}`, `--output=${output}.2`]), /--database must repeat DB_NAME/u);
});
