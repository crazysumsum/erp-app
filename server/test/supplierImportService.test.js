import assert from "node:assert/strict";
import test from "node:test";

import {
  assertJobTransition,
  assertRowStatement,
  countsFromRows,
  IMPORT_JOB_STATUSES,
  IMPORT_JOB_TRANSITIONS,
  SupplierImportService
} from "../src/modules/supplier/SupplierImportService.js";
import { SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";

/**
 * TASK-042：狀態機同統計重建。交易規則（鎖、rollback、marker、lease）喺
 * test/integration/supplierImportExecution.integration.test.js 打真 MySQL。
 */

test("the job state machine covers the ten designed states and only the designed moves", () => {
  assert.deepEqual([...IMPORT_JOB_STATUSES].sort(), Object.keys(IMPORT_JOB_TRANSITIONS).sort());
  assert.equal(IMPORT_JOB_STATUSES.length, 10);
  for (const terminal of ["completed", "completed_with_errors", "failed", "cancelled"]) {
    assert.deepEqual(IMPORT_JOB_TRANSITIONS[terminal], [], `${terminal} is terminal`);
  }
  assert.doesNotThrow(() => assertJobTransition("queued", "running"));
  assert.doesNotThrow(() => assertJobTransition("running", "running"), "a dead worker's job is taken over");
  for (const [from, to] of [["running", "cancelled"], ["ready", "running"], ["completed", "running"], ["validating", "queued"]]) {
    assert.throws(() => assertJobTransition(from, to), TypeError, `${from} -> ${to}`);
  }
});

test("job counts are rebuilt from row statuses, with invalid rows still pending until they are skipped", () => {
  assert.deepEqual(countsFromRows([
    { status: "applied", total: 3 }, { status: "failed", total: "2" }, { status: "skipped", total: 1 }
  ]), { total: 6, applied: 3, failed: 2, skipped: 1, pending: 0 });
  assert.deepEqual(countsFromRows([{ status: "valid", total: 1 }, { status: "warning", total: 1 }, { status: "invalid", total: 1 }]),
    { total: 3, applied: 0, failed: 0, skipped: 0, pending: 3 });
  assert.deepEqual(countsFromRows([]), { total: 0, applied: 0, failed: 0, skipped: 0, pending: 0 });
});

test("the execution API refuses malformed input before touching the database", async () => {
  const database = { withTransaction() { throw new Error("must not be reached"); } };
  const importer = new SupplierImportService({ database, time: { nowMs: () => 1 } });
  await assert.rejects(() => importer.claimForExecution({ leaseOwner: " ", leaseDurationMs: 1 }), TypeError);
  await assert.rejects(() => importer.claimForExecution({ leaseOwner: "w", leaseDurationMs: 0 }), TypeError);
  await assert.rejects(() => importer.processNextRow({ jobId: 1, leaseOwner: "w", leaseDurationMs: 1 }), TypeError,
    "no applyRow, no execution");
  await assert.rejects(() => importer.processNextRow({ jobId: 0, leaseOwner: "w", leaseDurationMs: 1, applyRow() {} }), TypeError);
  await assert.rejects(() => importer.finalizeExecution({ jobId: 1, leaseOwner: "" }), TypeError);
  assert.throws(() => new SupplierImportService({ database }), TypeError);
});

test("applyRow's connection admits data statements only, however a control statement is spelled (REV-062 M-4)", () => {
  for (const sql of ["/* x */ COMMIT", "-- x\nCOMMIT", "# x\nCOMMIT", "/*!COMMIT*/", "START /*x*/ TRANSACTION", "commit",
    "ROLLBACK", "SAVEPOINT a", "BEGIN", "XA START 'x'", "ANALYZE TABLE suppliers", "OPTIMIZE TABLE suppliers",
    "CHECK TABLE suppliers", "FLUSH TABLES", "CALL p()", "PREPARE s FROM 'COMMIT'", "EXECUTE s", "DO 1",
    "SET @@autocommit = 0", "SET foreign_key_checks = 0", "SET NAMES latin1", "SET SESSION sql_mode = ''",
    "LOCK TABLES suppliers WRITE", "CREATE TABLE t (a INT)", "LOAD DATA INFILE 'x' INTO TABLE suppliers",
    "SELECT 1 INTO OUTFILE '/tmp/x'", "SELECT 1 INTO/**/OUTFILE '/tmp/x'", "SELECT /*!COMMIT*/ 1",
    "SET @x = (SELECT 1)", "DO (SELECT 1)", "", undefined, { sql: "COMMIT" }]) {
    assert.throws(() => assertRowStatement(sql), (error) => error instanceof TypeError && error.code === "SUPPLIER_IMPORT_STATEMENT_REFUSED",
      JSON.stringify(sql));
  }
  for (const sql of ["SELECT id FROM suppliers WHERE id = ? FOR UPDATE", "SELECT 1 LOCK IN SHARE MODE",
    "INSERT INTO t (release_date) VALUES (?)", "UPDATE t SET commit_hash = ?", "/* note */ SELECT 1",
    "-- note\nDELETE FROM t WHERE id = ?", "WITH x AS (SELECT 1) SELECT * FROM x", "replace into t values (1)"]) {
    assert.doesNotThrow(() => assertRowStatement(sql), sql);
  }
});

// 上載要一個正確嘅 v1 header 先會寫檔（HD-054 A）。
const VALID_HEADER = Buffer.from(`${SUPPLIER_IMPORT_COLUMN_NAMES.join(",")}\r\n`);

test("upload refuses an empty or oversized file and an unknown mode before anything is written", async () => {
  const importer = new SupplierImportService({
    database: { async withTransaction() { throw new Error("must not reach the database"); } }, time: { nowMs: () => 1 }
  });
  const upload = (overrides) => importer.createFromUpload({
    actorId: 1, root: "/nonexistent/supplier-import-root", mode: "create_only", content: VALID_HEADER,
    maxFileBytes: VALID_HEADER.length, ...overrides
  });
  await assert.rejects(() => upload({ content: Buffer.concat([VALID_HEADER, Buffer.from("x")]) }),
    { publicCode: "SUPPLIER_IMPORT_FILE_TOO_LARGE", statusCode: 413 });
  await assert.rejects(() => upload({ content: Buffer.alloc(0) }), { publicCode: "SUPPLIER_IMPORT_FILE_REQUIRED", statusCode: 400 });
  await assert.rejects(() => upload({ mode: "replace" }), { publicCode: "SUPPLIER_IMPORT_MODE_INVALID" });
  await assert.rejects(() => upload({ root: null }), { publicCode: "SUPPLIER_IMPORT_UNAVAILABLE", statusCode: 503 });
  // 啱啱好喺上限：過咗檢查，去到寫檔（呢個 root 唔存在，所以喺檔案系統度失敗）。
  await assert.rejects(() => upload({}), { code: "ENOENT" });
});

test("an upload whose file cannot be removed after a failed insert is logged, without content (REV-064 L-1)", async (t) => {
  const { chmod, mkdtemp, readdir, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { prepareSupplierImportRoot } = await import("../src/services/supplierImport/supplierImportFiles.js");
  const base = await mkdtemp(path.join(os.tmpdir(), "supplier-import-cleanup-"));
  const root = await prepareSupplierImportRoot(path.join(base, "imports"));
  const source = path.join(root, "source");
  t.after(async () => { await chmod(source, 0o700); await rm(base, { recursive: true, force: true }); });
  const logged = [];
  const importer = new SupplierImportService({
    database: { async withTransaction(work) { return work({}); } }, time: { nowMs: () => 1 },
    logger: { error: (event, _message, context) => logged.push([event, context]) },
    // 驗 actor 嗰陣令 source 目錄唔寫得，再拒絕：刪檔一定失敗。
    authorize: async () => { await chmod(source, 0o500); throw Object.assign(new Error("stale"), { code: "STALE" }); }
  });
  await assert.rejects(() => importer.createFromUpload({
    actorId: 1, root, mode: "create_only", content: VALID_HEADER, maxFileBytes: VALID_HEADER.length
  }), { code: "STALE" }, "the original error is still what the caller gets");
  const [stored] = await readdir(source);
  assert.deepEqual(logged, [["supplier.import.source_cleanup_failed", { storedName: stored, code: "EACCES" }]]);
});

test("a file with a Bank column is refused at upload before anything is written (HD-053 A)", async () => {
  const importer = new SupplierImportService({
    database: { async withTransaction() { throw new Error("must not reach the database"); } }, time: { nowMs: () => 1 }
  });
  // 呢個 root 唔存在：如果檢查喺寫檔之後，會見到 ENOENT 而唔係 400。
  const upload = (content) => importer.createFromUpload({
    actorId: 1, root: "/nonexistent/supplier-import-root", mode: "create_only", content: Buffer.from(content), maxFileBytes: 10_000
  });
  await assert.rejects(() => upload("\uFEFFsupplierCode, IBAN \r\nS1,GB29NWBK60161331926819\r\n"),
    (error) => error.publicCode === "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN" && error.statusCode === 400 &&
      /第 2 欄/u.test(error.publicMessage) && !JSON.stringify(error).includes("GB29"));
  // HD-054 A：開頭空行唔可以令上載同 precheck 讀到唔同嘅 header（REV-065 M-1）；讀唔到嘅 header 亦都唔存。
  for (const [label, content, code] of [
    ["leading CRLF", "\r\nsupplierCode,IBAN\r\nS1,GB29NWBK60161331926819\r\n", "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN"],
    ["leading LF", "\nsupplierCode,IBAN\n", "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN"],
    ["BOM then CRLF", "\uFEFF\r\nsupplierCode,IBAN\r\n", "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN"],
    ["stray quote in the header", 'acct"no,x\r\n', "SUPPLIER_IMPORT_CSV_MALFORMED"],
    ["whitespace-only first line", "   \r\nsupplierCode\r\n", "SUPPLIER_IMPORT_HEADER_UNKNOWN"],
    ["unknown column", "supplierCode,rating\r\n", "SUPPLIER_IMPORT_HEADER_UNKNOWN"],
    ["blank lines only", "\r\n\r\n", "SUPPLIER_IMPORT_CSV_EMPTY"]
  ]) {
    await assert.rejects(() => upload(content), { publicCode: code, statusCode: 400 }, label);
  }
  await assert.rejects(() => importer.createFromUpload({ actorId: 1, root: "/nonexistent/supplier-import-root", mode: "create_only",
    content: Buffer.from([0x73, 0xff, 0x0d, 0x0a]), maxFileBytes: 100 }), { publicCode: "SUPPLIER_IMPORT_CSV_NOT_UTF8", statusCode: 400 });
});

test("the upload check and precheck read the same header from the same bytes (REV-065 M-1)", async () => {
  const { precheckSupplierCsv, uploadHeaderError } = await import("../src/modules/supplier/import/SupplierImportProcessor.js");
  const { SUPPLIER_IMPORT_COLUMN_NAMES } = await import("../src/modules/supplier/import/supplierCsvSchema.js");
  const template = SUPPLIER_IMPORT_COLUMN_NAMES.join(",");
  const cases = {
    "valid header": `${template}\r\n${SUPPLIER_IMPORT_COLUMN_NAMES.map((name) =>
      ({ supplierCode: "S1", supplierName: "Acme", defaultCurrencyCode: "HKD" })[name] ?? "").join(",")}\r\n`,
    "leading CRLF + Bank": `\r\n${template},IBAN\r\n`,
    "leading LF + Bank": `\n${template},IBAN\n`,
    "BOM + CRLF + Bank": `\uFEFF\r\n${template},IBAN\r\n`,
    "multi-line quoted Bank header": `"Bank\r\nAccount",${template}\r\n`,
    "missing column": `${SUPPLIER_IMPORT_COLUMN_NAMES.slice(1).join(",")}\r\n`,
    "duplicate column": `${template},notes\r\n`,
    "stray quote": `acct"x,${template}\r\n`,
    "whitespace line": ` \r\n${template}\r\n`,
    "blank only": "\r\n"
  };
  const headerCodes = new Set(["SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN", "SUPPLIER_IMPORT_HEADER_UNKNOWN", "SUPPLIER_IMPORT_HEADER_MISSING",
    "SUPPLIER_IMPORT_HEADER_DUPLICATE", "SUPPLIER_IMPORT_CSV_MALFORMED", "SUPPLIER_IMPORT_CSV_EMPTY", "SUPPLIER_IMPORT_CSV_NOT_UTF8"]);
  for (const [label, text] of Object.entries(cases)) {
    const atUpload = uploadHeaderError(Buffer.from(text))?.code ?? null;
    const result = await precheckSupplierCsv({
      source: Buffer.from(text), mode: "create_only", connection: { async query() { return [[]]; } },
      catalog: { currencies: new Map(), paymentTerms: new Map() }, maxRows: 10, maxBytes: 100_000, onRows: async () => {}
    });
    const atPrecheck = headerCodes.has(result.jobLevelError?.code) ? result.jobLevelError.code : null;
    // 拒唔拒絕一定要一致：上載放行嘅檔，precheck 唔可以喺 header 層面拒絕。代碼可以唔同：csv-parse 一次過
    // 讀晒成段，precheck 可能先撞到後面一列嘅欄數錯（MALFORMED），上載只讀第一列（例如 HEADER_UNKNOWN）。
    assert.equal(atUpload !== null, atPrecheck !== null, label);
    if (label.includes("Bank")) assert.deepEqual([atUpload, atPrecheck], Array(2).fill("SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN"), label);
  }
});

test("the import applier never runs the similar-name search, on create or update (HD-052, HD-075)", async () => {
  const { createSupplierImportApplier } = await import("../src/modules/supplier/import/applySupplierImportRow.js");
  const calls = [];
  const suppliers = {
    async createSupplierInTransaction(_connection, options) { calls.push(["create", options.findDuplicates]); return { id: 41 }; },
    async updateSupplierInTransaction(_connection, options) { calls.push(["update", options.findDuplicates]); return {}; }
  };
  const apply = createSupplierImportApplier({ suppliers, addresses: {}, contacts: {}, identifiers: {} });
  const connection = { async query() { return [[{ id: 9, supplier_name: "Old", display_name: "", default_currency_code: "HKD",
    default_payment_term_id: null, website: "", general_phone: "", general_email: "", notes: "" }]]; } };
  const job = { id: 3, activation_mode: "draft", approval_setting_value: 0, approver_user_id: null };
  const actor = { id: 1, username: "u" };
  await apply(connection, { job, actor, row: { operation: "create", normalized_payload: { root: { supplierCode: "S-1", supplierName: "New" } } } });
  await apply(connection, { job, actor, row: { operation: "update", match_supplier_id: 9, expected_supplier_version: 2,
    normalized_payload: { root: { notes: "x" } } } });
  assert.deepEqual(calls, [["create", false], ["update", false]]);
});
