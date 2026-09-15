export const SUPPLIER_STATUSES = Object.freeze([
  "draft",
  "pending_approval",
  "active",
  "suspended",
  "blocked",
  "archived"
]);

export const SUPPLIER_ACTIVATABLE_STATUSES = Object.freeze(["draft", "suspended"]);

export const SUPPLIER_IDENTIFIER_TYPES = Object.freeze([
  "business_registration",
  "company_registration",
  "tax",
  "other"
]);

export const SUPPLIER_ADDRESS_PURPOSES = Object.freeze([
  "registered",
  "office",
  "ordering",
  "return",
  "remittance",
  "other"
]);

export const SUPPLIER_CONTACT_PURPOSES = Object.freeze([
  "general",
  "orders",
  "sales",
  "accounts_payable",
  "returns",
  "emergency"
]);

export const SUPPLIER_LIST_SORT_FIELDS = Object.freeze([
  "supplierCode",
  "supplierName",
  "defaultCurrencyCode",
  "defaultPaymentTerm",
  "status",
  "updatedAt"
]);
