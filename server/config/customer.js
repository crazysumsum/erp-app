const customerConfig = {
  bankEncryption: {
    activeKeyId: process.env.CUSTOMER_BANK_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.CUSTOMER_BANK_ENCRYPTION_KEYS || undefined
  },
  bankLookup: {
    activeKeyId: process.env.CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID || undefined,
    keyRing: process.env.CUSTOMER_BANK_LOOKUP_KEYS || undefined
  }
};

export default customerConfig;
