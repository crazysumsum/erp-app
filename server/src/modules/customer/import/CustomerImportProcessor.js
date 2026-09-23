import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";

import {
  normalizeCustomerCode, normalizeIdentifierValue, normalizeLegalName, normalizeTradingName
} from "../customerNormalization.js";
import {
  CUSTOMER_IMPORT_COLUMN_NAMES,
  CUSTOMER_IMPORT_TEMPLATE_DESCRIPTION_PREFIX,
  CUSTOMER_IMPORT_TEMPLATE_EXAMPLE_MARKER
} from "./customerCsvSchema.js";

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const KNOWN_HEADERS = new Set(CUSTOMER_IMPORT_COLUMN_NAMES);
const ADDRESS_PURPOSES = new Set(["registered", "office", "billing", "shipping", "returns", "other"]);
const CONTACT_PURPOSES = new Set(["general", "ordering", "shipping", "billing_ar", "returns", "other"]);
const IDENTIFIER_TYPES = new Set(["company_registration", "business_registration", "tax", "other"]);
const IDENTIFIER_SEPARATORS = Object.freeze({
  company_registration: [" ", "-"], business_registration: [" ", "-"], tax: [" ", "-"], other: []
});
const SENSITIVE_HEADER = /(?:bank|iban|swift|bic|routing|beneficiary|accountnumber|accountno|attachment|filecontent|filename|password|secret|credential|token|creditnotes|internalnotes)/u;
const CREDIT_PATTERN = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{4}$/u;
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;

const ADDRESS_FIELDS = Object.freeze({
  addressLabel: ["label", 100], addressRecipientCompanyDepartment: ["recipientCompanyDepartment", 190],
  addressLine1: ["addressLine1", 190], addressLine2: ["addressLine2", 190], addressLine3: ["addressLine3", 190],
  addressCity: ["city", 100], addressStateRegion: ["stateRegion", 100], addressPostalCode: ["postalCode", 100],
  addressCountryCode: ["countryCode", 2], addressPhone: ["phone", 50], addressNotes: ["notes", 500]
});
const CONTACT_FIELDS = Object.freeze({
  contactName: ["name", 190], contactJobTitle: ["jobTitle", 100], contactDepartment: ["department", 100],
  contactEmail: ["email", 254], contactPhone: ["phone", 50], contactMobile: ["mobile", 50],
  contactPreferredLanguage: ["preferredLanguage", 20], contactNotes: ["notes", 500]
});
const IDENTIFIER_FIELDS = Object.freeze([
  "identifierType", "identifierIssuerCountryCode", "identifierValue", "identifierValidFrom",
  "identifierExpiresAt", "identifierNotes"
]);

function issue(list, field, code, message) { list.push({ field, code, message }); }
function jobError(code, message) { return { jobLevelError: { code, message } }; }
function cleanHeader(value) { return String(value ?? "").replace(/^\uFEFF/u, ""); }
function key(value) { return String(value ?? "").normalize("NFKC").trim().toLowerCase(); }
function upperKey(value) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase(); }
function hasAny(record, fields) { return fields.some((field) => String(record[field] ?? "").trim() !== ""); }
function identifierKey(record) {
  const type = String(record.identifierType ?? "").trim();
  const country = String(record.identifierIssuerCountryCode ?? "").trim().toUpperCase();
  const value = String(record.identifierValue ?? "").trim();
  if (!IDENTIFIER_SEPARATORS[type] || !/^[A-Z]{2}$/u.test(country) || !value) return null;
  try { return `${type}\u0000${country}\u0000${normalizeIdentifierValue(value, { removableSeparators: IDENTIFIER_SEPARATORS[type] }).key}`; }
  catch { return null; }
}

async function* decodeUtf8(source, maxBytes) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const iterable = Buffer.isBuffer(source) || source instanceof Uint8Array ? [source] : source;
  if (!iterable || typeof iterable[Symbol.asyncIterator] !== "function" && typeof iterable[Symbol.iterator] !== "function") {
    throw new TypeError("Customer import source must be a Buffer or iterable stream");
  }
  let bytes = 0;
  try {
    for await (const chunk of iterable) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) throw Object.assign(new Error("Customer import source is too large"), { code: "CSV_FILE_TOO_LARGE" });
      yield decoder.decode(buffer, { stream: true });
    }
    yield decoder.decode();
  } catch (error) {
    if (error.code === "CSV_FILE_TOO_LARGE") throw error;
    throw Object.assign(new Error("Customer import source is not valid UTF-8"), { code: "CSV_UTF8_INVALID" });
  }
}

function isTemplateMetadata(values, headerIndex) {
  const marker = String(values[headerIndex.get("customerId")] ?? "");
  return marker.startsWith(CUSTOMER_IMPORT_TEMPLATE_DESCRIPTION_PREFIX) || marker === CUSTOMER_IMPORT_TEMPLATE_EXAMPLE_MARKER;
}

async function readCsv(source, { maxRows, maxBytes, batchSize, onBatch }) {
  const parser = parse({ bom: true, skip_empty_lines: true, relax_column_count: false, max_record_size: 65_536 });
  const completed = pipeline(Readable.from(decodeUtf8(source, maxBytes)), parser);
  let headers;
  let headerIndex;
  let headerError;
  let sensitive = false;
  let rowCount = 0;
  let batch = [];
  let callbackError;
  try {
    for await (const values of parser) {
      if (!headers) {
        headers = values.map(cleanHeader);
        const duplicate = headers.find((name, index) => headers.indexOf(name) !== index);
        if (duplicate !== undefined) headerError = jobError("CSV_HEADER_DUPLICATE", "CSV 欄位名稱不可重複");
        const unknown = headers.find((name) => !KNOWN_HEADERS.has(name) && !SENSITIVE_HEADER.test(key(name).replace(/[^a-z0-9]/gu, "")));
        if (!headerError && unknown !== undefined) headerError = jobError("CSV_HEADER_UNKNOWN", "CSV 含有不支援的欄位");
        const missing = CUSTOMER_IMPORT_COLUMN_NAMES.find((name) => !headers.includes(name));
        if (!headerError && missing !== undefined) headerError = jobError("CSV_HEADER_MISSING", `CSV 缺少必要欄位 ${missing}`);
        sensitive = headers.some((name) => !KNOWN_HEADERS.has(name));
        headerIndex = new Map(headers.map((name, index) => [name, index]));
        continue;
      }
      if (headerError || isTemplateMetadata(values, headerIndex)) continue;
      rowCount += 1;
      if (rowCount <= maxRows) {
        batch.push(Object.fromEntries(CUSTOMER_IMPORT_COLUMN_NAMES.map((name) => [name, String(values[headerIndex.get(name)] ?? "")])));
        if (batch.length === batchSize) {
          try { await onBatch(batch, sensitive); } catch (error) { callbackError = error; throw error; }
          batch = [];
        }
      }
    }
    await completed;
  } catch (error) {
    try { await completed; } catch { /* preserve the first safe classification */ }
    if (callbackError) throw callbackError;
    if (error.code === "CSV_FILE_TOO_LARGE") return jobError("CSV_FILE_TOO_LARGE", "CSV 檔案超過大小上限");
    if (error.code === "CSV_UTF8_INVALID") return jobError("CSV_UTF8_INVALID", "CSV 必須使用有效 UTF-8 編碼");
    return jobError("CSV_MALFORMED", "CSV 格式不符合 RFC 4180");
  }
  if (!headers) return jobError("CSV_EMPTY", "CSV 沒有 header 或資料列");
  if (headerError) return headerError;
  if (rowCount === 0) return jobError("CSV_EMPTY", "CSV 沒有資料列");
  if (rowCount > maxRows) return jobError("CSV_TOO_MANY_ROWS", `CSV 超過 ${maxRows} 列上限`);
  if (batch.length) await onBatch(batch, sensitive);
  return {};
}

function text(record, field, maxLength, errors, { required = false } = {}) {
  const value = String(record[field] ?? "").trim();
  if (!value) {
    if (required) issue(errors, field, "IMPORT_REQUIRED_FIELD", `${field} 不可空白`);
    return "";
  }
  if ([...value].length > maxLength || CONTROL_PATTERN.test(value)) {
    issue(errors, field, "IMPORT_FIELD_INVALID", `${field} 格式不正確`);
    return "";
  }
  return value;
}

function positiveInteger(record, field, errors, { required = false } = {}) {
  const raw = String(record[field] ?? "").trim();
  if (!raw) {
    if (required) issue(errors, field, "IMPORT_REQUIRED_FIELD", `${field} 不可空白`);
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    issue(errors, field, "IMPORT_POSITIVE_INTEGER_REQUIRED", `${field} 必須是正整數`);
    return null;
  }
  return value;
}

function epoch(record, field, errors) {
  const raw = String(record[field] ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    issue(errors, field, "IMPORT_EPOCH_INVALID", `${field} 必須是非負 epoch 毫秒`);
    return null;
  }
  return value;
}

function parsePurposes(raw, field, allowed, errors) {
  const value = String(raw ?? "").trim();
  if (!value) {
    issue(errors, field, "IMPORT_REQUIRED_FIELD", `${field} 不可空白`);
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const token of value.split("|")) {
    const trimmed = token.trim();
    const isDefault = trimmed.endsWith("*");
    const code = (isDefault ? trimmed.slice(0, -1) : trimmed).trim();
    if (!allowed.has(code) || seen.has(code)) {
      issue(errors, field, "IMPORT_PURPOSE_INVALID", `${field} 含有無效或重複用途`);
      return [];
    }
    seen.add(code); result.push({ code, isDefault });
  }
  return result;
}

async function rowsFor(connection, sql, values) {
  if (values.length === 0) return [];
  const [rows] = await connection.query(sql, [values]);
  return rows;
}

async function loadLookups(connection, records) {
  const customerIds = new Set(); const customerCodes = new Set(); const legalNames = new Set(); const tradingNames = new Set();
  const currencies = new Set(); const terms = new Set(); const users = new Set();
  const categories = new Set(); const industries = new Set(); const territories = new Set();
  const identifierValues = new Set();
  for (const record of records) {
    const id = Number(String(record.customerId).trim());
    if (Number.isSafeInteger(id) && id > 0) customerIds.add(id);
    try { if (record.customerCode.trim()) customerCodes.add(normalizeCustomerCode(record.customerCode).key); } catch { /* row validation reports it */ }
    try { if (record.legalName.trim()) legalNames.add(normalizeLegalName(record.legalName).key); } catch { /* row validation reports it */ }
    try { const trading = normalizeTradingName(record.tradingName).key; if (trading) tradingNames.add(trading); } catch { /* row validation reports it */ }
    for (const field of ["defaultCurrencyCode", "creditCurrencyCode"]) if (record[field].trim()) currencies.add(record[field].trim().toUpperCase());
    if (record.paymentTermCode.trim()) terms.add(upperKey(record.paymentTermCode));
    if (record.accountManagerUsername.trim()) users.add(key(record.accountManagerUsername));
    if (record.categoryCode.trim()) categories.add(key(record.categoryCode));
    if (record.industryCode.trim()) industries.add(key(record.industryCode));
    if (record.territoryCode.trim()) territories.add(key(record.territoryCode));
    const identity = identifierKey(record); if (identity) identifierValues.add(identity.split("\u0000")[2]);
  }
  const customerConditions = [];
  const customerParams = [];
  if (customerIds.size) { customerConditions.push("id IN (?)"); customerParams.push([...customerIds]); }
  if (customerCodes.size) { customerConditions.push("customer_code_key IN (?)"); customerParams.push([...customerCodes]); }
  if (legalNames.size) { customerConditions.push("legal_name_key IN (?)"); customerParams.push([...legalNames]); }
  if (tradingNames.size) { customerConditions.push("trading_name_key IN (?)"); customerParams.push([...tradingNames]); }
  const customerPromise = customerConditions.length
    ? connection.query(`SELECT id, customer_code, customer_code_key, legal_name_key, trading_name_key, version FROM customers WHERE ${customerConditions.join(" OR ")}`, customerParams).then(([rows]) => rows)
    : [];
  const [customerRows, currencyRows, termRows, userRows, categoryRows, industryRows, territoryRows, identifierRows] = await Promise.all([
    customerPromise,
    rowsFor(connection, "SELECT code, status FROM currencies WHERE code IN (?)", [...currencies]),
    rowsFor(connection, "SELECT id, code_key, status FROM payment_terms WHERE code_key IN (?)", [...terms]),
    rowsFor(connection, "SELECT id, username, status FROM users WHERE username IN (?)", [...users]),
    rowsFor(connection, "SELECT id, code_key, status FROM customer_categories WHERE code_key IN (?)", [...categories]),
    rowsFor(connection, "SELECT id, code_key, status FROM customer_industries WHERE code_key IN (?)", [...industries]),
    rowsFor(connection, "SELECT id, code_key, status FROM customer_territories WHERE code_key IN (?)", [...territories]),
    rowsFor(connection, "SELECT customer_id, identifier_type, issuer_country_code, identifier_value_key FROM customer_identifiers WHERE identifier_value_key IN (?)", [...identifierValues])
  ]);
  const map = (rows, field, normalize = key) => new Map(rows.map((row) => [normalize(row[field]), row]));
  const trading = new Map();
  for (const row of customerRows) {
    if (!row.trading_name_key) continue;
    if (!trading.has(row.trading_name_key)) trading.set(row.trading_name_key, new Set());
    trading.get(row.trading_name_key).add(Number(row.id));
  }
  return {
    customersById: map(customerRows, "id", Number), customersByCode: map(customerRows, "customer_code_key"),
    customersByLegal: map(customerRows, "legal_name_key"), customersByTrading: trading,
    identifiers: new Map(identifierRows.map((row) => [`${row.identifier_type}\u0000${row.issuer_country_code}\u0000${row.identifier_value_key}`, row])),
    currencies: map(currencyRows, "code", (value) => String(value).toUpperCase()),
    terms: map(termRows, "code_key", upperKey), users: map(userRows, "username"),
    categories: map(categoryRows, "code_key"), industries: map(industryRows, "code_key"), territories: map(territoryRows, "code_key")
  };
}

function reference(record, field, lookup, errors, { normalize = key, code, message }) {
  const value = String(record[field] ?? "").trim();
  if (!value) return undefined;
  const found = lookup.get(normalize(value));
  if (!found || found.status !== "active" && found.status !== "ACTIVE") {
    issue(errors, field, code, message); return null;
  }
  return Number(found.id);
}

function rootPayload(record, operation, lookups, errors) {
  const root = {};
  const required = operation === "create";
  if (operation === "create") {
    try { root.customerCode = normalizeCustomerCode(record.customerCode).value; }
    catch { issue(errors, "customerCode", "IMPORT_CUSTOMER_CODE_INVALID", "customerCode 格式不正確"); }
  }
  if (record.legalName.trim() || required) {
    try { root.legalName = normalizeLegalName(record.legalName).value; }
    catch { issue(errors, "legalName", "IMPORT_LEGAL_NAME_INVALID", "legalName 格式不正確"); }
  }
  if (record.tradingName.trim() || required) {
    try { root.tradingName = normalizeTradingName(record.tradingName).value; }
    catch { issue(errors, "tradingName", "IMPORT_TRADING_NAME_INVALID", "tradingName 格式不正確"); }
  }

  const currency = text(record, "defaultCurrencyCode", 3, errors, { required });
  if (currency) {
    const code = currency.toUpperCase(); const found = lookups.currencies.get(code);
    if (!/^[A-Z]{3}$/u.test(code) || found?.status !== "ACTIVE") issue(errors, "defaultCurrencyCode", "IMPORT_CURRENCY_NOT_ACTIVE", "defaultCurrencyCode 必須是有效的啟用貨幣");
    else root.defaultCurrencyCode = code;
  }
  const termId = reference(record, "paymentTermCode", lookups.terms, errors, { normalize: upperKey, code: "IMPORT_PAYMENT_TERM_NOT_ACTIVE", message: "paymentTermCode 不存在或未啟用" });
  const managerId = reference(record, "accountManagerUsername", lookups.users, errors, { code: "IMPORT_ACCOUNT_MANAGER_NOT_ACTIVE", message: "accountManagerUsername 不存在或未啟用" });
  const categoryId = reference(record, "categoryCode", lookups.categories, errors, { code: "IMPORT_CATEGORY_NOT_ACTIVE", message: "categoryCode 不存在或未啟用" });
  const industryId = reference(record, "industryCode", lookups.industries, errors, { code: "IMPORT_INDUSTRY_NOT_ACTIVE", message: "industryCode 不存在或未啟用" });
  const territoryId = reference(record, "territoryCode", lookups.territories, errors, { code: "IMPORT_TERRITORY_NOT_ACTIVE", message: "territoryCode 不存在或未啟用" });
  if (termId !== undefined) root.defaultPaymentTermId = termId;
  if (managerId !== undefined) root.accountManagerUserId = managerId;
  if (categoryId !== undefined) root.categoryId = categoryId;
  if (industryId !== undefined) root.industryId = industryId;
  if (territoryId !== undefined) root.territoryId = territoryId;

  for (const [field, max] of [["website", 500], ["generalPhone", 50], ["generalEmail", 254], ["notes", 2000]]) {
    if (!record[field].trim() && operation === "update") continue;
    const value = text(record, field, max, errors);
    if (field === "website" && value) {
      try { if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error(); }
      catch { issue(errors, field, "IMPORT_WEBSITE_INVALID", "website 必須是 HTTP 或 HTTPS URL"); continue; }
    }
    if (field === "generalEmail" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      issue(errors, field, "IMPORT_EMAIL_INVALID", "generalEmail 格式不正確"); continue;
    }
    root[field] = value;
  }
  return root;
}

function childPayload(record, operation, errors) {
  const childFields = [...Object.keys(ADDRESS_FIELDS), "addressPurposes", ...Object.keys(CONTACT_FIELDS), "contactPurposes", ...IDENTIFIER_FIELDS];
  if (operation === "update") {
    if (hasAny(record, childFields)) issue(errors, "children", "IMPORT_CHILD_UPDATE_UNSUPPORTED", "V1 upsert 不支援修改 Address、Contact 或 Identifier");
    return {};
  }
  const payload = {};
  if (hasAny(record, [...Object.keys(ADDRESS_FIELDS), "addressPurposes"])) {
    const address = {};
    for (const [field, [target, max]] of Object.entries(ADDRESS_FIELDS)) address[target] = text(record, field, max, errors, { required: field === "addressLabel" || field === "addressLine1" });
    if (address.countryCode && !/^[A-Z]{2}$/u.test(address.countryCode)) issue(errors, "addressCountryCode", "IMPORT_COUNTRY_INVALID", "addressCountryCode 格式不正確");
    address.purposes = parsePurposes(record.addressPurposes, "addressPurposes", ADDRESS_PURPOSES, errors);
    address.sortOrder = 0; payload.address = address;
  }
  if (hasAny(record, [...Object.keys(CONTACT_FIELDS), "contactPurposes"])) {
    const contact = {};
    for (const [field, [target, max]] of Object.entries(CONTACT_FIELDS)) contact[target] = text(record, field, max, errors, { required: field === "contactName" });
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contact.email)) issue(errors, "contactEmail", "IMPORT_EMAIL_INVALID", "contactEmail 格式不正確");
    if (contact.preferredLanguage && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(contact.preferredLanguage)) issue(errors, "contactPreferredLanguage", "IMPORT_LANGUAGE_INVALID", "contactPreferredLanguage 格式不正確");
    contact.purposes = parsePurposes(record.contactPurposes, "contactPurposes", CONTACT_PURPOSES, errors);
    contact.sortOrder = 0; payload.contact = contact;
  }
  if (hasAny(record, IDENTIFIER_FIELDS)) {
    const identifierType = text(record, "identifierType", 30, errors, { required: true });
    const issuerCountryCode = text(record, "identifierIssuerCountryCode", 2, errors, { required: true }).toUpperCase();
    const identifierValue = text(record, "identifierValue", 190, errors, { required: true });
    if (!IDENTIFIER_TYPES.has(identifierType)) issue(errors, "identifierType", "IMPORT_IDENTIFIER_TYPE_INVALID", "identifierType 格式不正確");
    if (!/^[A-Z]{2}$/u.test(issuerCountryCode)) issue(errors, "identifierIssuerCountryCode", "IMPORT_COUNTRY_INVALID", "identifierIssuerCountryCode 格式不正確");
    if (identifierValue) {
      try { normalizeIdentifierValue(identifierValue); } catch { issue(errors, "identifierValue", "IMPORT_IDENTIFIER_INVALID", "identifierValue 格式不正確"); }
    }
    const validFrom = epoch(record, "identifierValidFrom", errors); const expiresAt = epoch(record, "identifierExpiresAt", errors);
    if (validFrom !== null && expiresAt !== null && expiresAt <= validFrom) issue(errors, "identifierExpiresAt", "IMPORT_IDENTIFIER_DATES_INVALID", "identifierExpiresAt 必須晚於 identifierValidFrom");
    payload.identifier = { identifierType, issuerCountryCode, identifierValue, validFrom, expiresAt, notes: text(record, "identifierNotes", 500, errors) };
  }
  return payload;
}

function creditPayload(record, operation, lookups, errors) {
  if (!hasAny(record, ["creditLimit", "creditCurrencyCode", "creditStatus"])) return undefined;
  const limit = text(record, "creditLimit", 20, errors);
  const currencyCode = text(record, "creditCurrencyCode", 3, errors).toUpperCase();
  const status = text(record, "creditStatus", 20, errors, { required: operation === "create" });
  if (limit && !CREDIT_PATTERN.test(limit)) issue(errors, "creditLimit", "IMPORT_CREDIT_LIMIT_INVALID", "creditLimit 必須是四位小數的非負金額");
  if (currencyCode && (!/^[A-Z]{3}$/u.test(currencyCode) || lookups.currencies.get(currencyCode)?.status !== "ACTIVE")) issue(errors, "creditCurrencyCode", "IMPORT_CURRENCY_NOT_ACTIVE", "creditCurrencyCode 必須是有效的啟用貨幣");
  if (status && !new Set(["normal", "on_hold"]).has(status)) issue(errors, "creditStatus", "IMPORT_CREDIT_STATUS_INVALID", "creditStatus 只接受 normal 或 on_hold");
  if (operation === "create") return { creditLimit: limit || null, creditCurrencyCode: limit ? currencyCode : null, creditStatus: status };
  return {
    ...(limit ? { creditLimit: limit } : {}),
    ...(currencyCode ? { creditCurrencyCode: currencyCode } : {}),
    ...(status ? { creditStatus: status } : {})
  };
}

function buildRows(records, mode, lookups, sensitive, seen, rowOffset) {
  const rows = [];
  const { seenTargets, seenCodes, seenLegalNames, seenTradingNames, seenIdentifiers } = seen;
  for (const [index, record] of records.entries()) {
    const rowNumber = rowOffset + index + 1; const errors = []; const warnings = [];
    if (sensitive) issue(errors, "header", "IMPORT_SENSITIVE_FIELD_FORBIDDEN", "CSV 不可包含銀行、附件、憑證或內部備註欄位");
    const customerId = positiveInteger(record, "customerId", errors);
    let code;
    try { if (record.customerCode.trim()) code = normalizeCustomerCode(record.customerCode); }
    catch { issue(errors, "customerCode", "IMPORT_CUSTOMER_CODE_INVALID", "customerCode 格式不正確"); }
    const byId = customerId ? lookups.customersById.get(customerId) : null;
    const byCode = code ? lookups.customersByCode.get(code.key) : null;
    if (customerId && !byId) issue(errors, "customerId", "IMPORT_CUSTOMER_NOT_FOUND", "customerId 找不到 Customer");
    if (byId && code && byId.customer_code_key !== code.key) issue(errors, "customerCode", "IMPORT_CUSTOMER_MATCH_CONFLICT", "customerId 與 customerCode 不相符");
    const match = customerId ? byId : byCode;
    const operation = match ? "update" : "create";
    if (!customerId && !code) issue(errors, "customerCode", "IMPORT_MATCH_REQUIRED", "必須提供 customerId 或 customerCode");
    if (operation === "update" && mode !== "upsert") issue(errors, "customerCode", "IMPORT_MODE_MISMATCH", "create_only 模式不可更新 Customer");
    const root = rootPayload(record, operation, lookups, errors);
    let legalKey;
    if (root.legalName) legalKey = normalizeLegalName(root.legalName).key;
    const legalOwner = legalKey ? lookups.customersByLegal.get(legalKey) : null;
    if (legalOwner && Number(legalOwner.id) !== Number(match?.id)) issue(errors, "legalName", "IMPORT_LEGAL_NAME_TAKEN", "legalName 已被使用");
    let tradingKey;
    try { tradingKey = normalizeTradingName(record.tradingName).key; } catch { tradingKey = null; }
    if (tradingKey && [...(lookups.customersByTrading.get(tradingKey) ?? [])].some((id) => id !== Number(match?.id))) {
      issue(warnings, "tradingName", "IMPORT_TRADING_NAME_DUPLICATE", "tradingName 與現有 Customer 相同");
    }
    const codeOwnerRow = code ? seenCodes.get(code.key) : null;
    if (codeOwnerRow) issue(errors, "customerCode", "IMPORT_CUSTOMER_CODE_DUPLICATED_IN_FILE", `customerCode 在 CSV 第 ${codeOwnerRow} 及 ${rowNumber} 列重複`);
    else if (code) seenCodes.set(code.key, rowNumber);
    const legalOwnerRow = legalKey ? seenLegalNames.get(legalKey) : null;
    if (legalOwnerRow) issue(errors, "legalName", "IMPORT_LEGAL_NAME_DUPLICATED_IN_FILE", `legalName 在 CSV 第 ${legalOwnerRow} 及 ${rowNumber} 列重複`);
    else if (legalKey) seenLegalNames.set(legalKey, rowNumber);
    const tradingOwnerRow = tradingKey ? seenTradingNames.get(tradingKey) : null;
    if (tradingOwnerRow) issue(warnings, "tradingName", "IMPORT_TRADING_NAME_DUPLICATED_IN_FILE", `tradingName 在 CSV 第 ${tradingOwnerRow} 及 ${rowNumber} 列重複`);
    else if (tradingKey) seenTradingNames.set(tradingKey, rowNumber);
    if (match) {
      const previous = seenTargets.get(Number(match.id));
      if (previous) issue(errors, "customerId", "IMPORT_CUSTOMER_DUPLICATED_IN_FILE", `Customer 在 CSV 第 ${previous} 及 ${rowNumber} 列重複`);
      else seenTargets.set(Number(match.id), rowNumber);
    }
    const identity = operation === "create" ? identifierKey(record) : null;
    if (identity && lookups.identifiers.has(identity)) issue(errors, "identifierValue", "IMPORT_IDENTIFIER_TAKEN", "identifierValue 已被使用");
    const identityOwnerRow = identity ? seenIdentifiers.get(identity) : null;
    if (identityOwnerRow) issue(errors, "identifierValue", "IMPORT_IDENTIFIER_DUPLICATED_IN_FILE", `identifierValue 在 CSV 第 ${identityOwnerRow} 及 ${rowNumber} 列重複`);
    else if (identity) seenIdentifiers.set(identity, rowNumber);
    const normalizedPayload = { root, ...childPayload(record, operation, errors) };
    const credit = creditPayload(record, operation, lookups, errors); if (credit) normalizedPayload.credit = credit;
    const status = errors.length ? "invalid" : warnings.length ? "warning" : "valid";
    rows.push({ rowNumber, operation, matchCustomerId: match ? Number(match.id) : null, expectedCustomerVersion: match ? Number(match.version) : null, normalizedPayload, status, errors, warnings });
  }
  return rows;
}

export async function parseAndPrecheckCustomerCsv({
  source, mode, connection, maxRows = DEFAULT_MAX_ROWS, maxBytes = DEFAULT_MAX_BYTES,
  batchSize = 100, onRows
} = {}) {
  if (!connection?.query || !["create_only", "upsert"].includes(mode)) throw new TypeError("Customer import precheck requires a database connection and valid mode");
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(batchSize) || batchSize < 1 || onRows !== undefined && typeof onRows !== "function") {
    throw new TypeError("Customer import limits are invalid");
  }
  const collected = onRows ? null : [];
  const counts = { total: 0, valid: 0, warning: 0, invalid: 0 };
  const seen = {
    seenTargets: new Map(), seenCodes: new Map(), seenLegalNames: new Map(),
    seenTradingNames: new Map(), seenIdentifiers: new Map()
  };
  let rowOffset = 0;
  const parsed = await readCsv(source, {
    maxRows, maxBytes, batchSize: Math.min(batchSize, maxRows),
    async onBatch(records, sensitive) {
      const lookups = await loadLookups(connection, records);
      const rows = buildRows(records, mode, lookups, sensitive, seen, rowOffset);
      rowOffset += rows.length;
      for (const row of rows) { counts.total += 1; counts[row.status] += 1; }
      if (onRows) await onRows(rows); else collected.push(...rows);
    }
  });
  if (parsed.jobLevelError) return parsed;
  return { ...(collected ? { rows: collected } : {}), counts };
}
