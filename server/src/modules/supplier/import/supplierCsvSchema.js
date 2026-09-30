import { stringify } from "csv-stringify/sync";

/**
 * Supplier CSV template v1（T43；設計 §6.9）。
 *
 * 一列一個 Supplier：root 欄位，加各一組選填嘅主要 Address、主要 Contact 同 Identifier。
 * 冇任何 Bank 欄位 —— 一般匯入唔接受銀行資料（BR-028、AC-034），出現就成個檔拒絕。
 * 所有 CSV 讀寫一律經 csv-parse／csv-stringify（設計 §6.9；REV-060 L-11）。
 */
export const SUPPLIER_IMPORT_TEMPLATE_VERSION = "v1";
export const SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER = "__SUPPLIER_IMPORT_TEMPLATE_V1_DESCRIPTION__";
export const SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER = "__SUPPLIER_IMPORT_TEMPLATE_V1_EXAMPLE__";
export const SUPPLIER_IMPORT_BANK_NOTICE = "本範本不接受任何銀行欄位（帳號、IBAN、SWIFT 等）；銀行資料只可在供應商頁面維護。";

const column = (name, group, maxLength, description, example = "") =>
  Object.freeze({ name, group, maxLength, description, example });

export const SUPPLIER_IMPORT_COLUMNS = Object.freeze([
  column("supplierId", "match", 20, "Upsert 選填：現有供應商 ID；有值時優先以 ID 配對並以 supplierCode 交叉核對", ""),
  column("supplierCode", "match", 64, "Supplier Code；新增時必填，更新時用作配對，匯入不會修改 Code", "SUP-001"),
  column("supplierName", "root", 190, "供應商名稱；新增時必填", "Acme Trading Limited"),
  column("displayName", "root", 190, "顯示名稱", "Acme"),
  column("defaultCurrencyCode", "root", 3, "啟用中的 ISO 4217 貨幣代碼；新增時必填", "HKD"),
  column("paymentTermCode", "root", 50, "啟用中的付款條款代碼", "NET30"),
  column("website", "root", 500, "HTTP 或 HTTPS 網址", "https://example.com"),
  column("generalPhone", "root", 50, "一般電話", "+852 2123 4567"),
  column("generalEmail", "root", 254, "一般電郵", "sales@example.com"),
  column("notes", "root", 2000, "一般備註；不要填寫銀行資料", ""),
  column("addressLabel", "address", 100, "主要地址名稱；填寫任何地址欄位時必填", "Head office"),
  column("addressPurpose", "address", 20, "地址用途：registered、office、ordering、return、remittance、other；填寫任何地址欄位時必填", "office"),
  column("addressLine1", "address", 190, "地址第 1 行", "1 Example Road"),
  column("addressLine2", "address", 190, "地址第 2 行", ""),
  column("addressLine3", "address", 190, "地址第 3 行", ""),
  column("city", "address", 100, "城市", "Hong Kong"),
  column("stateRegion", "address", 100, "州／地區", ""),
  column("postalCode", "address", 100, "郵遞區號；前導零會保留", ""),
  column("countryCode", "address", 2, "ISO 3166-1 兩位國家／地區代碼", "HK"),
  column("addressPhone", "address", 50, "地址電話", ""),
  column("contactName", "contact", 190, "主要聯絡人姓名；填寫任何聯絡人欄位時必填", "Alex Chan"),
  column("contactPurpose", "contact", 20, "聯絡人用途：general、orders、sales、accounts_payable、returns、emergency；填寫任何聯絡人欄位時必填", "orders"),
  column("jobTitle", "contact", 100, "職銜", ""),
  column("department", "contact", 100, "部門", ""),
  column("contactEmail", "contact", 254, "聯絡人電郵", "alex@example.com"),
  column("contactPhone", "contact", 50, "聯絡人電話", ""),
  column("contactMobile", "contact", 50, "聯絡人手機", ""),
  column("identifierType", "identifier", 30, "識別類型：business_registration、company_registration、tax、other；三個識別欄位要一齊填", "business_registration"),
  column("issuerCountryCode", "identifier", 2, "發證國家／地區兩位代碼", "HK"),
  column("identifierValue", "identifier", 190, "識別號碼", "12345678")
]);

export const SUPPLIER_IMPORT_COLUMN_NAMES = Object.freeze(SUPPLIER_IMPORT_COLUMNS.map(({ name }) => name));

export const SUPPLIER_IMPORT_CHILD_COLUMNS = Object.freeze(
  SUPPLIER_IMPORT_COLUMNS.filter(({ group }) => ["address", "contact", "identifier"].includes(group)).map(({ name }) => name)
);

// 將 header 壓成細楷字母數字再比：`Account No.`、`account_number`、`IBAN ` 全部中。
const BANK_HEADER = /bank|iban|swift|bic|routing|beneficiary|sortcode|accountnumber|accountno|acctno|accno|ciphertext|blindindex|encryptionkey|lookupkey|keyid/u;
export function isBankColumn(header) {
  return BANK_HEADER.test(String(header ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, ""));
}

export function buildSupplierImportTemplate() {
  const descriptions = SUPPLIER_IMPORT_COLUMNS.map(({ name, description }, index) =>
    index === 0 ? `${SUPPLIER_IMPORT_TEMPLATE_DESCRIPTION_MARKER} ${SUPPLIER_IMPORT_BANK_NOTICE} ${name}: ${description}` : `${name}: ${description}`);
  const example = SUPPLIER_IMPORT_COLUMNS.map(({ example: value }, index) => (index === 0 ? SUPPLIER_IMPORT_TEMPLATE_EXAMPLE_MARKER : value));
  return stringify([SUPPLIER_IMPORT_COLUMN_NAMES, descriptions, example], SUPPLIER_CSV_STRINGIFY_OPTIONS);
}

/**
 * CRLF 分列時 csv-stringify 只會為含 `\r\n` 嘅 cell 加引號，淨係 `\n` 或 `\r` 嘅 cell 會原樣
 * 寫出，再讀返就錯位。所以兩者都要強制加引號。T46 嘅結果檔都要用呢組 option。
 */
export const SUPPLIER_CSV_STRINGIFY_OPTIONS = Object.freeze({ bom: true, record_delimiter: "windows", quoted_match: /[\r\n]/u });
