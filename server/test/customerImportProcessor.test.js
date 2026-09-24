import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { parseAndPrecheckCustomerCsv } from "../src/modules/customer/import/CustomerImportProcessor.js";
import { buildCustomerImportTemplate, CUSTOMER_IMPORT_COLUMN_NAMES } from "../src/modules/customer/import/customerCsvSchema.js";

function csvRow(row, headers = CUSTOMER_IMPORT_COLUMN_NAMES) {
  const cell = (value) => /[",\r\n]/u.test(String(value ?? "")) ? `"${String(value ?? "").replaceAll('"', '""')}"` : String(value ?? "");
  return headers.map((name) => cell(row[name])).join(",");
}

function csv(rows, headers = CUSTOMER_IMPORT_COLUMN_NAMES) {
  return Buffer.from(`\uFEFF${headers.join(",")}\r\n${rows.map((row) => csvRow(row, headers)).join("\r\n")}\r\n`, "utf8");
}

function database(rows = {}) {
  return {
    writes: 0,
    async execute() { this.writes += 1; throw new Error("precheck must not write"); },
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM customers")) return [rows.customers ?? []];
      if (text.includes("FROM currencies")) return [rows.currencies ?? []];
      if (text.includes("FROM payment_terms")) return [rows.paymentTerms ?? []];
      if (text.includes("FROM users")) return [rows.users ?? []];
      if (text.includes("FROM customer_categories")) return [rows.categories ?? []];
      if (text.includes("FROM customer_industries")) return [rows.industries ?? []];
      if (text.includes("FROM customer_territories")) return [rows.territories ?? []];
      if (text.includes("FROM customer_identifiers")) return [rows.identifiers ?? []];
      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

const validCreate = {
  customerCode: "C-001", legalName: "Acme Hong Kong Limited", defaultCurrencyCode: "HKD",
  notes: "Approved, \"priority\" account",
  paymentTermCode: "NET30", addressLabel: "Office", addressLine1: "1 Road",
  addressCountryCode: "HK", addressPurposes: "billing*|shipping*",
  contactName: "Alex", contactEmail: "alex@example.com", contactPurposes: "general*",
  identifierType: "business_registration", identifierIssuerCountryCode: "HK", identifierValue: "1234-5678",
  creditLimit: "100.0000", creditCurrencyCode: "HKD", creditStatus: "normal"
};

const lookupRows = {
  currencies: [{ code: "HKD", status: "ACTIVE" }],
  paymentTerms: [{ id: 8, code_key: "NET30", status: "ACTIVE" }]
};

test("Customer CSV precheck streams RFC4180/BOM input and never writes Customer data", async () => {
  const db = database(lookupRows);
  const content = csv([validCreate]);
  const result = await parseAndPrecheckCustomerCsv({
    source: Readable.from([content.subarray(0, 37), content.subarray(37, 113), content.subarray(113)]),
    mode: "upsert", connection: db, maxRows: 10_000, maxBytes: 20 * 1024 * 1024
  });
  assert.equal(result.jobLevelError, undefined);
  assert.deepEqual(result.counts, { total: 1, valid: 1, warning: 0, invalid: 0 });
  assert.equal(result.rows[0].operation, "create");
  assert.equal(result.rows[0].normalizedPayload.root.legalName, validCreate.legalName);
  assert.equal(result.rows[0].normalizedPayload.root.defaultPaymentTermId, 8);
  assert.equal(result.rows[0].normalizedPayload.address.purposes.length, 2);
  assert.equal(db.writes, 0);
});

test("Customer CSV precheck emits bounded normalized batches without retaining all rows", async () => {
  const rows = Array.from({ length: 23 }, (_, index) => ({
    ...validCreate, customerCode: `C-${String(index + 1).padStart(3, "0")}`,
    legalName: `Customer ${index + 1}`, identifierValue: String(1000 + index)
  }));
  const batches = [];
  const result = await parseAndPrecheckCustomerCsv({
    source: csv(rows), mode: "upsert", connection: database(lookupRows), batchSize: 5,
    async onRows(batch) { batches.push(batch.length); }
  });
  assert.deepEqual(batches, [5, 5, 5, 5, 3]);
  assert.equal(result.rows, undefined);
  assert.deepEqual(result.counts, { total: 23, valid: 23, warning: 0, invalid: 0 });
});

test("Customer CSV precheck skips the template description and example rows", async () => {
  const source = Buffer.from(`${buildCustomerImportTemplate()}${csvRow(validCreate)}\r\n`);
  const result = await parseAndPrecheckCustomerCsv({ source, mode: "upsert", connection: database(lookupRows) });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].normalizedPayload.root.customerCode, validCreate.customerCode);
});

test("Customer CSV precheck rejects invalid UTF-8, duplicate, unknown and oversized input deterministically", async () => {
  const db = database();
  const invalidUtf8 = Buffer.concat([Buffer.from("customerId,customerCode\r\n", "utf8"), Buffer.from([0xc3, 0x28])]);
  assert.equal((await parseAndPrecheckCustomerCsv({ source: invalidUtf8, mode: "upsert", connection: db })).jobLevelError.code, "CSV_UTF8_INVALID");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: Buffer.alloc(0), mode: "upsert", connection: db })).jobLevelError.code, "CSV_EMPTY");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: csv([]), mode: "upsert", connection: db })).jobLevelError.code, "CSV_EMPTY");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: csv([], ["customerId", "customerId"]), mode: "upsert", connection: db })).jobLevelError.code, "CSV_HEADER_DUPLICATE");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: csv([], [...CUSTOMER_IMPORT_COLUMN_NAMES, "mystery"]), mode: "upsert", connection: db })).jobLevelError.code, "CSV_HEADER_UNKNOWN");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: csv([], CUSTOMER_IMPORT_COLUMN_NAMES.slice(1)), mode: "upsert", connection: db })).jobLevelError.code, "CSV_HEADER_MISSING");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: Buffer.from('"unterminated'), mode: "upsert", connection: db })).jobLevelError.code, "CSV_MALFORMED");
  assert.equal((await parseAndPrecheckCustomerCsv({ source: csv([validCreate]), mode: "upsert", connection: db, maxBytes: 10 })).jobLevelError.code, "CSV_FILE_TOO_LARGE");
});

test("Customer CSV precheck validates its public boundary and propagates row consumers", async () => {
  await assert.rejects(() => parseAndPrecheckCustomerCsv(), /database connection and valid mode/u);
  await assert.rejects(() => parseAndPrecheckCustomerCsv({ source: Buffer.alloc(0), mode: "invalid", connection: database() }), /database connection and valid mode/u);
  for (const limits of [
    { maxRows: 0 }, { maxBytes: 0 }, { batchSize: 0 }, { maxRows: 1.5 },
    { maxBytes: 1.5 }, { batchSize: 1.5 }, { onRows: true }
  ]) {
    await assert.rejects(
      () => parseAndPrecheckCustomerCsv({ source: csv([validCreate]), mode: "upsert", connection: database(), ...limits }),
      /limits are invalid/u
    );
  }
  await assert.rejects(
    () => parseAndPrecheckCustomerCsv({
      source: csv([validCreate]), mode: "upsert", connection: database(lookupRows), batchSize: 1,
      async onRows() { throw new Error("consumer stopped"); }
    }),
    /consumer stopped/u
  );
});

test("Customer CSV reserved sensitive headers invalidate rows without retaining values", async () => {
  const db = database(lookupRows);
  const secret = "HK00-RAW-ACCOUNT-SECRET";
  const headers = [...CUSTOMER_IMPORT_COLUMN_NAMES, "beneficiaryBankAccountNumber"];
  const result = await parseAndPrecheckCustomerCsv({
    source: csv([{ ...validCreate, beneficiaryBankAccountNumber: secret }], headers),
    mode: "upsert", connection: db
  });
  assert.equal(result.rows[0].status, "invalid");
  assert.ok(result.rows[0].errors.some(({ code }) => code === "IMPORT_SENSITIVE_FIELD_FORBIDDEN"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"));
});

test("Customer CSV precheck enforces row limits and update child restrictions", async () => {
  const tooMany = await parseAndPrecheckCustomerCsv({ source: csv([validCreate, { ...validCreate, customerCode: "C-002" }]), mode: "upsert", connection: database(lookupRows), maxRows: 1 });
  assert.equal(tooMany.jobLevelError.code, "CSV_TOO_MANY_ROWS");

  const db = database({
    ...lookupRows,
    customers: [{ id: 7, customer_code: "C-001", customer_code_key: "c-001", legal_name_key: "old name", version: 3 }]
  });
  const update = await parseAndPrecheckCustomerCsv({ source: csv([{ ...validCreate, customerId: "7", legalName: "New Name" }]), mode: "upsert", connection: db });
  assert.equal(update.rows[0].operation, "update");
  assert.equal(update.rows[0].expectedCustomerVersion, 3);
  assert.ok(update.rows[0].errors.some(({ code }) => code === "IMPORT_CHILD_UPDATE_UNSUPPORTED"));
});

test("Customer CSV precheck reports duplicate warnings, identifier conflicts and inactive references", async () => {
  const db = database({
    currencies: [{ code: "HKD", status: "INACTIVE" }],
    paymentTerms: [{ id: 8, code_key: "NET30", status: "INACTIVE" }],
    customers: [{ id: 7, customer_code: "OLD", customer_code_key: "old", legal_name_key: "acme limited", trading_name_key: "acme", version: 2 }],
    identifiers: [{ customer_id: 7, identifier_type: "business_registration", issuer_country_code: "HK", identifier_value_key: "12345678" }]
  });
  const row = {
    ...validCreate, customerCode: "NEW", legalName: "Acme Limited", tradingName: "Acme",
    defaultCurrencyCode: "HKD", website: "javascript:alert(1)", generalEmail: "invalid",
    accountManagerUsername: "missing", categoryCode: "missing", industryCode: "missing", territoryCode: "missing"
  };
  const result = await parseAndPrecheckCustomerCsv({ source: csv([row, row]), mode: "upsert", connection: db });
  const codes = result.rows.flatMap(({ errors, warnings }) => [...errors, ...warnings].map(({ code }) => code));
  for (const expected of [
    "IMPORT_LEGAL_NAME_TAKEN", "IMPORT_TRADING_NAME_DUPLICATE", "IMPORT_IDENTIFIER_TAKEN",
    "IMPORT_CURRENCY_NOT_ACTIVE", "IMPORT_PAYMENT_TERM_NOT_ACTIVE", "IMPORT_ACCOUNT_MANAGER_NOT_ACTIVE",
    "IMPORT_CATEGORY_NOT_ACTIVE", "IMPORT_INDUSTRY_NOT_ACTIVE", "IMPORT_TERRITORY_NOT_ACTIVE",
    "IMPORT_WEBSITE_INVALID", "IMPORT_EMAIL_INVALID", "IMPORT_CUSTOMER_CODE_DUPLICATED_IN_FILE",
    "IMPORT_IDENTIFIER_DUPLICATED_IN_FILE"
  ]) assert.ok(codes.includes(expected), expected);
  assert.equal(result.counts.invalid, 2);
});

test("Customer CSV precheck reports malformed row fields and conflicting update targets", async () => {
  const db = database({
    ...lookupRows,
    customers: [
      { id: 7, customer_code: "C-001", customer_code_key: "c-001", legal_name_key: "old name", trading_name_key: null, version: 3 },
      { id: 8, customer_code: "C-002", customer_code_key: "c-002", legal_name_key: "other name", trading_name_key: null, version: 1 }
    ]
  });
  const malformed = {
    customerId: "-1", customerCode: "bad\u0007code", legalName: "", tradingName: "bad\u0007name",
    defaultCurrencyCode: "TOOLONG", website: "ftp://example.com", generalEmail: "invalid",
    addressLabel: "", addressLine1: "", addressCountryCode: "HKG", addressPurposes: "billing|billing",
    contactName: "", contactEmail: "invalid", contactPreferredLanguage: "not_a_language", contactPurposes: "",
    identifierType: "unknown", identifierIssuerCountryCode: "HKG", identifierValue: "bad\u0007value",
    identifierValidFrom: "later", identifierExpiresAt: "-1", identifierNotes: "x".repeat(501),
    creditLimit: "1.00", creditCurrencyCode: "ZZ", creditStatus: "blocked"
  };
  const result = await parseAndPrecheckCustomerCsv({
    source: csv([
      malformed,
      { customerId: "7", customerCode: "C-002", legalName: "Other Name" },
      { customerId: "7", customerCode: "C-001" }
    ]),
    mode: "create_only", connection: db
  });
  const codes = result.rows.flatMap(({ errors }) => errors.map(({ code }) => code));
  for (const expected of [
    "IMPORT_POSITIVE_INTEGER_REQUIRED", "IMPORT_CUSTOMER_CODE_INVALID", "IMPORT_LEGAL_NAME_INVALID",
    "IMPORT_TRADING_NAME_INVALID", "IMPORT_FIELD_INVALID", "IMPORT_WEBSITE_INVALID", "IMPORT_EMAIL_INVALID",
    "IMPORT_REQUIRED_FIELD", "IMPORT_COUNTRY_INVALID", "IMPORT_PURPOSE_INVALID", "IMPORT_LANGUAGE_INVALID",
    "IMPORT_IDENTIFIER_TYPE_INVALID", "IMPORT_EPOCH_INVALID",
    "IMPORT_CREDIT_LIMIT_INVALID", "IMPORT_CURRENCY_NOT_ACTIVE", "IMPORT_CREDIT_STATUS_INVALID",
    "IMPORT_CUSTOMER_MATCH_CONFLICT", "IMPORT_MODE_MISMATCH", "IMPORT_CUSTOMER_DUPLICATED_IN_FILE"
  ]) assert.ok(codes.includes(expected), expected);
  assert.equal(result.counts.invalid, 3);
});

test("Customer CSV precheck classifies lookup, warning and partial-credit edge cases", async () => {
  const existing = {
    id: 7, customer_code: "C-001", customer_code_key: "c-001", legal_name_key: "old name",
    trading_name_key: "existing trade", version: 3
  };
  const db = database({ ...lookupRows, customers: [existing] });
  const result = await parseAndPrecheckCustomerCsv({
    source: csv([
      { ...validCreate, customerCode: "C-NEW", legalName: "New Name", tradingName: "Existing Trade", identifierType: "", identifierIssuerCountryCode: "", identifierValue: "", creditLimit: "", creditCurrencyCode: "", creditStatus: "" },
      { customerId: "999", customerCode: "", legalName: "Missing Customer" },
      { customerCode: "C-CONTROL", legalName: "bad\u0007name", identifierType: "tax", identifierIssuerCountryCode: "HK", identifierValue: "bad\u0007value", identifierValidFrom: "10", identifierExpiresAt: "5" },
      { customerId: "7", customerCode: "C-001", creditCurrencyCode: "HKD" },
      {},
      { customerCode: "C-CREDIT", legalName: "Credit Only", defaultCurrencyCode: "HKD", creditStatus: "normal" },
      { customerId: "7", customerCode: "C-001", creditLimit: "1.0000" },
      { customerCode: "C-ADDRESS", legalName: "Address Without Country", defaultCurrencyCode: "HKD", addressLabel: "Office", addressLine1: "1 Road", addressPurposes: "office", tradingName: "Unique Trade" }
    ]),
    mode: "upsert", connection: db
  });
  assert.equal(result.rows[0].status, "warning");
  assert.ok(result.rows[1].errors.some(({ code }) => code === "IMPORT_CUSTOMER_NOT_FOUND"));
  assert.ok(result.rows[2].errors.some(({ code }) => code === "IMPORT_IDENTIFIER_DATES_INVALID"));
  assert.deepEqual(result.rows[3].normalizedPayload.credit, { creditCurrencyCode: "HKD" });
  assert.deepEqual(result.rows[5].normalizedPayload.credit, { creditLimit: null, creditCurrencyCode: null, creditStatus: "normal" });
  assert.deepEqual(result.rows[6].normalizedPayload.credit, { creditLimit: "1.0000" });

  assert.equal((await parseAndPrecheckCustomerCsv({ source: {}, mode: "upsert", connection: db })).jobLevelError.code, "CSV_MALFORMED");
  const stringSource = [csv([validCreate]).toString("utf8")];
  assert.equal((await parseAndPrecheckCustomerCsv({ source: stringSource, mode: "upsert", connection: database(lookupRows) })).counts.valid, 1);
});
