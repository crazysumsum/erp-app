import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { CustomerBankCrypto } from "../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankMaintenanceService } from "../src/modules/customer/CustomerBankMaintenanceService.js";
import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";

function secret() { return randomBytes(32).toString("base64"); }

function crypto() {
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc-new", keyRing: { "enc-old": secret(), "enc-new": secret() } },
    bankLookup: { activeKeyId: "look-new", keyRing: { "look-old": secret(), "look-new": secret() } }
  });
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

function harness({ row, duplicate = false }) {
  const updates = [];
  const audits = [];
  const connection = {
    async query(sql) {
      if (sql.includes("encryption_key_id <>")) return [[row]];
      if (sql.includes("blind_index_key_id <>")) return [[row]];
      if (sql.includes("account_blind_index =")) return [duplicate ? [{ id: 99 }] : []];
      if (sql.includes("COUNT(*)")) return [[{ count: 0 }]];
      return [[]];
    },
    async execute(sql, params) { updates.push({ sql, params }); return [{ affectedRows: 1 }]; }
  };
  const database = {
    query: (...args) => connection.query(...args),
    withTransaction: (work) => work(connection)
  };
  return {
    service: new CustomerBankMaintenanceService({
      database, crypto: row.crypto, time: { nowMs: () => 2_000 },
      audit: { async record(_connection, entry) { audits.push(entry); } }
    }),
    updates,
    audits
  };
}

test("Customer bank encryption rotation rewrites an old-key row and emits counts-only audit", async () => {
  const bankCrypto = crypto();
  const old = bankCrypto.encryptWithKeyId({ customerId: 7, cryptoContext: "ctx-1", accountNumber: "1234-5678", encryptionKeyId: "enc-old" });
  const { service, updates, audits } = harness({ row: {
    id: 41, customer_id: 7, crypto_context: "ctx-1", account_ciphertext: old.ciphertext,
    account_iv: old.iv, account_auth_tag: old.authTag, encryption_key_id: "enc-old", crypto: bankCrypto
  } });
  const result = await service.rotateEncryptionBatch({ afterId: 0, batchSize: 10, actorId: null, reason: "operator rotation" });
  assert.deepEqual(result, { processed: 1, lastId: 41, remaining: 0 });
  assert.ok(updates[0].sql.includes("encryption_key_id"));
  assert.equal(updates[0].params.includes("enc-new"), true);
  assert.equal(JSON.stringify(audits).includes("12345678"), false);
  assert.equal(audits[0].action, "bank.key_rotated");
});

test("Customer bank reindex refuses a duplicate instead of overwriting it", async () => {
  const bankCrypto = crypto();
  const old = bankCrypto.encryptWithKeyId({ customerId: 7, cryptoContext: "ctx-1", accountNumber: "1234-5678", encryptionKeyId: "enc-old" });
  const base = { id: 41, customer_id: 7, crypto_context: "ctx-1", account_ciphertext: old.ciphertext,
    account_iv: old.iv, account_auth_tag: old.authTag, encryption_key_id: "enc-old", blind_index_key_id: "look-old", crypto: bankCrypto };
  const { service, updates } = harness({ row: base, duplicate: true });
  await assert.rejects(
    () => service.reindexBatch({ afterId: 0, batchSize: 10, actorId: null, reason: "operator reindex" }),
    (error) => error.code === "CUSTOMER_BANK_REINDEX_DUPLICATE"
  );
  assert.equal(updates.length, 0);
});
