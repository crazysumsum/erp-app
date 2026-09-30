import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

import { precheckSupplierCsv } from "../src/modules/supplier/import/SupplierImportProcessor.js";
import {
  buildSupplierImportTemplate, isBankColumn, SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_BANK_NOTICE,
  SUPPLIER_IMPORT_COLUMN_NAMES, SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER, SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER
} from "../src/modules/supplier/import/supplierCsvSchema.js";

/**
 * TASK-043：CSV template v1 同檔案層面嘅規則（RFC 4180、UTF-8、header、Bank 欄位、上限）。
 * 逐列嘅業務規則喺 supplierImportPrecheck.test.js。
 */
const catalog = { currencies: new Map([["HKD", { code: "HKD" }]]), paymentTerms: new Map() };
const noDb = { async query(sql) { if (/^\s*SELECT/iu.test(sql)) return [[]]; throw new Error(`unexpected write ${sql}`); } };

async function run(source, { maxRows = 100, maxBytes = 1_000_000 } = {}) {
  const rows = [];
  const result = await precheckSupplierCsv({
    source: Buffer.isBuffer(source) ? source : Buffer.from(source), mode: "create_only", connection: noDb, catalog,
    maxRows, maxBytes, onRows: async (batch) => rows.push(...batch)
  });
  return { ...result, rows };
}

const valid = (overrides = {}) => ({ supplierCode: "SUP-1", supplierName: "Acme", defaultCurrencyCode: "HKD", ...overrides });
const line = (record, header = SUPPLIER_IMPORT_COLUMN_NAMES) => header.map((name) => record[name] ?? "");
const csv = (records, { header = SUPPLIER_IMPORT_COLUMN_NAMES } = {}) =>
  stringify([header, ...records.map((record) => line(record, header))], SUPPLIER_CSV_STRINGIFY_OPTIONS);

test("the template is UTF-8 with a BOM, CRLF, the v1 columns, a description row that says Bank is not accepted, and an example", () => {
  const template = buildSupplierImportTemplate();
  assert.equal(template.charCodeAt(0), 0xfeff);
  assert.match(template, /\r\n$/u);
  const [header, descriptions, example, ...rest] = parse(template, { bom: true });
  assert.deepEqual(rest, []);
  assert.deepEqual(header, SUPPLIER_IMPORT_COLUMN_NAMES);
  assert.equal(descriptions.length, header.length);
  assert.ok(descriptions[0].startsWith(SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER));
  assert.ok(descriptions[0].includes(SUPPLIER_IMPORT_BANK_NOTICE));
  assert.equal(example[0], SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER);
  // 設計 §6.9：root、一組 Address、一組 Contact、一組 Identifier；冇 Bank。
  for (const name of ["supplierId", "supplierCode", "supplierName", "defaultCurrencyCode", "paymentTermCode", "addressLabel",
    "addressPurpose", "countryCode", "contactName", "contactPurpose", "identifierType", "issuerCountryCode", "identifierValue"]) {
    assert.ok(header.includes(name), name);
  }
  assert.deepEqual(header.filter(isBankColumn), [], "no template column is a Bank column");
});

test("the downloaded template uploads as an empty file, and with one data row added yields exactly that row", async () => {
  assert.deepEqual((await run(buildSupplierImportTemplate())).jobLevelError.code, "SUPPLIER_IMPORT_CSV_EMPTY");
  const filled = `${buildSupplierImportTemplate()}${stringify([line(valid())], SUPPLIER_CSV_STRINGIFY_OPTIONS)}`;
  const { rows, counts } = await run(filled);
  assert.deepEqual(counts, { total: 1, valid: 1, warning: 0, invalid: 0 });
  assert.equal(rows[0].rowNumber, 1);
});

test("cells holding a bare LF or CR are quoted, so readers that treat LF as a line end keep the row whole", () => {
  assert.equal(stringify([["a\nb", "c\rd", "plain"]], SUPPLIER_CSV_STRINGIFY_OPTIONS), "\uFEFF\"a\nb\",\"c\rd\",plain\r\n");
});

test("Bank-like headers are recognised however they are spelled", () => {
  for (const header of ["accountNumber", "Account No.", "account_number", "IBAN", "swift_code", "BIC", "bankName",
    "beneficiaryName", "routingNumber", "accountNumberCiphertext", "blindIndex", "lookupKeyId", "encryption_key"]) {
    assert.equal(isBankColumn(header), true, header);
  }
  for (const header of ["supplierName", "notes", "contactPhone", "postalCode"]) assert.equal(isBankColumn(header), false, header);
});

test("RFC 4180: quoted commas, doubled quotes, CRLF or LF, with or without BOM, Chinese text and leading zeros", async () => {
  const record = valid({ supplierName: "大華, \"Acme\" 有限公司", postalCode: "00123", addressLabel: "總部", addressPurpose: "office",
    identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: "0012345" });
  for (const [label, text] of [
    ["BOM + CRLF", csv([record])],
    ["no BOM + LF", csv([record]).replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n")]
  ]) {
    const { rows } = await run(text);
    assert.equal(rows.length, 1, label);
    assert.equal(rows[0].status, "valid", label);
    assert.equal(rows[0].normalizedPayload.root.supplierName, "大華, \"Acme\" 有限公司", label);
    assert.equal(rows[0].normalizedPayload.address.postalCode, "00123", `${label}: leading zeros kept`);
    assert.equal(rows[0].normalizedPayload.identifier.value, "0012345", label);
  }
});

test("a quoted newline stays inside its cell: only that field is invalid, the columns after it are not shifted", async () => {
  const { rows } = await run(csv([valid({ notes: "line one\nline two", website: "https://example.com" })]));
  assert.deepEqual(rows[0].errors.map(({ field, code }) => [field, code]), [["notes", "SUPPLIER_IMPORT_FIELD_INVALID"]]);
  assert.equal(rows[0].normalizedPayload.root.website, "https://example.com");
});

test("a Bank column rejects the whole file: no row is produced and the value appears nowhere in the result", async () => {
  const header = [...SUPPLIER_IMPORT_COLUMN_NAMES, "Unknown", "accountNumber"];
  const text = csv([{ ...valid(), Unknown: "x", accountNumber: "123456789012" }], { header });
  const result = await run(text);
  assert.equal(result.jobLevelError.code, "SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN", "Bank wins over merely unknown");
  assert.match(result.jobLevelError.message, /第 32 欄/u);
  assert.deepEqual(result.rows, []);
  assert.equal(JSON.stringify(result).includes("123456789012"), false);
  assert.equal(JSON.stringify(result).includes("accountNumber"), false, "the header text is not echoed either");
});

test("spaces around a template column name are ignored, at upload and at precheck", async () => {
  const { uploadHeaderError } = await import("../src/modules/supplier/import/SupplierImportProcessor.js");
  const spaced = SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ` ${name} `);
  const text = stringify([spaced, line(valid())], SUPPLIER_CSV_STRINGIFY_OPTIONS);
  assert.equal(uploadHeaderError(Buffer.from(text)), null);
  const { rows, jobLevelError } = await run(text);
  assert.equal(jobLevelError, undefined);
  assert.equal(rows[0].status, "valid");
});

test("header problems reject the whole file", async () => {
  const cases = [
    ["SUPPLIER_IMPORT_HEADER_UNKNOWN", [...SUPPLIER_IMPORT_COLUMN_NAMES, "rating"]],
    ["SUPPLIER_IMPORT_HEADER_MISSING", SUPPLIER_IMPORT_COLUMN_NAMES.filter((name) => name !== "notes")],
    ["SUPPLIER_IMPORT_HEADER_DUPLICATE", [...SUPPLIER_IMPORT_COLUMN_NAMES, "notes"]]
  ];
  for (const [code, header] of cases) {
    const result = await run(csv([valid()], { header }));
    assert.equal(result.jobLevelError?.code, code);
    assert.deepEqual(result.rows, [], code);
  }
});

test("malformed, non-UTF-8, empty, oversized and over-long files are rejected with their own code", async () => {
  const header = SUPPLIER_IMPORT_COLUMN_NAMES.join(",");
  const cases = [
    ["SUPPLIER_IMPORT_CSV_MALFORMED", `${header}\r\n"unterminated,${",".repeat(SUPPLIER_IMPORT_COLUMN_NAMES.length - 1)}\r\n`],
    ["SUPPLIER_IMPORT_CSV_MALFORMED", `${header}\r\nSUP-1,Acme\r\n`],
    ["SUPPLIER_IMPORT_CSV_NOT_UTF8", Buffer.concat([Buffer.from(`${header}\r\n`), Buffer.from([0xff, 0xfe, 0x41])])],
    ["SUPPLIER_IMPORT_CSV_EMPTY", ""],
    ["SUPPLIER_IMPORT_CSV_EMPTY", `\uFEFF${header}\r\n`],
    ["SUPPLIER_IMPORT_CSV_EMPTY", `${header}\r\n${",".repeat(SUPPLIER_IMPORT_COLUMN_NAMES.length - 1)}\r\n`]
  ];
  for (const [code, text] of cases) assert.equal((await run(text)).jobLevelError?.code, code, JSON.stringify(text).slice(0, 60));

  const three = csv([valid({ supplierCode: "A" }), valid({ supplierCode: "B" }), valid({ supplierCode: "C" })]);
  assert.equal((await run(three, { maxRows: 3 })).counts.total, 3, "exactly at the row limit");
  assert.equal((await run(three, { maxRows: 2 })).jobLevelError.code, "SUPPLIER_IMPORT_TOO_MANY_ROWS");
  const size = Buffer.byteLength(three);
  assert.equal((await run(three, { maxBytes: size })).counts.total, 3, "exactly at the byte limit");
  assert.equal((await run(three, { maxBytes: size - 1 })).jobLevelError.code, "SUPPLIER_IMPORT_FILE_TOO_LARGE");
});

test("a stray quote in a header or a cell fails the file as malformed and the cell text goes nowhere (REV-064 H-1)", async () => {
  const header = SUPPLIER_IMPORT_COLUMN_NAMES.join(",");
  const row = (notes) => SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({ ...valid(), notes })[name] ?? "").join(",");
  for (const [label, text] of [
    ["quote inside an unquoted cell", `${header}\r\n${row('iban GB29NWBK60161331926819 "x"')}\r\n`],
    ["space before an opening quote", `${header}\r\n${row(' "GB29NWBK60161331926819"')}\r\n`],
    ["quote inside a header", `acct"GB29NWBK60161331926819",${header}\r\n`]
  ]) {
    const result = await run(text);
    assert.equal(result.jobLevelError?.code, "SUPPLIER_IMPORT_CSV_MALFORMED", label);
    assert.equal(JSON.stringify(result).includes("GB29"), false, label);
  }
});

test("an abort between batches stops the precheck before the next batch", async () => {
  const controller = new AbortController();
  const written = [];
  await assert.rejects(() => precheckSupplierCsv({
    source: Buffer.from(csv([valid({ supplierCode: "A" }), valid({ supplierCode: "B" }), valid({ supplierCode: "C" })])),
    mode: "create_only", connection: noDb, catalog, maxRows: 10, maxBytes: 1_000_000, batchSize: 1,
    signal: controller.signal, onRows: async (rows) => { written.push(rows); controller.abort(); }
  }), { name: "AbortError" });
  assert.equal(written.length, 1);
});

test("per-row issues are bounded and never echo the cell value", async () => {
  const long = "Z".repeat(1000);   // 30 欄 × 1000 仍然喺 64 KiB 一列嘅上限之內
  const { rows } = await run(csv([Object.fromEntries(SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => [name, long]))]));
  assert.ok(rows[0].errors.length <= 20, `${rows[0].errors.length} issues`);
  assert.equal(JSON.stringify(rows[0].errors).includes("ZZZZ"), false);
});
