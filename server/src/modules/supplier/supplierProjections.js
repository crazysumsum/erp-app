export function toSupplierSummaryResponse(row) {
  return {
    id: Number(row.id),
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    displayName: row.display_name,
    defaultCurrencyCode: row.default_currency_code,
    defaultPaymentTermId: row.default_payment_term_id === null ? null : Number(row.default_payment_term_id),
    status: row.status,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

export function toSupplierDetailResponse(row, {
  addresses = [],
  contacts = [],
  identifiers = [],
  bankAccounts = [],
  warnings = []
} = {}) {
  return {
    ...toSupplierSummaryResponse(row),
    website: row.website,
    generalPhone: row.general_phone,
    generalEmail: row.general_email,
    notes: row.notes,
    createdAt: Number(row.created_at),
    addresses,
    contacts,
    identifiers,
    bankAccounts,
    warnings
  };
}

export function toAddressResponse(row) {
  return {
    id: Number(row.id),
    supplierId: Number(row.supplier_id),
    label: row.label,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    addressLine3: row.address_line3,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

export function toContactResponse(row) {
  return {
    id: Number(row.id),
    supplierId: Number(row.supplier_id),
    name: row.name,
    jobTitle: row.job_title,
    department: row.department,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    preferredLanguage: row.preferred_language,
    notes: row.notes,
    status: row.status,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

export function toIdentifierResponse(row) {
  return {
    id: Number(row.id),
    supplierId: Number(row.supplier_id),
    identifierType: row.identifier_type,
    issuerCountryCode: row.issuer_country_code,
    identifierValue: row.identifier_value,
    notes: row.notes,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

export function toMaskedBankResponse(row) {
  const accountLength = Number(row.account_length);
  const maskedAccountNumber = accountLength > 4 ? `•••• ${row.last_four}` : "•".repeat(accountLength);
  return {
    id: Number(row.id),
    supplierId: row.supplier_id === undefined ? undefined : Number(row.supplier_id),
    bankName: row.bank_name,
    accountHolderName: row.account_holder_name,
    bankCountryCode: row.bank_country_code,
    accountCurrencyCode: row.account_currency_code,
    maskedAccountNumber,
    status: row.status,
    isDefault: Boolean(row.is_default),
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}
