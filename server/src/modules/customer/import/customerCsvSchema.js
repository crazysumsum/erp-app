export const CUSTOMER_IMPORT_TEMPLATE_VERSION = "v1";
export const CUSTOMER_IMPORT_TEMPLATE_DESCRIPTION_PREFIX = "__CUSTOMER_IMPORT_TEMPLATE_V1_DESCRIPTION__";
export const CUSTOMER_IMPORT_TEMPLATE_EXAMPLE_MARKER = "__CUSTOMER_IMPORT_TEMPLATE_V1_EXAMPLE__";

const column = (name, description, example = "") => Object.freeze({ name, description, example });

export const CUSTOMER_IMPORT_COLUMNS = Object.freeze([
  column("customerId", "Existing Customer numeric ID; blank creates or matches by customerCode", ""),
  column("customerCode", "Customer code; required for create and cross-checks customerId", "ACME-HK"),
  column("legalName", "Legal name; required for create", "Acme Hong Kong Limited"),
  column("tradingName", "Trading name", "Acme HK"),
  column("defaultCurrencyCode", "Active ISO 4217 currency code; required for create", "HKD"),
  column("paymentTermCode", "Active Business Master payment-term code", "NET30"),
  column("accountManagerUsername", "Active account-manager username", "sam"),
  column("categoryCode", "Active Customer category code", "wholesale"),
  column("industryCode", "Active Customer industry code", "retail"),
  column("territoryCode", "Active Customer territory code", "hk"),
  column("website", "HTTP or HTTPS website", "https://example.com"),
  column("generalPhone", "General phone number", "+852 2123 4567"),
  column("generalEmail", "General email address", "sales@example.com"),
  column("notes", "General Customer notes; public operational context only", "Imported from approved onboarding form"),
  column("addressLabel", "Address label", "Head office"),
  column("addressRecipientCompanyDepartment", "Recipient company or department", "Accounts Payable"),
  column("addressLine1", "Address line 1", "1 Example Road"),
  column("addressLine2", "Address line 2", "18/F"),
  column("addressLine3", "Address line 3", ""),
  column("addressCity", "City", "Hong Kong"),
  column("addressStateRegion", "State or region", "Hong Kong"),
  column("addressPostalCode", "Postal code", ""),
  column("addressCountryCode", "ISO 3166-1 alpha-2 country code", "HK"),
  column("addressPhone", "Address phone", "+852 2123 4567"),
  column("addressNotes", "General address notes", "Reception during business hours"),
  column("addressPurposes", "Pipe-separated purpose codes; suffix * marks default", "billing*|shipping*"),
  column("contactName", "Contact name", "Alex Chan"),
  column("contactJobTitle", "Contact job title", "Finance Manager"),
  column("contactDepartment", "Contact department", "Finance"),
  column("contactEmail", "Contact email", "alex@example.com"),
  column("contactPhone", "Contact phone", "+852 2123 4567"),
  column("contactMobile", "Contact mobile", "+852 9123 4567"),
  column("contactPreferredLanguage", "BCP 47 preferred language", "zh-HK"),
  column("contactNotes", "General contact notes", "Primary billing contact"),
  column("contactPurposes", "Pipe-separated purpose codes; suffix * marks default", "general*|billing_ar*"),
  column("identifierType", "company_registration, business_registration, tax or other", "business_registration"),
  column("identifierIssuerCountryCode", "ISO 3166-1 alpha-2 issuer country code", "HK"),
  column("identifierValue", "Identifier display value", "12345678"),
  column("identifierValidFrom", "Optional epoch-millisecond validity start", ""),
  column("identifierExpiresAt", "Optional epoch-millisecond expiry", ""),
  column("identifierNotes", "General identifier notes", "Verified against registry"),
  column("creditLimit", "Decimal amount with four decimal places; blank means no policy", "100000.0000"),
  column("creditCurrencyCode", "Active ISO 4217 currency code for creditLimit", "HKD"),
  column("creditStatus", "normal or on_hold", "normal")
]);

export const CUSTOMER_IMPORT_COLUMN_NAMES = Object.freeze(CUSTOMER_IMPORT_COLUMNS.map(({ name }) => name));

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCustomerImportTemplate() {
  const header = CUSTOMER_IMPORT_COLUMN_NAMES.map(csvCell).join(",");
  const descriptions = CUSTOMER_IMPORT_COLUMNS.map(({ name, description }, index) =>
    csvCell(`${index === 0 ? `${CUSTOMER_IMPORT_TEMPLATE_DESCRIPTION_PREFIX} ` : ""}${name}: ${description}`)
  ).join(",");
  const example = CUSTOMER_IMPORT_COLUMNS.map(({ example }, index) =>
    csvCell(index === 0 ? CUSTOMER_IMPORT_TEMPLATE_EXAMPLE_MARKER : example)
  ).join(",");
  return `\uFEFF${header}\r\n${descriptions}\r\n${example}\r\n`;
}
