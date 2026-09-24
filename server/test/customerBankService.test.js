import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { ApplicationError } from "../src/framework/errors/ApplicationError.js";
import { CustomerBankCrypto } from "../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankService } from "../src/modules/customer/CustomerBankService.js";
import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";

const ACCOUNT = "123-456789-001";
const actor = { actorId: 3, claimedRoles: [], claimedPermissions: ["customer.view"], requestId: "req-1", ip: "127.0.0.1" };
const details = {
  accountHolderName: "Example Customer Limited", bankName: "Example Bank", bankCountryCode: "HK",
  bankCode: "001", branchCode: "002", swiftBic: "EXAMPLHH", accountCurrencyCode: "HKD",
  purposeCode: "general"
};

function realCrypto() {
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: { "enc-1": randomBytes(32).toString("base64") } },
    bankLookup: { activeKeyId: "look-1", keyRing: { "look-1": randomBytes(32).toString("base64") } }
  });
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

function bankRow(overrides = {}) {
  return {
    id: 41, customer_id: 7, account_holder_name: "Example Customer Limited", bank_name: "Example Bank",
    bank_country_code: "HK", bank_code: "001", branch_code: "002", swift_bic: "EXAMPLHH",
    account_currency_code: "HKD", purpose_code: "general", last_four: "9001", account_length: 12,
    is_default: 0, status: "active", version: 1, created_at: 100, updated_at: 100,
    crypto_context: "ctx-41", encryption_key_id: "enc-1", blind_index_key_id: "look-1",
    ...overrides
  };
}

function harness({ row = bankRow(), duplicates = [], permissions = ["customer.view", "customer.bank.view", "customer.bank.mgmt"], sealedRow = null, executeError = null, businessMaster = { async assertCurrencyUsableInTransaction() {} } } = {}) {
  const events = [];
  const crypto = realCrypto();
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM customers") && sql.includes("FOR UPDATE")) return [[{ id: 7, customer_code: "CUS-007" }]];
      if (sql.includes("FROM customers WHERE id")) return [[{ id: 7 }]];
      if (sql.includes("JOIN customers c")) return [duplicates];
      if (sql.includes("account_ciphertext") && sql.includes("WHERE id = ?")) return [[sealedRow].filter(Boolean)];
      if (sql.includes("status = ? ORDER BY id FOR UPDATE")) return [[{ id: 40, is_default: 1, status: "active" }]];
      if (sql.includes("FROM customer_bank_accounts")) return [[row].filter(Boolean)];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO customer_bank_accounts")) return [{ insertId: 41, affectedRows: 1 }];
      if (executeError && sql.includes("UPDATE customer_bank_accounts SET account_holder_name")) throw executeError;
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    query: (...args) => connection.query(...args),
    async withTransaction(work) {
      try {
        const result = await work(connection);
        events.push(["commit"]);
        return result;
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw Object.assign(new Error("transaction failed", { cause: error }), { code: "DATABASE_TRANSACTION_FAILED" });
      }
    }
  };
  const audited = [];
  const service = new CustomerBankService({
    database, logger: { warn() {} }, time: { nowMs: () => 1_000 }, crypto,
    businessMaster,
    authorize: async () => ({ id: 3, username: "tester", permissions }),
    audit: { async record(_connection, entry) { audited.push(entry); events.push(["audit", entry.action]); } }
  });
  return { service, events, audited, crypto };
}

test("Customer bank masked list never selects or returns cryptographic material", async () => {
  const { service, events } = harness();
  const result = await service.list({ ...actor, customerId: 7 });
  assert.equal(result.items[0].maskedAccountNumber, "••••••••9001");
  assert.equal(result.items[0].accountNumber, undefined);
  const sql = events.map(([, statement]) => statement).filter(Boolean).join("\n");
  for (const field of ["account_ciphertext", "account_iv", "account_auth_tag", "account_blind_index", "encryption_key_id"]) {
    assert.equal(sql.includes(field), false);
  }
});

test("Customer bank create requires a bound token for a cross-Customer duplicate", async () => {
  const { service, events } = harness({ duplicates: [{ id: 90, customer_id: 9 }] });
  let token;
  await assert.rejects(
    () => service.create({ ...actor, ...details, customerId: 7, accountNumber: ACCOUNT, reason: "新增已核對的銀行帳戶" }),
    (error) => {
      token = error.publicDetails?.warningToken;
      return error.publicCode === "BANK_CROSS_CUSTOMER_CONFIRMATION_REQUIRED" && typeof token === "string";
    }
  );
  assert.equal(events.some(([kind, sql]) => kind === "execute" && sql.includes("INSERT INTO customer_bank_accounts")), false);

  const created = await service.create({
    ...actor, ...details, customerId: 7, accountNumber: ACCOUNT, reason: "確認跨客戶共用帳戶",
    confirmCrossCustomerDuplicate: true, warningToken: token
  });
  assert.equal(created.id, 41);
  assert.equal(JSON.stringify(created).includes("123456789001"), false);
});

test("Customer bank duplicate confirmation rejects replay under a different actor or target", async () => {
  const { service, crypto } = harness({ duplicates: [{ id: 90, customer_id: 9 }] });
  const input = { countryCode: "HK", bankCode: "001", branchCode: "002", accountNumber: ACCOUNT };
  const token = crypto.issueConfirmationToken({ actorId: 3, customerId: 7, input, expiresAt: 301_000 });
  for (const override of [{ actorId: 4 }, { customerId: 8 }]) {
    await assert.rejects(
      () => service.create({ ...actor, ...override, ...details, accountNumber: ACCOUNT, reason: "確認跨客戶共用帳戶", confirmCrossCustomerDuplicate: true, warningToken: token }),
      (error) => error.publicCode === "BANK_CROSS_CUSTOMER_CONFIRMATION_REQUIRED"
    );
  }
});

test("Customer bank mutations hide cross-owner rows and re-check fresh permissions", async () => {
  const missing = harness({ row: null });
  await assert.rejects(
    () => missing.service.deactivate({ ...actor, customerId: 7, bankAccountId: 41, version: 1, reason: "停用錯誤 owner 帳戶" }),
    (error) => error.statusCode === 404
  );
  const revoked = harness({ permissions: ["customer.view"] });
  await assert.rejects(
    () => revoked.service.create({ ...actor, ...details, customerId: 7, accountNumber: ACCOUNT, reason: "撤權後不可新增帳戶" }),
    (error) => error.statusCode === 403
  );
});

test("Customer bank update translates a raced same-owner duplicate to the stable public conflict", async () => {
  const mysqlError = Object.assign(new Error("Duplicate entry"), {
    code: "ER_DUP_ENTRY", errno: 1062,
    sqlMessage: "Duplicate entry for key 'customer_bank_accounts.uq_customer_bank_same_owner'"
  });
  const { service } = harness({ executeError: mysqlError });
  await assert.rejects(
    () => service.update({
      ...actor, ...details, customerId: 7, bankAccountId: 41, accountNumber: "987654321",
      version: 1, reason: "更換銀行帳號並測試唯一約束"
    }),
    (error) => error.publicCode === "BANK_ACCOUNT_DUPLICATE" && error.statusCode === 409
  );
});

test("Customer bank create rejects an inactive account currency through Business Master", async () => {
  const businessMaster = { async assertCurrencyUsableInTransaction() { throw Object.assign(new Error("inactive"), { code: "CURRENCY_NOT_ACTIVE" }); } };
  const { service, events } = harness({ businessMaster });
  await assert.rejects(
    () => service.create({ ...actor, ...details, customerId: 7, accountNumber: ACCOUNT, reason: "驗證銀行帳戶貨幣仍然有效" }),
    (error) => error.publicCode === "BANK_ACCOUNT_INVALID" && error.publicDetails?.field === "accountCurrencyCode"
  );
  assert.equal(events.some(([kind, sql]) => kind === "execute" && sql.includes("INSERT INTO customer_bank_accounts")), false);
});

test("Customer bank reveal commits its audit before returning plaintext", async () => {
  const crypto = realCrypto();
  const sealed = crypto.encrypt({ customerId: 7, cryptoContext: "ctx-41", accountNumber: ACCOUNT });
  const { service, events, audited } = harness({ sealedRow: {
    ...bankRow(), account_ciphertext: sealed.ciphertext, account_iv: sealed.iv,
    account_auth_tag: sealed.authTag, encryption_key_id: sealed.encryptionKeyId
  } });
  service.crypto = crypto;
  const result = await service.reveal({ ...actor, customerId: 7, bankAccountId: 41, reason: "查看完整銀行帳號" });
  assert.equal(result.accountNumber, "123456789001");
  assert.equal(result.expiresInSeconds, 30);
  assert.equal(audited[0].action, "bank.reveal");
  assert.ok(events.findIndex(([kind]) => kind === "audit") < events.findIndex(([kind]) => kind === "commit"));
});
