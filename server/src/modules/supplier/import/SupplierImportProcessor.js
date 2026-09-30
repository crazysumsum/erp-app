import { Readable } from "node:stream";
import { parse } from "csv-parse";

import { normalizeAddress } from "../SupplierAddressService.js";
import { normalizeContact } from "../SupplierContactService.js";
import { SupplierDuplicateCandidates } from "../supplierDuplicateCandidates.js";
import {
  normalizeContactEmail, normalizeIdentifier, normalizeSupplierCode, normalizeSupplierName,
  normalizeSupplierOptionalText, normalizeSupplierUrl
} from "../supplierNormalization.js";
import {
  isBankColumn, SUPPLIER_IMPORT_CHILD_COLUMNS, SUPPLIER_IMPORT_COLUMN_NAMES, SUPPLIER_IMPORT_COLUMNS,
  SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER, SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER
} from "./supplierCsvSchema.js";

/**
 * Supplier CSV 預檢（T43；設計 §6.9、§8.8）。
 *
 * 讀 CSV、逐列正規化同驗證，將結果交畀 `onRows` 寫入 import rows。**唔寫任何 Supplier 表**：
 * 對資料庫只有讀（配對現有 Supplier、Identifier 撞號、名稱相似）。
 *
 * - 檔案層面嘅問題（唔係 UTF-8、RFC 4180 格式錯、header 重複／缺少／未知、Bank 欄位、超過上限）
 *   令成個 job 失敗，一列都唔寫：Bank 值因此冇可能落到資料庫（AC-034）。
 * - 列層面嘅規則同 API 一樣（BR-026）：用同一批 normalizer，錯誤用同一套公開 code。
 * - 錯誤訊息全部係固定字串，唔會帶 CSV 嘅值；每列最多 MAX_ISSUES 個（設計 §10：有界）。
 * - 配對、狀態等結果只係預檢時嘅快照，T45 執行時要再驗。
 */
const MODES = Object.freeze(["create_only", "upsert"]);
const MAX_ISSUES = 20;
const ADDRESS_COLUMNS = SUPPLIER_IMPORT_COLUMNS.filter(({ group }) => group === "address").map(({ name }) => name);
const CONTACT_COLUMNS = SUPPLIER_IMPORT_COLUMNS.filter(({ group }) => group === "contact").map(({ name }) => name);
const IDENTIFIER_COLUMNS = SUPPLIER_IMPORT_COLUMNS.filter(({ group }) => group === "identifier").map(({ name }) => name);
const MAX_LENGTH = new Map(SUPPLIER_IMPORT_COLUMNS.map(({ name, maxLength }) => [name, maxLength]));
// normalizer 報嘅 field 名 → CSV 欄名。
const CONTACT_FIELDS = Object.freeze({ name: "contactName", email: "contactEmail", phone: "contactPhone", mobile: "contactMobile" });
const ROOT_FIELDS = Object.freeze({ email: "generalEmail" });

function jobError(code, message) {
  return { jobLevelError: { code, message } };
}

function issue(list, field, code, message) {
  if (list.length < MAX_ISSUES) list.push({ field, code, message });
}

function containsControl(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

/** 行 domain normalizer；佢拋出嘅公開 code／訊息照用（BR-026），其他錯誤照拋。 */
function domain(errors, fieldMap, fallbackField, fn) {
  try {
    return fn();
  } catch (error) {
    if (!error?.publicCode) throw error;
    const field = error.details?.field;
    const fallback = typeof fallbackField === "function" ? fallbackField(error.publicCode) : fallbackField;
    issue(errors, fieldMap[field] ?? (field && MAX_LENGTH.has(field) ? field : fallback), error.publicCode, error.publicMessage);
    return undefined;
  }
}

function headerError(headers) {
  const seen = new Set();
  for (const header of headers) {
    if (seen.has(header)) return jobError("SUPPLIER_IMPORT_HEADER_DUPLICATE", "CSV 欄位名稱不可重複");
    seen.add(header);
  }
  // Bank 先於「未知」：兩者都拒絕，但要講清楚係因為銀行資料。只講第幾欄，唔重複 header 內容。
  const bank = headers.findIndex(isBankColumn);
  if (bank !== -1) {
    return jobError("SUPPLIER_IMPORT_BANK_COLUMN_FORBIDDEN", `CSV 第 ${bank + 1} 欄是銀行資料欄位；一般匯入不接受銀行資料，請刪除該欄`);
  }
  const unknown = headers.findIndex((header) => !SUPPLIER_IMPORT_COLUMN_NAMES.includes(header));
  if (unknown !== -1) return jobError("SUPPLIER_IMPORT_HEADER_UNKNOWN", `CSV 第 ${unknown + 1} 欄不是範本 v1 的欄位`);
  const missing = SUPPLIER_IMPORT_COLUMN_NAMES.find((name) => !seen.has(name));
  if (missing) return jobError("SUPPLIER_IMPORT_HEADER_MISSING", `CSV 缺少範本欄位 ${missing}`);
  return null;
}

function isTemplateRow(firstCell) {
  return firstCell.startsWith(SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER) || firstCell === SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER;
}

async function loadBatchLookups(connection, records) {
  const ids = new Set();
  const codeKeys = new Set();
  const identifierKeys = new Set();
  for (const record of records) {
    if (/^[1-9][0-9]{0,15}$/u.test(record.supplierId)) ids.add(Number(record.supplierId));
    try { if (record.supplierCode) codeKeys.add(normalizeSupplierCode(record.supplierCode).key); } catch { /* 列驗證會報 */ }
    try {
      if (record.identifierValue) {
        identifierKeys.add(normalizeIdentifier({
          type: record.identifierType, issuerCountryCode: record.issuerCountryCode, value: record.identifierValue
        }).key);
      }
    } catch { /* 列驗證會報 */ }
  }
  const conditions = [];
  const params = [];
  if (ids.size) { conditions.push("id IN (?)"); params.push([...ids]); }
  if (codeKeys.size) { conditions.push("supplier_code_key IN (?)"); params.push([...codeKeys]); }
  const [suppliers] = conditions.length
    ? await connection.query(`SELECT id, supplier_code_key, status, version FROM suppliers WHERE ${conditions.join(" OR ")}`, params)
    : [[]];
  const [identifiers] = identifierKeys.size
    ? await connection.query(
      `SELECT identifier_type, issuer_country_code, identifier_value_key FROM supplier_identifiers
        WHERE identifier_value_key IN (?)`, [[...identifierKeys]])
    : [[]];
  return {
    byId: new Map(suppliers.map((row) => [Number(row.id), row])),
    byCode: new Map(suppliers.map((row) => [row.supplier_code_key, row])),
    identifiers: new Set(identifiers.map((row) => `${row.identifier_type}\u0000${row.issuer_country_code}\u0000${row.identifier_value_key}`))
  };
}

function checkCells(record, errors) {
  const bad = new Set();
  for (const [name, value] of Object.entries(record)) {
    if (!value) continue;
    if (Array.from(value).length > MAX_LENGTH.get(name)) {
      issue(errors, name, "SUPPLIER_IMPORT_FIELD_TOO_LONG", `${name} 超過 ${MAX_LENGTH.get(name)} 字元上限`);
      bad.add(name);
    } else if (containsControl(value)) {
      issue(errors, name, "SUPPLIER_IMPORT_FIELD_INVALID", `${name} 不可包含換行或控制字元`);
      bad.add(name);
    }
  }
  return bad;
}

function match(record, mode, lookups, errors, bad) {
  let supplierId = null;
  if (record.supplierId && !bad.has("supplierId")) {
    if (/^[1-9][0-9]{0,15}$/u.test(record.supplierId)) supplierId = Number(record.supplierId);
    else issue(errors, "supplierId", "SUPPLIER_IMPORT_SUPPLIER_ID_INVALID", "supplierId 必須是正整數");
  }
  const code = record.supplierCode && !bad.has("supplierCode")
    ? domain(errors, {}, "supplierCode", () => normalizeSupplierCode(record.supplierCode))
    : undefined;
  if (mode === "create_only") {
    if (record.supplierId) issue(errors, "supplierId", "SUPPLIER_IMPORT_MODE_MISMATCH", "只新增模式不可指定 supplierId");
    if (code && lookups.byCode.has(code.key)) issue(errors, "supplierCode", "SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用");
    return { operation: "create", code, target: null };
  }
  const byId = supplierId ? lookups.byId.get(supplierId) : undefined;
  if (supplierId && !byId) issue(errors, "supplierId", "SUPPLIER_NOT_FOUND", "找不到這個供應商 ID");
  if (byId && code && byId.supplier_code_key !== code.key) {
    issue(errors, "supplierCode", "SUPPLIER_IMPORT_MATCH_CONFLICT", "supplierId 與 supplierCode 不是同一個供應商");
  }
  const target = supplierId ? byId ?? null : (code ? lookups.byCode.get(code.key) ?? null : null);
  if (target?.status === "archived") issue(errors, "supplierId", "SUPPLIER_UPDATE_NOT_ALLOWED", "已封存供應商不可修改一般資料");
  return { operation: record.supplierId || target ? "update" : "create", code, target };
}

function rootPayload(record, operation, code, catalog, errors, bad) {
  const create = operation === "create";
  const root = {};
  const given = (name) => Boolean(record[name]) && !bad.has(name);
  for (const name of ["supplierCode", "supplierName", "defaultCurrencyCode"]) {
    if (create && !record[name]) issue(errors, name, "SUPPLIER_IMPORT_REQUIRED_FIELD", `新增供應商必須填寫 ${name}`);
  }
  if (create && code) root.supplierCode = code.value;
  if (given("supplierName")) {
    const name = domain(errors, ROOT_FIELDS, "supplierName", () => normalizeSupplierName(record.supplierName));
    if (name) root.supplierName = name.value;
  }
  if (given("defaultCurrencyCode")) {
    const currency = catalog.currencies.get(record.defaultCurrencyCode.toUpperCase());
    if (currency) root.defaultCurrencyCode = currency.code;
    else issue(errors, "defaultCurrencyCode", "CURRENCY_NOT_ACTIVE", "貨幣不存在或未啟用");
  }
  if (given("paymentTermCode")) {
    // 同 Business Master 嘅 normalizePaymentTermCode 一樣：NFKC、壓空白、大楷。
    const term = catalog.paymentTerms.get(record.paymentTermCode.normalize("NFKC").replace(/\s+/gu, " ").toUpperCase());
    if (term) root.defaultPaymentTermId = term.id;
    else issue(errors, "paymentTermCode", "PAYMENT_TERM_NOT_ACTIVE", "付款條款不存在或未啟用");
  } else if (create) {
    root.defaultPaymentTermId = null;
  }
  // 更新列：空白 = 保持原值（設計 §6.9），所以只放有填嘅欄位。
  const optional = [
    ["displayName", () => normalizeSupplierOptionalText(record.displayName, { field: "displayName", maxLength: 190 })],
    ["website", () => normalizeSupplierUrl(record.website)],
    ["generalPhone", () => normalizeSupplierOptionalText(record.generalPhone, { field: "generalPhone", maxLength: 50 })],
    ["generalEmail", () => normalizeContactEmail(record.generalEmail).value],
    ["notes", () => normalizeSupplierOptionalText(record.notes, { field: "notes", maxLength: 2000 })]
  ];
  for (const [name, normalize] of optional) {
    if (given(name)) {
      const value = domain(errors, ROOT_FIELDS, name, normalize);
      if (value !== undefined) root[name] = value;
    } else if (create) {
      root[name] = "";
    }
  }
  return root;
}

function childPayload(record, errors, bad) {
  const payload = {};
  const any = (columns) => columns.some((name) => record[name]);
  const clean = (columns) => !columns.some((name) => bad.has(name));
  if (any(ADDRESS_COLUMNS)) {
    if (!record.addressLabel) issue(errors, "addressLabel", "SUPPLIER_IMPORT_REQUIRED_FIELD", "填寫地址時必須填寫 addressLabel");
    if (!record.addressPurpose) issue(errors, "addressPurpose", "SUPPLIER_IMPORT_REQUIRED_FIELD", "填寫地址時必須填寫 addressPurpose");
    if (record.addressLabel && record.addressPurpose && clean(ADDRESS_COLUMNS)) {
      const address = domain(errors, {}, (code) => (code.includes("COUNTRY") ? "countryCode" : "addressPurpose"), () => normalizeAddress({
        label: record.addressLabel, addressLine1: record.addressLine1, addressLine2: record.addressLine2,
        addressLine3: record.addressLine3, city: record.city, stateRegion: record.stateRegion,
        postalCode: record.postalCode, countryCode: record.countryCode, phone: record.addressPhone,
        purposes: [{ purposeCode: record.addressPurpose, isPrimary: true }]
      }));
      if (address) payload.address = address;
    }
  }
  if (any(CONTACT_COLUMNS)) {
    if (!record.contactName) issue(errors, "contactName", "SUPPLIER_IMPORT_REQUIRED_FIELD", "填寫聯絡人時必須填寫 contactName");
    if (!record.contactPurpose) issue(errors, "contactPurpose", "SUPPLIER_IMPORT_REQUIRED_FIELD", "填寫聯絡人時必須填寫 contactPurpose");
    if (record.contactName && record.contactPurpose && clean(CONTACT_COLUMNS)) {
      const contact = domain(errors, CONTACT_FIELDS, "contactPurpose", () => normalizeContact({
        name: record.contactName, jobTitle: record.jobTitle, department: record.department,
        email: record.contactEmail, phone: record.contactPhone, mobile: record.contactMobile,
        purposes: [{ purposeCode: record.contactPurpose, isPrimary: true }]
      }));
      if (contact) payload.contact = contact;
    }
  }
  if (any(IDENTIFIER_COLUMNS) && clean(IDENTIFIER_COLUMNS)) {
    const identifier = domain(errors, {}, "identifierValue", () => normalizeIdentifier({
      type: record.identifierType, issuerCountryCode: record.issuerCountryCode, value: record.identifierValue
    }));
    if (identifier) payload.identifier = identifier;
  }
  return payload;
}

async function checkRow(record, rowNumber, context) {
  const { mode, catalog, lookups, seen, connection, duplicates } = context;
  const errors = [];
  const warnings = [];
  const bad = checkCells(record, errors);
  const { operation, code, target } = match(record, mode, lookups, errors, bad);
  const root = rootPayload(record, operation, code, catalog, errors, bad);
  let children = {};
  if (operation === "update") {
    if (SUPPLIER_IMPORT_CHILD_COLUMNS.some((name) => record[name])) {
      issue(errors, "children", "IMPORT_CHILD_UPDATE_UNSUPPORTED", "更新供應商時不支援修改地址、聯絡人或識別資料，請使用供應商頁面");
    }
  } else {
    children = childPayload(record, errors, bad);
  }

  if (code) {
    const first = seen.codes.get(code.key);
    if (first) issue(errors, "supplierCode", "SUPPLIER_IMPORT_CODE_DUPLICATED_IN_FILE", `Supplier Code 與第 ${first} 列重複`);
    else seen.codes.set(code.key, rowNumber);
  }
  if (target) {
    const first = seen.targets.get(Number(target.id));
    if (first) issue(errors, "supplierId", "SUPPLIER_IMPORT_SUPPLIER_DUPLICATED_IN_FILE", `同一個供應商已在第 ${first} 列出現`);
    else seen.targets.set(Number(target.id), rowNumber);
  }
  if (children.identifier) {
    const key = `${children.identifier.type}\u0000${children.identifier.issuerCountryCode}\u0000${children.identifier.key}`;
    const first = seen.identifiers.get(key);
    if (lookups.identifiers.has(key)) issue(errors, "identifierValue", "SUPPLIER_IDENTIFIER_TAKEN", "這項供應商識別資料已被使用");
    else if (first) issue(errors, "identifierValue", "SUPPLIER_IMPORT_IDENTIFIER_DUPLICATED_IN_FILE", `識別資料與第 ${first} 列重複`);
    else seen.identifiers.set(key, rowNumber);
  }
  if (root.supplierName) {
    const nameKey = normalizeSupplierName(root.supplierName).key;
    const first = seen.names.get(nameKey);
    if (first) issue(warnings, "supplierName", "SUPPLIER_IMPORT_NAME_DUPLICATED_IN_FILE", `供應商名稱與第 ${first} 列相同`);
    else seen.names.set(nameKey, rowNumber);
    // 同 create／update API 一樣只係提示（設計：名稱重覆只 warning）。錯誤列唔使查。
    if (errors.length === 0 && (await duplicates.find(connection, { nameKey, excludeSupplierId: target ? Number(target.id) : null })).length > 0) {
      issue(warnings, "supplierName", "SUPPLIER_IMPORT_NAME_SIMILAR", "與現有供應商名稱相同或相似，請確認不是重覆建立");
    }
  }
  return {
    rowNumber, operation,
    matchSupplierId: target ? Number(target.id) : null,
    expectedSupplierVersion: target ? Number(target.version) : null,
    normalizedPayload: { root, ...children },
    status: errors.length ? "invalid" : warnings.length ? "warning" : "valid",
    errors, warnings
  };
}

/**
 * `source` 係成個檔嘅 Buffer（上限 maxBytes）。`catalog` 係 Business Master 啟用中嘅貨幣
 * （code → {code}）同付款條款（code → {id}）。回 `{ counts }` 或 `{ jobLevelError }`。
 */
export async function precheckSupplierCsv({
  source, mode, connection, catalog, duplicates = new SupplierDuplicateCandidates(),
  maxRows, maxBytes, batchSize = 500, onRows, signal
} = {}) {
  if (!Buffer.isBuffer(source) || !MODES.includes(mode) || typeof connection?.query !== "function" ||
      !(catalog?.currencies instanceof Map) || !(catalog?.paymentTerms instanceof Map) || typeof onRows !== "function" ||
      ![maxRows, maxBytes, batchSize].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError("Supplier import precheck input is invalid");
  }
  if (source.length > maxBytes) return jobError("SUPPLIER_IMPORT_FILE_TOO_LARGE", "CSV 檔案超過大小上限");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    return jobError("SUPPLIER_IMPORT_CSV_NOT_UTF8", "CSV 必須使用 UTF-8 編碼");
  }

  const parser = Readable.from([text]).pipe(parse({ bom: true, skip_empty_lines: true, max_record_size: 65_536 }));
  const counts = { total: 0, valid: 0, warning: 0, invalid: 0 };
  const seen = { codes: new Map(), targets: new Map(), identifiers: new Map(), names: new Map() };
  let headers = null;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    signal?.throwIfAborted?.();
    const lookups = await loadBatchLookups(connection, batch.map(({ record }) => record));
    const rows = [];
    for (const { record, rowNumber } of batch) {
      const row = await checkRow(record, rowNumber, { mode, catalog, lookups, seen, connection, duplicates });
      counts.total += 1;
      counts[row.status] += 1;
      rows.push(row);
    }
    batch = [];
    await onRows(rows);
  };
  try {
    let rowNumber = 0;
    for await (const values of parser) {
      if (!headers) {
        headers = values.map((value) => value.trim());
        const error = headerError(headers);
        if (error) return error;
        continue;
      }
      // 範本嘅說明／範例列，同試算表留低嘅全空白列（`,,,,`），都唔係資料。
      if (isTemplateRow(values[0] ?? "") || values.every((value) => !value.trim())) continue;
      rowNumber += 1;
      if (rowNumber > maxRows) return jobError("SUPPLIER_IMPORT_TOO_MANY_ROWS", `CSV 超過 ${maxRows} 列上限`);
      // 前導零、中英文照原樣保留；只去頭尾空白。
      batch.push({ rowNumber, record: Object.fromEntries(headers.map((name, index) => [name, String(values[index] ?? "").trim()])) });
      if (batch.length >= batchSize) await flush();
    }
  } catch (error) {
    if (error?.code?.startsWith?.("CSV_")) return jobError("SUPPLIER_IMPORT_CSV_MALFORMED", "CSV 格式不符合 RFC 4180（引號或欄數不正確）");
    throw error;
  }
  if (!headers) return jobError("SUPPLIER_IMPORT_CSV_EMPTY", "CSV 沒有欄位名稱或資料列");
  await flush();
  if (counts.total === 0) return jobError("SUPPLIER_IMPORT_CSV_EMPTY", "CSV 沒有資料列");
  return { counts };
}
