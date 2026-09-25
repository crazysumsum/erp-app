import { assertActorFresh } from "../authorization/directoryLookups.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import { CustomerBankCrypto, maskCustomerBankAccount, normalizeCustomerBankAccount } from "./CustomerBankCrypto.js";
import { customerBankError, customerNotFound, versionConflict } from "./customerErrors.js";
import { toMaskedCustomerBank } from "./customerProjections.js";

const ACTIVE = "active";
const MASKED_COLUMNS = `id, customer_id, account_holder_name, bank_name, bank_country_code,
  bank_code, branch_code, swift_bic, account_currency_code, purpose_code, last_four,
  account_length, is_default, status, version, created_at, updated_at`;
const PURPOSES = new Set(["general", "collection_match", "refund"]);

function invalid(message, field) {
  throw customerBankError("BANK_ACCOUNT_INVALID", 400, message, field ? { field } : undefined);
}

function requiredText(value, field, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || Array.from(text).length > maxLength || /\p{Cc}/u.test(text)) invalid("銀行帳戶資料無效", field);
  return text;
}

function optionalText(value, field, maxLength) {
  const text = String(value ?? "").trim();
  if (Array.from(text).length > maxLength || /\p{Cc}/u.test(text)) invalid("銀行帳戶資料無效", field);
  return text;
}

function optionalCode(value, field, pattern) {
  const code = String(value ?? "").trim().toUpperCase();
  if (code && !pattern.test(code)) invalid("銀行帳戶代碼無效", field);
  return code || null;
}

function normalizeInput(input, { requireAccount }) {
  const purposeCode = String(input.purposeCode ?? "general").trim();
  if (!PURPOSES.has(purposeCode)) invalid("銀行帳戶用途無效", "purposeCode");
  if (requireAccount || input.accountNumber !== undefined) {
    const normalized = normalizeCustomerBankAccount(input.accountNumber);
    if (!normalized || normalized.length > 512 || /[^0-9A-Z]/u.test(normalized)) invalid("銀行帳號無效", "accountNumber");
  }
  return {
    accountHolderName: requiredText(input.accountHolderName, "accountHolderName", 190),
    bankName: requiredText(input.bankName, "bankName", 190),
    bankCountryCode: optionalCode(input.bankCountryCode, "bankCountryCode", /^[A-Z]{2}$/u),
    bankCode: optionalText(input.bankCode, "bankCode", 50),
    branchCode: optionalText(input.branchCode, "branchCode", 50),
    swiftBic: optionalCode(input.swiftBic, "swiftBic", /^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/u) ?? "",
    accountCurrencyCode: optionalCode(input.accountCurrencyCode, "accountCurrencyCode", /^[A-Z]{3}$/u),
    purposeCode
  };
}

function reason(value) {
  const text = String(value ?? "").trim();
  if (text.length < 5 || text.length > 500 || /\p{Cc}/u.test(text)) invalid("這項銀行操作必須填寫原因", "reason");
  return text;
}

function duplicateConstraint(error, name) {
  const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean);
  const duplicate = chain.find((item) => Number(item.errno) === 1062 || item.code === "ER_DUP_ENTRY");
  return Boolean(duplicate && new RegExp(`for key '(?:[^']*\\.)?${name}'`, "u")
    .test(String(duplicate.sqlMessage ?? duplicate.message ?? "")));
}

export class CustomerBankService {
  constructor({ database, logger, time, crypto, authorize = assertActorFresh, audit, businessMaster } = {}) {
    if (!database || !time || !(crypto instanceof CustomerBankCrypto)) {
      throw new TypeError("CustomerBankService requires database, time and CustomerBankCrypto");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.crypto = crypto;
    this.authorize = authorize;
    this.audit = audit ?? new CustomerAuditLogService();
    this.businessMaster = businessMaster ?? new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
  }

  #assert(actor, permissions) {
    if (!permissions.every((permission) => actor?.permissions?.includes(permission))) {
      throw customerBankError("BANK_PERMISSION_LOST", 403, "你目前沒有執行這項銀行操作的權限");
    }
  }

  async #customer(connection, customerId, lock = false) {
    const [[row]] = await connection.query(
      `SELECT id, customer_code FROM customers WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
      [customerId]
    );
    if (!row) throw customerNotFound(customerId);
    return row;
  }

  async #row(connection, customerId, bankAccountId, lock = false) {
    const [[row]] = await connection.query(
      `SELECT ${MASKED_COLUMNS}, crypto_context, encryption_key_id, blind_index_key_id
         FROM customer_bank_accounts WHERE id = ? AND customer_id = ?${lock ? " FOR UPDATE" : ""}`,
      [bankAccountId, customerId]
    );
    if (!row) throw customerBankError("CUSTOMER_BANK_NOT_FOUND", 404, "找不到指定的銀行帳戶");
    return row;
  }

  async #project(connection, customerId, bankAccountId) {
    const [[row]] = await connection.query(
      `SELECT ${MASKED_COLUMNS} FROM customer_bank_accounts WHERE id = ? AND customer_id = ?`,
      [bankAccountId, customerId]
    );
    return toMaskedCustomerBank(row, maskCustomerBankAccount);
  }

  async #duplicateRows(connection, customerId, accountInput, excludeId = null) {
    const candidates = this.crypto.candidateBlindIndexes(accountInput);
    const clauses = candidates.map(() => "(b.blind_index_key_id = ? AND b.account_blind_index = ?)").join(" OR ");
    const params = candidates.flatMap(({ keyId, index }) => [keyId, index]);
    const [rows] = await connection.query(
      `SELECT b.id, b.customer_id FROM customer_bank_accounts b
         JOIN customers c ON c.id = b.customer_id WHERE ${clauses} ORDER BY b.id`,
      params
    );
    if (rows.some((row) => Number(row.customer_id) === Number(customerId) && Number(row.id) !== Number(excludeId))) {
      throw customerBankError("BANK_ACCOUNT_DUPLICATE", 409, "這個客戶已有相同的銀行帳戶");
    }
    return rows.some((row) => Number(row.customer_id) !== Number(customerId));
  }

  #scope(input, value) {
    return {
      countryCode: value.bankCountryCode ?? "",
      bankCode: value.bankCode,
      branchCode: value.branchCode,
      accountNumber: input.accountNumber
    };
  }

  #confirmCrossCustomer(input, accountInput, duplicate) {
    if (!duplicate) return;
    const valid = input.confirmCrossCustomerDuplicate === true && this.crypto.verifyConfirmationToken(
      input.warningToken,
      { actorId: input.actorId, customerId: input.customerId, input: accountInput, nowMs: this.time.nowMs() }
    );
    if (valid) return;
    const warningToken = this.crypto.issueConfirmationToken({
      actorId: input.actorId,
      customerId: input.customerId,
      input: accountInput,
      expiresAt: this.time.nowMs() + 5 * 60 * 1000
    });
    throw customerBankError(
      "BANK_CROSS_CUSTOMER_CONFIRMATION_REQUIRED",
      409,
      "另一個客戶有疑似相同的銀行帳戶，請確認後重新提交",
      { warningToken, expiresInSeconds: 300 }
    );
  }

  #seal(customerId, cryptoContext, accountInput) {
    const sealed = this.crypto.encrypt({ customerId, cryptoContext, accountNumber: accountInput.accountNumber });
    const blind = this.crypto.blindIndex(accountInput);
    return { ...sealed, blindIndex: blind.index, blindIndexKeyId: blind.keyId };
  }

  async #assertCurrency(connection, code) {
    if (!code) return;
    try {
      await this.businessMaster.assertCurrencyUsableInTransaction(connection, { code, purpose: "new_assignment" });
    } catch (error) {
      if (error?.code === "CURRENCY_NOT_ACTIVE") invalid("銀行帳戶貨幣目前不可使用", "accountCurrencyCode");
      throw error;
    }
  }

  async list({ actorId, claimedRoles, claimedPermissions, customerId, includeInactive = false }) {
    const actor = await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    this.#assert(actor, ["customer.view"]);
    await this.#customer(this.database, customerId);
    const [rows] = await this.database.query(
      `SELECT ${MASKED_COLUMNS} FROM customer_bank_accounts
        WHERE customer_id = ?${includeInactive ? "" : " AND status = 'active'"}
        ORDER BY is_default DESC, id`,
      [customerId]
    );
    return { items: rows.map((row) => toMaskedCustomerBank(row, maskCustomerBankAccount)) };
  }

  async create(input) {
    const value = normalizeInput(input, { requireAccount: true });
    const operationReason = reason(input.reason);
    const accountInput = this.#scope(input, value);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assert(actor, ["customer.view", "customer.bank.view", "customer.bank.mgmt"]);
      const customer = await this.#customer(connection, input.customerId, true);
      await this.#assertCurrency(connection, value.accountCurrencyCode);
      const duplicate = await this.#duplicateRows(connection, input.customerId, accountInput);
      this.#confirmCrossCustomer(input, accountInput, duplicate);
      const cryptoContext = this.crypto.newCryptoContext();
      const sealed = this.#seal(input.customerId, cryptoContext, accountInput);
      const now = this.time.nowMs();
      if (input.isDefault) {
        await connection.query(
          "SELECT id FROM customer_bank_accounts WHERE customer_id = ? AND status = ? ORDER BY id FOR UPDATE",
          [input.customerId, ACTIVE]
        );
        await connection.execute(
          "UPDATE customer_bank_accounts SET is_default = 0, version = version + 1, updated_at = ?, updated_by = ? WHERE customer_id = ? AND is_default = 1",
          [now, input.actorId, input.customerId]
        );
      }
      let result;
      try {
        [result] = await connection.execute(
          `INSERT INTO customer_bank_accounts
             (customer_id, crypto_context, account_holder_name, bank_name, bank_country_code,
              bank_code, branch_code, swift_bic, account_currency_code, purpose_code,
              account_ciphertext, account_iv, account_auth_tag, encryption_key_id,
              account_blind_index, blind_index_key_id, last_four, account_length,
              is_default, status, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [input.customerId, cryptoContext, value.accountHolderName, value.bankName, value.bankCountryCode,
            value.bankCode, value.branchCode, value.swiftBic, value.accountCurrencyCode, value.purposeCode,
            sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId,
            sealed.blindIndex, sealed.blindIndexKeyId, sealed.lastFour, sealed.accountLength,
            input.isDefault ? 1 : 0, ACTIVE, now, now, input.actorId, input.actorId]
        );
      } catch (error) {
        if (duplicateConstraint(error, "uq_customer_bank_same_owner")) {
          throw customerBankError("BANK_ACCOUNT_DUPLICATE", 409, "這個客戶已有相同的銀行帳戶");
        }
        throw error;
      }
      const projected = await this.#project(connection, input.customerId, Number(result.insertId));
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username,
        action: "bank.create", targetType: "bank", targetId: projected.id,
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: operationReason,
        detail: { after: { maskedAccountNumber: projected.maskedAccountNumber, isDefault: projected.isDefault } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async update(input) {
    const value = normalizeInput(input, { requireAccount: false });
    const operationReason = reason(input.reason);
    const changingAccount = input.accountNumber !== undefined;
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assert(actor, ["customer.view", "customer.bank.view", "customer.bank.mgmt"]);
      const customer = await this.#customer(connection, input.customerId, true);
      const current = await this.#row(connection, input.customerId, input.bankAccountId, true);
      if (Number(current.version) !== Number(input.version)) throw versionConflict(current.version);
      if (current.status !== ACTIVE) throw customerBankError("BANK_ACCOUNT_INACTIVE", 409, "已停用的銀行帳戶不可修改");
      await this.#assertCurrency(connection, value.accountCurrencyCode);
      let sealed = null;
      if (changingAccount) {
        const accountInput = this.#scope(input, value);
        const duplicate = await this.#duplicateRows(connection, input.customerId, accountInput, input.bankAccountId);
        this.#confirmCrossCustomer(input, accountInput, duplicate);
        sealed = this.#seal(input.customerId, current.crypto_context, accountInput);
      }
      const now = this.time.nowMs();
      let result;
      try {
        [result] = await connection.execute(
          `UPDATE customer_bank_accounts SET account_holder_name = ?, bank_name = ?, bank_country_code = ?,
              bank_code = ?, branch_code = ?, swift_bic = ?, account_currency_code = ?, purpose_code = ?,
              ${sealed ? "account_ciphertext = ?, account_iv = ?, account_auth_tag = ?, encryption_key_id = ?, account_blind_index = ?, blind_index_key_id = ?, last_four = ?, account_length = ?," : ""}
              version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND customer_id = ? AND version = ?`,
          [value.accountHolderName, value.bankName, value.bankCountryCode, value.bankCode, value.branchCode,
            value.swiftBic, value.accountCurrencyCode, value.purposeCode,
            ...(sealed ? [sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId, sealed.blindIndex,
              sealed.blindIndexKeyId, sealed.lastFour, sealed.accountLength] : []),
            now, input.actorId, input.bankAccountId, input.customerId, input.version]
        );
      } catch (error) {
        if (duplicateConstraint(error, "uq_customer_bank_same_owner")) {
          throw customerBankError("BANK_ACCOUNT_DUPLICATE", 409, "這個客戶已有相同的銀行帳戶");
        }
        throw error;
      }
      if (result.affectedRows !== 1) throw versionConflict(current.version);
      const projected = await this.#project(connection, input.customerId, input.bankAccountId);
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username,
        action: "bank.update", targetType: "bank", targetId: projected.id,
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: operationReason,
        detail: { after: { maskedAccountNumber: projected.maskedAccountNumber, isDefault: projected.isDefault } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async setDefault(input) {
    const operationReason = reason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assert(actor, ["customer.view", "customer.bank.view", "customer.bank.mgmt"]);
      const customer = await this.#customer(connection, input.customerId, true);
      await connection.query(
        "SELECT id FROM customer_bank_accounts WHERE customer_id = ? AND status = ? ORDER BY id FOR UPDATE",
        [input.customerId, ACTIVE]
      );
      const current = await this.#row(connection, input.customerId, input.bankAccountId, true);
      if (Number(current.version) !== Number(input.version)) throw versionConflict(current.version);
      if (current.status !== ACTIVE) throw customerBankError("BANK_ACCOUNT_INACTIVE", 409, "已停用的銀行帳戶不可設為預設");
      const now = this.time.nowMs();
      await connection.execute(
        "UPDATE customer_bank_accounts SET is_default = 0, version = version + 1, updated_at = ?, updated_by = ? WHERE customer_id = ? AND is_default = 1 AND id != ?",
        [now, input.actorId, input.customerId, input.bankAccountId]
      );
      const [result] = await connection.execute(
        "UPDATE customer_bank_accounts SET is_default = 1, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND customer_id = ? AND version = ?",
        [now, input.actorId, input.bankAccountId, input.customerId, input.version]
      );
      if (result.affectedRows !== 1) throw versionConflict(current.version);
      const projected = await this.#project(connection, input.customerId, input.bankAccountId);
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username,
        action: "bank.default", targetType: "bank", targetId: projected.id,
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: operationReason,
        detail: { after: { maskedAccountNumber: projected.maskedAccountNumber, isDefault: true } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async deactivate(input) {
    const operationReason = reason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assert(actor, ["customer.view", "customer.bank.view", "customer.bank.mgmt"]);
      const customer = await this.#customer(connection, input.customerId, true);
      const current = await this.#row(connection, input.customerId, input.bankAccountId, true);
      if (Number(current.version) !== Number(input.version)) throw versionConflict(current.version);
      if (current.status !== ACTIVE) throw customerBankError("BANK_ACCOUNT_INACTIVE", 409, "銀行帳戶已停用");
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        "UPDATE customer_bank_accounts SET status = 'inactive', is_default = 0, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND customer_id = ? AND version = ?",
        [now, input.actorId, input.bankAccountId, input.customerId, input.version]
      );
      if (result.affectedRows !== 1) throw versionConflict(current.version);
      const projected = await this.#project(connection, input.customerId, input.bankAccountId);
      await this.audit.record(connection, {
        occurredAt: now, actorUserId: input.actorId, actorUsername: actor.username,
        action: "bank.deactivate", targetType: "bank", targetId: projected.id,
        customerId: Number(input.customerId), targetLabel: customer.customer_code, reason: operationReason,
        detail: { after: { maskedAccountNumber: projected.maskedAccountNumber, isDefault: false } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async reveal(input) {
    const operationReason = reason(input.reason);
    let accountNumber;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assert(actor, ["customer.view", "customer.bank.view"]);
      const [[row]] = await connection.query(
        `SELECT id, customer_id, bank_name, crypto_context, account_ciphertext, account_iv,
                account_auth_tag, encryption_key_id FROM customer_bank_accounts
          WHERE id = ? AND customer_id = ?`,
        [input.bankAccountId, input.customerId]
      );
      if (!row) throw customerBankError("CUSTOMER_BANK_NOT_FOUND", 404, "找不到指定的銀行帳戶");
      try {
        accountNumber = this.crypto.decrypt({
          customerId: row.customer_id, cryptoContext: row.crypto_context, ciphertext: row.account_ciphertext,
          iv: row.account_iv, authTag: row.account_auth_tag, encryptionKeyId: row.encryption_key_id
        });
      } catch (error) {
        this.logger?.warn?.("customer.bank.reveal.unreadable", "Customer bank account could not be read", {
          customerId: Number(row.customer_id), bankAccountId: Number(row.id), reason: error?.message ?? "unknown"
        });
        throw customerBankError("BANK_ACCOUNT_UNREADABLE", 422, "這個銀行帳戶目前無法讀取，請聯絡系統管理員");
      }
      await this.audit.record(connection, {
        occurredAt: this.time.nowMs(), actorUserId: input.actorId, actorUsername: actor.username,
        action: "bank.reveal", targetType: "bank", targetId: Number(row.id),
        customerId: Number(row.customer_id), targetLabel: row.bank_name, reason: operationReason,
        detail: { after: { revealed: true } }, requestId: input.requestId, ip: input.ip
      });
    });
    return { id: Number(input.bankAccountId), accountNumber, revealedAt: this.time.nowMs(), expiresInSeconds: 30 };
  }
}
