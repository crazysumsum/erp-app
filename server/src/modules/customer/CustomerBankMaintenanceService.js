import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerBankCrypto } from "./CustomerBankCrypto.js";

function batch(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 1000) {
    throw new TypeError("Customer bank maintenance batchSize must be between 1 and 1000");
  }
  return number;
}

function cursor(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError("Customer bank maintenance afterId is invalid");
  return number;
}

export class CustomerBankMaintenanceService {
  constructor({ database, crypto, time, audit = new CustomerAuditLogService() } = {}) {
    if (!database || !time || !(crypto instanceof CustomerBankCrypto)) {
      throw new TypeError("CustomerBankMaintenanceService requires database, time and CustomerBankCrypto");
    }
    this.database = database;
    this.crypto = crypto;
    this.time = time;
    this.audit = audit;
  }

  async rotateEncryptionBatch({ afterId = 0, batchSize = 100, actorId = null, reason = "controlled key rotation" } = {}) {
    const start = cursor(afterId);
    const limit = batch(batchSize);
    let lastId = start;
    const processed = await this.database.withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, customer_id, crypto_context, account_ciphertext, account_iv, account_auth_tag, encryption_key_id
           FROM customer_bank_accounts
          WHERE id > ? AND encryption_key_id <> ? ORDER BY id LIMIT ? FOR UPDATE`,
        [start, this.crypto.activeEncryptionKeyId, limit]
      );
      for (const row of rows) {
        const accountNumber = this.crypto.decrypt({
          customerId: row.customer_id, cryptoContext: row.crypto_context,
          ciphertext: row.account_ciphertext, iv: row.account_iv,
          authTag: row.account_auth_tag, encryptionKeyId: row.encryption_key_id
        });
        const sealed = this.crypto.encrypt({
          customerId: row.customer_id, cryptoContext: row.crypto_context, accountNumber
        });
        await connection.execute(
          `UPDATE customer_bank_accounts SET account_ciphertext = ?, account_iv = ?, account_auth_tag = ?,
             encryption_key_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
          [sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId, this.time.nowMs(), actorId, row.id]
        );
        await this.audit.record(connection, {
          occurredAt: this.time.nowMs(), actorUserId: actorId, actorUsername: "operator",
          action: "bank.key_rotated", targetType: "bank", targetId: Number(row.id),
          customerId: Number(row.customer_id), targetLabel: "", reason,
          detail: { after: { keyRotationCount: 1 } }, requestId: "", ip: ""
        });
        lastId = Number(row.id);
      }
      return rows.length;
    });
    const [[count]] = await this.database.query(
      "SELECT COUNT(*) AS count FROM customer_bank_accounts WHERE encryption_key_id <> ?",
      [this.crypto.activeEncryptionKeyId]
    );
    return { processed, lastId, remaining: Number(count.count ?? count.COUNT ?? 0) };
  }

  async reindexBatch({ afterId = 0, batchSize = 100, actorId = null, reason = "controlled blind-index rotation" } = {}) {
    const start = cursor(afterId);
    const limit = batch(batchSize);
    let lastId = start;
    const processed = await this.database.withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, customer_id, crypto_context, bank_country_code, bank_code, branch_code,
                account_ciphertext, account_iv, account_auth_tag, encryption_key_id, blind_index_key_id
           FROM customer_bank_accounts
          WHERE id > ? AND blind_index_key_id <> ? ORDER BY id LIMIT ? FOR UPDATE`,
        [start, this.crypto.activeLookupKeyId, limit]
      );
      for (const row of rows) {
        const accountNumber = this.crypto.decrypt({
          customerId: row.customer_id, cryptoContext: row.crypto_context,
          ciphertext: row.account_ciphertext, iv: row.account_iv,
          authTag: row.account_auth_tag, encryptionKeyId: row.encryption_key_id
        });
        const blind = this.crypto.blindIndex({
          countryCode: row.bank_country_code, bankCode: row.bank_code,
          branchCode: row.branch_code, accountNumber
        });
        const [duplicates] = await connection.query(
          `SELECT id FROM customer_bank_accounts WHERE customer_id = ? AND blind_index_key_id = ?
             AND account_blind_index = ? AND id <> ? LIMIT 1`,
          [row.customer_id, blind.keyId, blind.index, row.id]
        );
        if (duplicates.length > 0) {
          throw Object.assign(new Error("Customer bank reindex found a same-owner duplicate"), {
            code: "CUSTOMER_BANK_REINDEX_DUPLICATE"
          });
        }
        await connection.execute(
          `UPDATE customer_bank_accounts SET account_blind_index = ?, blind_index_key_id = ?,
             version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
          [blind.index, blind.keyId, this.time.nowMs(), actorId, row.id]
        );
        await this.audit.record(connection, {
          occurredAt: this.time.nowMs(), actorUserId: actorId, actorUsername: "operator",
          action: "bank.reindexed", targetType: "bank", targetId: Number(row.id),
          customerId: Number(row.customer_id), targetLabel: "", reason,
          detail: { after: { reindexCount: 1 } }, requestId: "", ip: ""
        });
        lastId = Number(row.id);
      }
      return rows.length;
    });
    const [[count]] = await this.database.query(
      "SELECT COUNT(*) AS count FROM customer_bank_accounts WHERE blind_index_key_id <> ?",
      [this.crypto.activeLookupKeyId]
    );
    return { processed, lastId, remaining: Number(count.count ?? count.COUNT ?? 0) };
  }
}
