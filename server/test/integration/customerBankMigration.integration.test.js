import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

import { inspectCustomerBankAccountSchema } from "../../database/migrations/0049_create_customer_bank_accounts.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

async function customer(connection) {
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const [result] = await connection.execute(
    `INSERT INTO customers
       (customer_code, customer_code_key, legal_name, legal_name_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`BANK-${suffix}`, `bank-${suffix}`, `Bank Customer ${suffix}`, `bank customer ${suffix}`, now, now]
  );
  return Number(result.insertId);
}

function bankRow(customerId, { blindIndex = randomBytes(32), isDefault = 0, status = "active" } = {}) {
  return [
    customerId, randomUUID(), "Account Holder", "Example Bank", "HK", "001", "002", "EXAMPLEHH",
    "general", randomBytes(24), randomBytes(12), randomBytes(16), "enc-1", blindIndex, "lookup-1",
    "1234", 12, isDefault, status, Date.now(), Date.now()
  ];
}

async function insertBank(connection, row) {
  return connection.execute(
    `INSERT INTO customer_bank_accounts
       (customer_id, crypto_context, account_holder_name, bank_name, bank_country_code,
        bank_code, branch_code, swift_bic, purpose_code, account_ciphertext, account_iv,
        account_auth_tag, encryption_key_id, account_blind_index, blind_index_key_id,
        last_four, account_length, is_default, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

integrationTest("Customer bank migration enforces no-plaintext, duplicate and default contracts", async (t) => {
  const connection = await mysql.createConnection(config());
  const customerIds = [];
  t.after(async () => {
    for (const id of customerIds) await connection.execute("DELETE FROM customers WHERE id = ?", [id]);
    await connection.end();
  });

  assert.equal(await inspectCustomerBankAccountSchema(connection), true);
  const [columns] = await connection.query(
    `SELECT column_name AS column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'customer_bank_accounts'`
  );
  assert.equal(columns.some(({ column_name }) => /account.*number|number.*account/iu.test(column_name)), false);

  const firstCustomer = await customer(connection);
  const secondCustomer = await customer(connection);
  customerIds.push(firstCustomer, secondCustomer);
  const sharedIndex = randomBytes(32);
  await insertBank(connection, bankRow(firstCustomer, { blindIndex: sharedIndex, isDefault: 1 }));

  await assert.rejects(
    () => insertBank(connection, bankRow(firstCustomer, { blindIndex: sharedIndex })),
    (error) => error.code === "ER_DUP_ENTRY"
  );
  await insertBank(connection, bankRow(secondCustomer, { blindIndex: sharedIndex }));
  await assert.rejects(
    () => insertBank(connection, bankRow(firstCustomer, { isDefault: 1 })),
    (error) => error.code === "ER_DUP_ENTRY"
  );
  await insertBank(connection, bankRow(firstCustomer, { isDefault: 1, status: "inactive" }));
});
