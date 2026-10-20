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

import { precheckSupplierCsv } from "../../src/modules/supplier/import/SupplierImportProcessor.js";
import { buildSupplierImportTemplate, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierAdminService } from "../../src/modules/supplier/SupplierAdminService.js";
import { buildSimilarNameReport, FILE_MATCHES_PER_ROW, formatSimilarNameReport, main, REPORT_HEADER }
  from "../../src/modules/supplier/similarNameReport.js";
import { bigramDiceScore, replaceSupplierNameGrams, SupplierDuplicateCandidates } from "../../src/modules/supplier/supplierDuplicateCandidates.js";
import { normalizeSupplierName } from "../../src/modules/supplier/supplierNormalization.js";

/** HD-057 A（需求 §16.2）：舊資料導入前嘅相似名稱例外清單，真 MySQL。 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const config = () => ({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const t = randomUUID().slice(0, 8);
const state = { connection: null, supplierIds: [], dir: null };
const report = (csv, mode = "create_only", extra = {}) => buildSimilarNameReport({ connection: state.connection, csv, mode, ...extra });

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

async function existingSupplier(name, code = `SN-${t}-${state.supplierIds.length}`) {
  const now = Date.now();
  const key = normalizeSupplierName(name).key;
  const [inserted] = await state.connection.execute(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', 'active', ?, ?)`, [code, code.toLowerCase(), name, key, now, now]);
  state.supplierIds.push(Number(inserted.insertId));
  await replaceSupplierNameGrams(state.connection, inserted.insertId, key);
  return Number(inserted.insertId);
}

const dataRow = (fields) => SUPPLIER_IMPORT_COLUMN_NAMES.map((column) => fields[column] ?? "");
const blank = SUPPLIER_IMPORT_COLUMN_NAMES.map(() => "");
/** 範本（header、說明列、範例列）加資料列；`rows` 入面 `null` 係一條全空白列。 */
const legacyCsv = (rows) => Buffer.from(buildSupplierImportTemplate() + stringify(
  rows.map((row) => (row === null ? blank : dataRow(Array.isArray(row) ? { supplierCode: row[0], supplierName: row[1] } : row))),
  { record_delimiter: "windows" }));

integrationTest("HD-057 A: legacy rows are matched against existing Suppliers with the create-time checker and against each other exactly as pairwise Dice would, invalid names are only counted", async () => {
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
  const { rows, counts, threshold } = await report(legacyCsv(names));
  assert.equal(threshold, new SupplierDuplicateCandidates().threshold, "the default checker, as UI create uses");
  assert.deepEqual([counts.rows, counts.invalidNames], [8, 1]);

  const existing = rows.filter((row) => row[3] === "existing" && row[5] === acme);
  assert.deepEqual(existing.map((row) => [row[0], row[9]]), [[1, true], [2, false]], JSON.stringify(rows));
  assert.ok(Number(existing[1][8]) >= threshold);
  assert.equal(rows.some((row) => row[0] === 3), false);

  // 檔案內：每對只出一次，同逐對計 bigramDiceScore 嘅結果完全一樣。
  const valid = names.map(([code, name], index) => ({ row: index + 1, code, name })).filter(({ name }) => name);
  const expected = [];
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const [left, right] = [normalizeSupplierName(valid[i].name).key, normalizeSupplierName(valid[j].name).key];
      const score = bigramDiceScore(left, right);
      if (left === right || score >= threshold) expected.push([valid[j].row, valid[i].row, (left === right ? 1 : score).toFixed(4), left === right]);
    }
  }
  // 完全一樣嘅行指向第一行；其他每對由前面嗰行列出。
  const fileRows = rows.filter((row) => row[3] === "file").map((row) => (row[9] ? [row[0], row[4], row[8], row[9]] : [row[4], row[0], row[8], row[9]]));
  assert.deepEqual(fileRows.sort(), expected.sort());
  assert.deepEqual(expected.map(([right, left]) => [left, right]).sort(), [[1, 2], [5, 6], [7, 8]], "control: the brute force finds the planted pairs");
  assert.equal(counts.fileMatches, 3);
});

integrationTest("HD-057 A: row numbers are the import's own, across template rows and blank rows between data rows", async () => {
  const file = legacyCsv([["R1", `Row One ${t}`], null, ["R2", `Row Two ${t}`], null, null, ["R3", `Row Three ${t}`]]);
  const prechecked = [];
  await precheckSupplierCsv({ source: file, mode: "create_only", connection: state.connection,
    catalog: { currencies: new Map(), paymentTerms: new Map() }, maxRows: 100, maxBytes: 1_000_000,
    onRows: async (rows) => { prechecked.push(...rows); } });
  const fromImport = prechecked.map((row) => [row.rowNumber, row.normalizedPayload.root.supplierName]);
  assert.deepEqual(fromImport, [[1, `Row One ${t}`], [2, `Row Two ${t}`], [3, `Row Three ${t}`]]);
  // 三個名稱互相相似；報告嘅行號要同匯入一樣。
  const { rows } = await report(file, "create_only", { duplicates: new SupplierDuplicateCandidates({ threshold: 0.5 }) });
  const named = new Map(rows.flatMap((row) => [[row[0], row[2]], ...(row[4] ? [[row[4], row[7]]] : [])]));
  assert.deepEqual([...named].sort(), fromImport);
});

integrationTest("HD-057 A: thousands of identical or near-identical names finish with bounded output", async () => {
  const identical = Array.from({ length: 3000 }, (_, index) => [`I${index}`, "TBC"]);
  const same = await report(legacyCsv(identical));
  assert.equal(same.counts.identicalRows, 2999);
  assert.equal(same.rows.length, 2999, "each row points to the first, not every pair");
  assert.ok(same.rows.every((row) => row[4] === 1 && row[9] === true));

  // 每兩個都相似（只差一個數字）：每行最多列 FILE_MATCHES_PER_ROW 對，其餘只計數。
  const near = Array.from({ length: 300 }, (_, index) => [`N${index}`, `Northwind Branch Office Number ${String(index).padStart(3, "0")}`]);
  const close = await report(legacyCsv(near), "create_only", { duplicates: new SupplierDuplicateCandidates({ threshold: 0.8 }) });
  assert.ok(close.rows.length <= near.length * FILE_MATCHES_PER_ROW, `${close.rows.length} rows`);
  assert.ok(close.counts.fileMatchesNotListed > 0, "control: some row has more than the cap");
  assert.equal(close.rows.length + close.counts.fileMatchesNotListed, close.counts.fileMatches);
});

integrationTest("HD-057 A: in upsert mode a row never matches its own Supplier and a blank name keeps it; create mode does not resolve targets", async () => {
  const code = `UP-${t}`;
  const own = await existingSupplier(`Upsert Self Check ${t}`, code);
  const file = legacyCsv([{ supplierCode: code, supplierName: `Upsert Self Check ${t}` }, { supplierId: String(own), supplierName: "" }]);
  const upsert = await report(file, "upsert");
  assert.equal(upsert.rows.some((row) => row[3] === "existing" && row[5] === own), false, JSON.stringify(upsert.rows));
  assert.deepEqual([upsert.counts.keptNames, upsert.counts.invalidNames], [1, 0]);
  const create = await report(file, "create_only");
  assert.ok(create.rows.some((row) => row[3] === "existing" && row[5] === own), "control: without upsert the row matches the Supplier");
  assert.equal(create.counts.invalidNames, 1);
  await assert.rejects(() => report(file, "merge"), /mode must be one of create_only, upsert/u);
});

integrationTest("HD-057 A: header and body errors are refused like an upload without echoing cells, and formula-like names are guarded in the output", async () => {
  await assert.rejects(() => report(Buffer.from("supplierCode,supplierName,bankAccount\r\nA,B,1\r\n")), /SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN/u);
  await assert.rejects(() => report(Buffer.from("supplierCode\r\nA\r\n")), /SUPPLIER_IMPORT_HEADER_MISSING/u);
  const header = stringify([SUPPLIER_IMPORT_COLUMN_NAMES]);
  await assert.rejects(() => report(Buffer.from(`${header}A,"Secret Holdings "x${",".repeat(SUPPLIER_IMPORT_COLUMN_NAMES.length - 2)}\r\n`)),
    (error) => /SUPPLIER_IMPORT_CSV_MALFORMED/u.test(error.message) && !/Secret/u.test(error.message));

  // 匯出防公式加嘅 `'` 讀入時拎走；寫報告時再加返，試算表唔會執行。
  const formula = await report(legacyCsv([["F1", `'=Hyperlink Trading ${t}`], ["F2", `=Hyperlink Trading ${t}`]]));
  assert.deepEqual(formula.rows.map((row) => [row[2], row[9]]), [[`=Hyperlink Trading ${t}`, true]]);
  const [head, line] = parse(formatSimilarNameReport(formula.rows), { bom: true });
  assert.deepEqual(head, REPORT_HEADER);
  assert.equal(line[2], `'=Hyperlink Trading ${t}`);
});

integrationTest("HD-057 A: the command runs in a read-only session with the documented arguments, through a symlink too, and never overwrites a file", async () => {
  await existingSupplier(`Northwind Paper Company ${t}`);
  const input = path.join(state.dir, "legacy.csv");
  await fs.writeFile(input, legacyCsv([["N1", `Northwind Paper Company ${t}`]]));
  const entry = new URL("../../src/modules/supplier/similarNameReport.js", import.meta.url).pathname;
  const link = path.join(state.dir, "link.js");
  await fs.symlink(entry, link);
  const run = (script, args) => promisify(execFile)(process.execPath, [script, ...args], { env: { ...process.env } });

  // 文件寫法：`--name value`。
  const output = path.join(state.dir, "report.csv");
  const { stdout } = await run(entry, ["--database", process.env.DB_NAME, "--mode", "create_only", "--input", input, "--output", output]);
  assert.deepEqual(JSON.parse(stdout), { threshold: new SupplierDuplicateCandidates().threshold, mode: "create_only", rows: 1,
    invalidNames: 0, keptNames: 0, existingMatches: 1, identicalRows: 0, fileMatches: 0, fileMatchesNotListed: 0, output });
  const [, line] = parse(await fs.readFile(output), { bom: true });
  assert.deepEqual([line[0], line[3], line[9]], ["1", "existing", "true"]);

  const viaLink = path.join(state.dir, "via-link.csv");
  await run(link, [`--database=${process.env.DB_NAME}`, "--mode=create_only", `--input=${input}`, `--output=${viaLink}`]);
  assert.ok((await fs.stat(viaLink)).size > 0, "a symlinked entry still runs");

  await assert.rejects(run(entry, [`--database=${process.env.DB_NAME}`, "--mode=create_only", `--input=${input}`, `--output=${output}`]), /EEXIST/u);
  await assert.rejects(run(entry, ["--database=other", "--mode=create_only", `--input=${input}`, `--output=${output}.2`]), /--database must repeat DB_NAME/u);
  await assert.rejects(run(entry, [`--database=${process.env.DB_NAME}`, `--input=${input}`, `--output=${output}.3`]), /usage:.*--mode=<create_only\|upsert>/u);

  // 唯讀：session 一開始就設定，之後寫入會被 MySQL 拒絕。斷言失敗都要關連線，否則測試會卡住而唔係失敗。
  const statements = [];
  const recorder = await mysql.createConnection(config());
  const realCreate = mysql.createConnection;
  mysql.createConnection = async () => ({ query: (sql, ...rest) => { statements.push(sql); return recorder.query(sql, ...rest); },
    end: async () => {} });
  try {
    await main([`--database=${process.env.DB_NAME}`, "--mode=create_only", `--input=${input}`, `--output=${output}.4`], process.env);
    mysql.createConnection = realCreate;
    assert.equal(statements[0], "SET SESSION TRANSACTION READ ONLY");
    assert.ok(statements.slice(1).every((sql) => /^\s*SELECT/u.test(sql)), statements.join("\n"));
    await assert.rejects(recorder.query("UPDATE suppliers SET notes = notes WHERE id = 0"), /READ ONLY/u);
  } finally {
    mysql.createConnection = realCreate;
    await recorder.end();
  }
});

integrationTest("HD-057 A (DEF-030): UI create's checker ignores SUPPLIER_DUPLICATE_NAME_THRESHOLD, so the report does too", () => {
  // DEF-030 修好嗰陣呢個測試會轉紅：到時報告要跟住讀同一個設定。
  const service = new SupplierAdminService({ database: {}, logger: {}, time: {}, businessMaster: {} });
  assert.equal(service.duplicates.threshold, new SupplierDuplicateCandidates().threshold);
});
