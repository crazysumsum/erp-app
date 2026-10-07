import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "csv-stringify/sync";

import { precheckSupplierCsv } from "../src/modules/supplier/import/SupplierImportProcessor.js";
import {
  guardSpreadsheetCell, SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES, unguardSpreadsheetCell
} from "../src/modules/supplier/import/supplierCsvSchema.js";

/**
 * TASK-043：逐列預檢嘅業務規則（設計 §6.9、§8.8；FR-IMPORT-003、FR-IMPORT-006、BR-026）。
 * 資料庫替身只答 SELECT：預檢對資料庫只讀，任何寫入都會令測試炸（IMP-004）。
 */
const catalog = {
  currencies: new Map([["HKD", { code: "HKD" }], ["USD", { code: "USD" }]]),
  paymentTerms: new Map([["NET 30", { id: 3, code: "NET 30" }]])
};

function database({ suppliers = [], identifiers = [], names = [], identifierKeys = null } = {}) {
  const statements = [];
  return {
    statements,
    async query(sql, params) {
      statements.push(sql);
      if (!/^\s*SELECT/iu.test(sql)) throw new Error(`precheck must not write: ${sql}`);
      if (/FROM suppliers WHERE supplier_name_key IN/u.test(sql)) return [names.filter((row) => params[0].includes(row.supplier_name_key))];
      if (/FROM suppliers/u.test(sql)) return [suppliers];
      if (/FROM supplier_identifiers/u.test(sql)) {
        if (!identifierKeys) return [identifiers];
        // 好似 MySQL 咁照 (type, country, key) 配對：只回傳被問到嘅組合。
        const asked = new Set(params[0].map((tuple) => tuple.join("\u0000")));
        return [identifierKeys.filter((tuple) => asked.has(tuple.join("\u0000")))
          .map(([type, country, key]) => ({ identifier_type: type, issuer_country_code: country, identifier_value_key: key }))];
      }
      throw new Error(`unexpected query ${sql} ${JSON.stringify(params)}`);
    }
  };
}

async function precheck(records, { mode = "create_only", connection = database(), batchSize } = {}) {
  const batches = [];
  const text = stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...records.map((record) => SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => record[name] ?? ""))],
    SUPPLIER_CSV_STRINGIFY_OPTIONS);
  const result = await precheckSupplierCsv({
    source: Buffer.from(text), mode, connection, catalog, maxRows: 1000, maxBytes: 1_000_000,
    ...(batchSize ? { batchSize } : {}), onRows: async (rows) => batches.push(rows)
  });
  return { ...result, batches, rows: batches.flat() };
}

const create = (overrides = {}) => ({ supplierCode: "SUP-1", supplierName: "Acme Trading", defaultCurrencyCode: "HKD", ...overrides });
const codes = (row) => row.errors.map(({ field, code }) => [field, code]);
const existing = { id: 7, supplier_code_key: "sup-7", status: "active", version: 4 };

test("a minimal create row is valid; blanks become empty values and the payload holds only whitelisted fields", async () => {
  const { rows, counts } = await precheck([create()]);
  assert.deepEqual(counts, { total: 1, valid: 1, warning: 0, invalid: 0 });
  assert.deepEqual(rows[0], {
    rowNumber: 1, operation: "create", matchSupplierId: null, expectedSupplierVersion: null, status: "valid", errors: [], warnings: [],
    normalizedPayload: { root: {
      supplierCode: "SUP-1", supplierName: "Acme Trading", defaultCurrencyCode: "HKD", defaultPaymentTermId: null,
      displayName: "", website: "", generalPhone: "", generalEmail: "", notes: ""
    } }
  });
});

test("the apostrophe the export adds before a formula character is taken off again; other apostrophes stay (HD-068 A)", async () => {
  const { rows } = await precheck([create({
    supplierName: guardSpreadsheetCell("=Beta Formula Ltd"), displayName: guardSpreadsheetCell("＠Beta"),
    generalPhone: guardSpreadsheetCell("+852 2123 4567"), notes: "'quoted on purpose", website: ""
  })]);
  assert.equal(rows[0].status, "valid", JSON.stringify(rows[0].errors));
  const { supplierName, displayName, generalPhone, notes } = rows[0].normalizedPayload.root;
  assert.deepEqual([supplierName, displayName, generalPhone, notes], ["=Beta Formula Ltd", "＠Beta", "+852 2123 4567", "'quoted on purpose"]);
});

test("unguard is exactly the inverse of guard", () => {
  for (const value of ["=1", "+852", "-2", "@x", "\tx", "\rx", "\nx", "＝1", "＋1", "－1", "＠x", "plain", "", "'x", "''=x", "a'=b",
    // 本身已經係 `'` 加公式字元開頭（REV-075 L-1）。
    "'=x", "''=x", "'''+1", "'+852 desk", "'-", "'@x", "'\tx", "'＝x", "'＠x"]) {
    assert.equal(unguardSpreadsheetCell(guardSpreadsheetCell(value)), value, JSON.stringify(value));
  }
  for (const untouched of ["'x", "'", "''", "' +852", "a'=b"]) assert.equal(unguardSpreadsheetCell(untouched), untouched);
});

test("create requires Supplier Code, name and currency, and uses the API's rules for everything else", async () => {
  const { rows } = await precheck([
    { notes: "only notes" },   // 全空白嘅列會被略過，所以要有一格有值
    create({ supplierCode: "SUP-2", defaultCurrencyCode: "EUR", paymentTermCode: "NET 60", website: "ftp://x", generalEmail: "nope" }),
    create({ supplierCode: "SUP-3", supplierName: "Third", defaultCurrencyCode: "usd", paymentTermCode: " net   30 " })
  ]);
  assert.deepEqual(codes(rows[0]), [
    ["supplierCode", "SUPPLIER_IMPORT_REQUIRED_FIELD"], ["supplierName", "SUPPLIER_IMPORT_REQUIRED_FIELD"],
    ["defaultCurrencyCode", "SUPPLIER_IMPORT_REQUIRED_FIELD"]
  ]);
  assert.deepEqual(codes(rows[1]), [
    ["defaultCurrencyCode", "CURRENCY_NOT_ACTIVE"], ["paymentTermCode", "PAYMENT_TERM_NOT_ACTIVE"],
    ["website", "WEBSITE_INVALID"], ["generalEmail", "EMAIL_INVALID"]
  ]);
  assert.equal(rows[2].status, "valid", "currency and payment term codes are matched the way Business Master normalises them");
  assert.equal(rows[2].normalizedPayload.root.defaultCurrencyCode, "USD");
  assert.equal(rows[2].normalizedPayload.root.defaultPaymentTermId, 3);
});

test("create rows may carry one primary Address, Contact and Identifier, validated like the UI", async () => {
  const full = create({
    addressLabel: "HQ", addressPurpose: "ordering", addressLine1: "1 Road", countryCode: "hk",
    contactName: "Alex", contactPurpose: "orders", contactEmail: "alex@example.com", contactPhone: "+852 1234 5678",
    identifierType: "business_registration", issuerCountryCode: "hk", identifierValue: "12-345 678"
  });
  const { rows } = await precheck([
    full,
    create({ supplierCode: "SUP-2", addressLine1: "1 Road", contactEmail: "a@b.co" }),
    create({ supplierCode: "SUP-3", addressLabel: "HQ", addressPurpose: "warehouse", contactName: "B", contactPurpose: "orders",
      contactPhone: "call me", countryCode: "HKG" }),
    create({ supplierCode: "SUP-4", identifierValue: "123" })
  ]);
  assert.equal(rows[0].status, "valid");
  assert.deepEqual(rows[0].normalizedPayload.address.purposes, [{ purposeCode: "ordering", isPrimary: true }]);
  assert.equal(rows[0].normalizedPayload.address.countryCode, "HK");
  assert.deepEqual(rows[0].normalizedPayload.contact.purposes, [{ purposeCode: "orders", isPrimary: true }]);
  assert.equal(rows[0].normalizedPayload.identifier.key, "12345678");
  assert.deepEqual(codes(rows[1]), [
    ["addressLabel", "SUPPLIER_IMPORT_REQUIRED_FIELD"], ["addressPurpose", "SUPPLIER_IMPORT_REQUIRED_FIELD"],
    ["contactName", "SUPPLIER_IMPORT_REQUIRED_FIELD"], ["contactPurpose", "SUPPLIER_IMPORT_REQUIRED_FIELD"]
  ]);
  assert.deepEqual(codes(rows[2]), [["countryCode", "SUPPLIER_IMPORT_FIELD_TOO_LONG"], ["contactPhone", "PHONE_INVALID"]],
    "an over-long cell is reported once, and the address group is not normalised on top of it");
  assert.deepEqual(codes(rows[3]), [["identifierType", "IDENTIFIER_INVALID"]], "the identifier needs all three columns");
  const purpose = (await precheck([create({ addressLabel: "HQ", addressPurpose: "warehouse" })])).rows[0];
  assert.deepEqual(codes(purpose), [["addressPurpose", "SUPPLIER_ADDRESS_PURPOSE_INVALID"]]);
});

test("upsert matches by supplierId first and cross-checks the code; code alone also matches (IMP-011)", async () => {
  const connection = database({ suppliers: [existing, { id: 8, supplier_code_key: "sup-8", status: "active", version: 1 }] });
  const { rows } = await precheck([
    { supplierId: "7", supplierCode: "SUP-7", supplierName: "Renamed" },
    { supplierId: "8", supplierCode: "SUP-9" },
    { supplierCode: "sup-8" },
    { supplierId: "404" },
    create({ supplierCode: "NEW-1" })
  ], { mode: "upsert", connection });
  assert.deepEqual([rows[0].operation, rows[0].matchSupplierId, rows[0].expectedSupplierVersion, rows[0].status], ["update", 7, 4, "valid"]);
  assert.deepEqual(rows[0].normalizedPayload, { root: { supplierName: "Renamed" }, identity: { supplierCode: "SUP-7" } },
    "blank optional cells mean no change; the CSV's Code is kept outside root, for the result file only (REV-073 I-3)");
  assert.deepEqual(codes(rows[1]), [["supplierCode", "SUPPLIER_IMPORT_MATCH_CONFLICT"]]);
  assert.deepEqual([rows[2].operation, rows[2].matchSupplierId], ["update", 8]);
  assert.deepEqual(codes(rows[3]), [["supplierId", "SUPPLIER_NOT_FOUND"]]);
  assert.equal(rows[3].operation, "update", "an unknown ID is a failed update, not a create");
  assert.deepEqual([rows[4].operation, rows[4].status], ["create", "valid"]);
});

test("update rows reject child columns and archived Suppliers, and never carry the Supplier Code", async () => {
  const connection = database({ suppliers: [existing, { id: 9, supplier_code_key: "old", status: "archived", version: 2 }] });
  const { rows } = await precheck([
    { supplierId: "7", contactName: "Alex" },
    { supplierId: "9" },
    { supplierCode: "SUP-7", notes: "kept" }
  ], { mode: "upsert", connection });
  assert.deepEqual(codes(rows[0]), [["children", "IMPORT_CHILD_UPDATE_UNSUPPORTED"]]);
  assert.deepEqual(codes(rows[1]), [["supplierId", "SUPPLIER_UPDATE_NOT_ALLOWED"]]);
  assert.deepEqual(rows[2].normalizedPayload.root, { notes: "kept" }, "root never carries the Code an update cannot change");
  assert.deepEqual(rows[2].normalizedPayload.identity, { supplierCode: "SUP-7" });
  assert.equal(Object.hasOwn(rows[0].normalizedPayload, "identity"), false, "a row matched by ID alone has no CSV Code to keep");
});

test("create_only never updates: an existing code is taken and a supplierId is refused", async () => {
  const { rows } = await precheck([create({ supplierCode: "SUP-7" }), create({ supplierCode: "SUP-X", supplierId: "7" })],
    { connection: database({ suppliers: [existing] }) });
  assert.deepEqual(codes(rows[0]), [["supplierCode", "SUPPLIER_CODE_TAKEN"]]);
  assert.deepEqual(codes(rows[1]), [["supplierId", "SUPPLIER_IMPORT_MODE_MISMATCH"]]);
  assert.deepEqual(rows.map((row) => row.operation), ["create", "create"]);
});

test("duplicates within the file and against the database are caught across batches", async () => {
  const identifier = { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1" };
  const connection = database({
    suppliers: [existing],
    identifiers: [{ identifier_type: "tax", issuer_country_code: "HK", identifier_value_key: "T2" }]
  });
  const { rows, batches } = await precheck([
    create({ supplierCode: "A", supplierName: "Same Name", ...identifier }),
    create({ supplierCode: "a", supplierName: "Other" }),
    create({ supplierCode: "B", supplierName: "Same  name", ...identifier }),
    create({ supplierCode: "C", supplierName: "Third", identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T 2" }),
    { supplierId: "7", supplierName: "X" },
    { supplierCode: "SUP-7", supplierName: "Y" }
  ], { mode: "upsert", connection, batchSize: 2 });
  assert.equal(batches.length, 3);
  assert.deepEqual(rows.map((row) => row.rowNumber), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(codes(rows[1]), [["supplierCode", "SUPPLIER_IMPORT_CODE_DUPLICATED_IN_FILE"]]);
  assert.match(rows[1].errors[0].message, /第 1 列/u);
  assert.deepEqual(codes(rows[2]), [["identifierValue", "SUPPLIER_IMPORT_IDENTIFIER_DUPLICATED_IN_FILE"]]);
  assert.deepEqual(rows[2].warnings.map(({ code }) => code), ["SUPPLIER_IMPORT_NAME_DUPLICATED_IN_FILE"]);
  assert.deepEqual(codes(rows[3]), [["identifierValue", "SUPPLIER_IDENTIFIER_TAKEN"]]);
  assert.deepEqual(codes(rows[5]), [["supplierId", "SUPPLIER_IMPORT_SUPPLIER_DUPLICATED_IN_FILE"]]);
  assert.ok(connection.statements.every((sql) => /^\s*SELECT/iu.test(sql)), "precheck only reads");
});

test("a name identical to an existing Supplier's is a warning, not an error, and an update does not match itself (HD-052 A)", async () => {
  const connection = database({
    suppliers: [existing],
    names: [{ id: 7, supplier_name_key: "acme trading" }, { id: 8, supplier_name_key: "acme  trading ltd" }]
  });
  const { rows, counts } = await precheck([
    create(),
    { supplierId: "7", supplierName: "ACME   Trading" },
    create({ supplierCode: "NEW-2", supplierName: "Acme Trading Limited" })
  ], { mode: "upsert", connection });
  assert.deepEqual([rows[0].status, rows[0].warnings.map(({ code }) => code)], ["warning", ["SUPPLIER_IMPORT_NAME_EXISTS"]],
    "same name after NFKC, case and space folding");
  assert.deepEqual(rows[1].warnings.map(({ code }) => code), ["SUPPLIER_IMPORT_NAME_DUPLICATED_IN_FILE"],
    "the Supplier being updated is not a duplicate of itself; row 1 in the file is");
  assert.deepEqual([rows[2].status, rows[2].warnings], ["valid", []], "a merely similar name is not flagged by CSV precheck");
  assert.deepEqual(counts, { total: 3, valid: 1, warning: 2, invalid: 0 });
  assert.equal(connection.statements.filter((sql) => /supplier_name_key IN/u.test(sql)).length, 1, "one name query for the whole batch");
});

test("identifiers with the same value but another type or country are looked up separately (REV-066 I-2)", async () => {
  const connection = database({ identifierKeys: [["tax", "HK", "SAME1"]] });
  const { rows } = await precheck([
    // 已被使用嗰個放第一列：如果查詢只用 value 做 key，後一列會蓋過佢，就查唔到。
    create({ supplierCode: "A", supplierName: "A Co", identifierType: "tax", issuerCountryCode: "HK", identifierValue: "SAME1" }),
    create({ supplierCode: "B", supplierName: "B Co", identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: "SAME1" })
  ], { connection });
  assert.deepEqual(rows.map((row) => row.status), ["invalid", "valid"]);
  assert.deepEqual(codes(rows[0]), [["identifierValue", "SUPPLIER_IDENTIFIER_TAKEN"]]);

  // 同類型、同號碼，唔同發證地（REV-067 I-2）。
  const byCountry = await precheck([
    create({ supplierCode: "C", supplierName: "C Co", identifierType: "tax", issuerCountryCode: "HK", identifierValue: "SAME1" }),
    create({ supplierCode: "D", supplierName: "D Co", identifierType: "tax", issuerCountryCode: "SG", identifierValue: "SAME1" })
  ], { connection: database({ identifierKeys: [["tax", "HK", "SAME1"]] }) });
  assert.deepEqual(byCountry.rows.map((row) => row.status), ["invalid", "valid"]);
});

test("a batch runs the same number of queries whether it holds one row or five hundred (REV-064 H-2, REV-065 L-1)", async () => {
  const rowsOf = (count) => Array.from({ length: count }, (_, index) => create({
    supplierCode: `Q-${index}`, supplierName: `Name ${index}`, identifierType: "tax", issuerCountryCode: "HK", identifierValue: `T${index}`
  }));
  const one = database();
  await precheck(rowsOf(1), { connection: one, batchSize: 500 });
  const many = database();
  await precheck(rowsOf(500), { connection: many, batchSize: 500 });
  assert.equal(many.statements.length, one.statements.length);
  assert.ok(one.statements.length <= 3, `${one.statements.length} queries per batch`);
});
