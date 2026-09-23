const customerConfig = {
  bankEncryption: {
    activeKeyId: process.env.CUSTOMER_BANK_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.CUSTOMER_BANK_ENCRYPTION_KEYS || undefined
  },
  bankLookup: {
    activeKeyId: process.env.CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.CUSTOMER_BANK_LOOKUP_KEYS || undefined
  },
  attachment: {
    generalRoot: process.env.CUSTOMER_ATTACHMENT_GENERAL_ROOT || undefined,
    bankSensitiveRoot: process.env.CUSTOMER_ATTACHMENT_BANK_ROOT || undefined,
    tempRoot: process.env.CUSTOMER_ATTACHMENT_TEMP_ROOT || undefined,
    maxFileBytes: process.env.CUSTOMER_ATTACHMENT_MAX_FILE_BYTES || undefined,
    orphanGraceMs: process.env.CUSTOMER_ATTACHMENT_ORPHAN_GRACE_MS || undefined,
    malwareScanner: {
      mode: process.env.CUSTOMER_MALWARE_SCANNER_MODE || undefined,
      host: process.env.CUSTOMER_MALWARE_SCANNER_HOST || undefined,
      port: process.env.CUSTOMER_MALWARE_SCANNER_PORT || undefined,
      timeoutMs: process.env.CUSTOMER_MALWARE_SCANNER_TIMEOUT_MS || undefined
    }
  }
};

export default customerConfig;
