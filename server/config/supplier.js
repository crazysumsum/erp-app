const supplierConfig = {
  bankEncryption: {
    activeKeyId: process.env.SUPPLIER_BANK_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.SUPPLIER_BANK_ENCRYPTION_KEYS || undefined
  },
  bankLookup: {
    activeKeyId: process.env.SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.SUPPLIER_BANK_LOOKUP_KEYS || undefined
  },
  duplicateNameThreshold: Number(
    process.env.SUPPLIER_DUPLICATE_NAME_THRESHOLD || 0.85
  ),
  import: {
    maxFileBytes: Number(
      process.env.SUPPLIER_IMPORT_MAX_FILE_BYTES || 10_485_760
    ),
    maxRows: Number(process.env.SUPPLIER_IMPORT_MAX_ROWS || 10_000),
    fileRetentionDays: Number(
      process.env.SUPPLIER_IMPORT_FILE_RETENTION_DAYS || 365
    )
  }
};

export default supplierConfig;
