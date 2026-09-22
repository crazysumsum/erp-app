import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { ApplicationError } from "../../src/framework/errors/ApplicationError.js";
import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerBankCrypto } from "../../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankMaintenanceService } from "../../src/modules/customer/CustomerBankMaintenanceService.js";
import { CustomerBankService } from "../../src/modules/customer/CustomerBankService.js";
import { normalizeCustomerConfig } from "../../src/modules/customer/normalizeCustomerConfig.js";
import { MySqlDatabaseOperationError } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const SECRET = `77${randomUUID().replace(/-/gu, "").slice(0, 14).toUpperCase()}`;
const actor = { actorId: null, claimedRoles: [], claimedPermissions: [], requestId: "req-customer-bank", ip: "127.0.0.1" };
const details = {
  accountHolderName: "Example Customer Limited", bankName: "Example Bank", bankCountryCode: "HK",
  bankCode: "001", branchCode: "002", swiftBic: "EXAMPLHH", purposeCode: "general"
};

function dbConfig() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

function buildCrypto() {
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc-1", keyRing: { "enc-1": randomBytes(32).toString("base64") } },
    bankLookup: { activeKeyId: "look-1", keyRing: { "look-1": randomBytes(32).toString("base64") } }
  });
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

function buildRotationCrypto({ encryptionKeys, lookupKeys, activeEncryptionKeyId, activeLookupKeyId }) {
  const config = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: activeEncryptionKeyId, keyRing: encryptionKeys },
    bankLookup: { activeKeyId: activeLookupKeyId, keyRing: lookupKeys }
  });
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

function executor(connection) {
  const run = (method) => async (sql, params) => {
    try { return await connection[method](sql, params); }
    catch (error) { throw new MySqlDatabaseOperationError(`MySQL database ${method} failed`, { cause: error }); }
  };
  return { query: run("query"), execute: run("execute") };
}

function databaseFor(connection) {
  const active = executor(connection);
  return {
    query: active.query,
    async withTransaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(active);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        if (error instanceof ApplicationError) throw error;
        throw new MySqlDatabaseOperationError("MySQL database transaction failed", { code: "DATABASE_TRANSACTION_FAILED", cause: error });
      }
    }
  };
}

function service(connection, bankCrypto) {
  const database = databaseFor(connection);
  return new CustomerBankService({
    database, logger: { warn() {} }, time: { nowMs: () => Date.now() }, crypto: bankCrypto,
    authorize: async () => ({ id: null, username: "integration", permissions: ["customer.view", "customer.bank.view", "customer.bank.mgmt"] }),
    audit: new CustomerAuditLogService()
  });
}

async function seedCustomer(connection) {
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const [result] = await connection.execute(
    "INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [`BANK-${suffix}`, `bank-${suffix}`, `Bank Customer ${suffix}`, `bank customer ${suffix}`, now, now]
  );
  return Number(result.insertId);
}

async function cleanup(connection, customerIds) {
  for (const id of customerIds) {
    await connection.execute("DELETE FROM customer_audit_logs WHERE customer_id = ?", [id]);
    await connection.execute("DELETE FROM customers WHERE id = ?", [id]);
  }
}

integrationTest("Customer bank service stores no plaintext, confirms cross-owner duplicates and audits reveal", async (t) => {
  const connection = await mysql.createConnection(dbConfig());
  const customerIds = [await seedCustomer(connection), await seedCustomer(connection)];
  t.after(async () => { await cleanup(connection, customerIds); await connection.end(); });
  const banks = service(connection, buildCrypto());
  const first = await banks.create({
    ...actor, ...details, customerId: customerIds[0], accountNumber: SECRET,
    isDefault: true, reason: "新增第一個測試銀行帳戶"
  });
  assert.equal((await banks.list({ ...actor, customerId: customerIds[0] })).items[0].accountNumber, undefined);

  let warningToken;
  await assert.rejects(
    () => banks.create({ ...actor, ...details, customerId: customerIds[1], accountNumber: SECRET, reason: "跨客戶重覆帳戶第一次提交" }),
    (error) => {
      warningToken = error.publicDetails?.warningToken;
      return error.publicCode === "BANK_CROSS_CUSTOMER_CONFIRMATION_REQUIRED" && Boolean(warningToken);
    }
  );
  await banks.create({
    ...actor, ...details, customerId: customerIds[1], accountNumber: SECRET,
    reason: "確認跨客戶共用銀行帳戶", confirmCrossCustomerDuplicate: true, warningToken
  });
  const revealed = await banks.reveal({
    ...actor, customerId: customerIds[0], bankAccountId: first.id, reason: "整合測試查看完整帳號"
  });
  assert.equal(revealed.accountNumber, SECRET);

  const [[audit]] = await connection.query(
    "SELECT action, detail FROM customer_audit_logs WHERE customer_id = ? AND action = 'bank.reveal' ORDER BY id DESC LIMIT 1",
    [customerIds[0]]
  );
  assert.equal(audit.action, "bank.reveal");
  const [rows] = await connection.query("SELECT * FROM customer_bank_accounts WHERE customer_id IN (?, ?)", customerIds);
  const serialized = JSON.stringify({ audit, rows }, (_key, value) => Buffer.isBuffer(value) ? value.toString("base64") : value);
  assert.equal(serialized.includes(SECRET), false);
});

integrationTest("Customer bank key rotation and reindex resume idempotently with zero-old proof", async (t) => {
  const connection = await mysql.createConnection(dbConfig());
  const customerIds = [await seedCustomer(connection)];
  t.after(async () => { await cleanup(connection, customerIds); await connection.end(); });
  const encryptionKeys = { "enc-old": randomBytes(32).toString("base64"), "enc-new": randomBytes(32).toString("base64") };
  const lookupKeys = { "look-old": randomBytes(32).toString("base64"), "look-new": randomBytes(32).toString("base64") };
  const oldCrypto = buildRotationCrypto({ encryptionKeys, lookupKeys, activeEncryptionKeyId: "enc-old", activeLookupKeyId: "look-old" });
  const created = await service(connection, oldCrypto).create({
    ...actor, ...details, customerId: customerIds[0], accountNumber: SECRET,
    reason: "建立舊金鑰資料供輪替測試"
  });
  const newCrypto = buildRotationCrypto({ encryptionKeys, lookupKeys, activeEncryptionKeyId: "enc-new", activeLookupKeyId: "look-new" });
  const maintenance = new CustomerBankMaintenanceService({
    database: databaseFor(connection), crypto: newCrypto, time: { nowMs: () => Date.now() }
  });

  assert.deepEqual(await maintenance.rotateEncryptionBatch({ batchSize: 10 }), { processed: 1, lastId: created.id, remaining: 0 });
  assert.deepEqual(await maintenance.reindexBatch({ batchSize: 10 }), { processed: 1, lastId: created.id, remaining: 0 });
  assert.deepEqual(await maintenance.rotateEncryptionBatch({ batchSize: 10 }), { processed: 0, lastId: 0, remaining: 0 });
  assert.deepEqual(await maintenance.reindexBatch({ batchSize: 10 }), { processed: 0, lastId: 0, remaining: 0 });
  const [[row]] = await connection.query(
    "SELECT encryption_key_id, blind_index_key_id FROM customer_bank_accounts WHERE id = ?",
    [created.id]
  );
  assert.deepEqual(row, { encryption_key_id: "enc-new", blind_index_key_id: "look-new" });
  const revealed = await service(connection, newCrypto).reveal({
    ...actor, customerId: customerIds[0], bankAccountId: created.id, reason: "驗證輪替後仍可讀取帳號"
  });
  assert.equal(revealed.accountNumber, SECRET);
});

integrationTest("Customer bank update/default/deactivate enforce ownership and optimistic versions", async (t) => {
  const connection = await mysql.createConnection(dbConfig());
  const customerIds = [await seedCustomer(connection), await seedCustomer(connection)];
  t.after(async () => { await cleanup(connection, customerIds); await connection.end(); });
  const banks = service(connection, buildCrypto());
  const first = await banks.create({
    ...actor, ...details, customerId: customerIds[0], accountNumber: SECRET, reason: "建立第一個帳戶供修改"
  });
  const updated = await banks.update({
    ...actor, ...details, bankName: "Renamed Bank", customerId: customerIds[0],
    bankAccountId: first.id, version: first.version, reason: "修改銀行名稱並保留帳號"
  });
  const promoted = await banks.setDefault({
    ...actor, customerId: customerIds[0], bankAccountId: first.id,
    version: updated.version, reason: "設為唯一預設銀行帳戶"
  });
  await assert.rejects(
    () => banks.deactivate({
      ...actor, customerId: customerIds[1], bankAccountId: first.id,
      version: promoted.version, reason: "錯誤 owner 不得停用帳戶"
    }),
    (error) => error.statusCode === 404
  );
  const inactive = await banks.deactivate({
    ...actor, customerId: customerIds[0], bankAccountId: first.id,
    version: promoted.version, reason: "停用已驗證的銀行帳戶"
  });
  assert.equal(inactive.status, "inactive");
  assert.equal(inactive.isDefault, false);
});
