function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function displayName(row) {
  return row.trading_name || row.legal_name;
}

export function toCustomerSummary(row) {
  return {
    id: Number(row.id),
    code: row.customer_code,
    legalName: row.legal_name,
    displayName: displayName(row),
    generalPhone: row.general_phone,
    generalEmail: row.general_email,
    defaultCurrencyCode: row.default_currency_code,
    defaultPaymentTermId: numberOrNull(row.default_payment_term_id),
    accountManagerUserId: numberOrNull(row.account_manager_user_id),
    categoryId: numberOrNull(row.category_id),
    industryId: numberOrNull(row.industry_id),
    territoryId: numberOrNull(row.territory_id),
    creditStatus: row.credit_status ?? "not_configured",
    status: row.status,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}

export function toCustomerDetail(row, { addresses = [], contacts = [], identifiers = [], credit } = {}) {
  return {
    ...toCustomerSummary({ ...row, credit_status: row.credit_status ?? credit?.status }),
    tradingName: row.trading_name,
    website: row.website,
    notes: row.notes,
    everActivatedAt: numberOrNull(row.ever_activated_at),
    createdAt: Number(row.created_at),
    createdBy: numberOrNull(row.created_by),
    updatedBy: numberOrNull(row.updated_by),
    addresses,
    contacts,
    identifiers,
    credit: credit ?? {
      configured: false,
      creditLimit: null,
      currencyCode: null,
      status: "not_configured",
      policyVersion: null
    }
  };
}

export function toMaskedCustomerBank(row, mask) {
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    accountHolderName: row.account_holder_name,
    bankName: row.bank_name,
    bankCountryCode: row.bank_country_code,
    bankCode: row.bank_code,
    branchCode: row.branch_code,
    swiftBic: row.swift_bic,
    accountCurrencyCode: row.account_currency_code,
    purposeCode: row.purpose_code,
    maskedAccountNumber: mask({ lastFour: row.last_four, accountLength: row.account_length }),
    isDefault: Boolean(row.is_default),
    status: row.status,
    version: Number(row.version),
    updatedAt: Number(row.updated_at)
  };
}
