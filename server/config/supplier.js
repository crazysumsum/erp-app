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
    // 未設定 = import 未部署（同 CUSTOMER_IMPORT_ROOT 一樣）：照常開機，upload 回 503（HD-050）。
    root: process.env.SUPPLIER_IMPORT_ROOT || undefined,
    maxFileBytes: Number(
      process.env.SUPPLIER_IMPORT_MAX_FILE_BYTES || 10_485_760
    ),
    maxRows: Number(process.env.SUPPLIER_IMPORT_MAX_ROWS || 10_000),
    fileRetentionDays: Number(
      process.env.SUPPLIER_IMPORT_FILE_RETENTION_DAYS || 365
    ),
    // 從未確認嘅匯入工作（uploaded／ready）幾多日之後逾期：自動取消、刪來源檔（HD-071 B）。
    unconfirmedRetentionDays: Number(
      process.env.SUPPLIER_IMPORT_UNCONFIRMED_RETENTION_DAYS || 30
    )
  }
};

export default supplierConfig;
