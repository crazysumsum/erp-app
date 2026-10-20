import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { ADMIN_CONFIG, runRunner, scratchDatabase } from "./supplierScratchDatabase.js";

/**
 * TASK-051 step 2b：MIG-003（DB 競態防護），真 MySQL、兩條獨立連線。
 *
 * 做法：兩條連線各開一個交易。第一條先寫入（佔住 unique slot 嘅 lock），第二條寫入衝突資料，要等住；
 * 等咗 500 ms 仲未完就證明兩者真係重疊。第一條 commit 之後，第二條一定 ER_DUP_ENTRY；第一條 rollback
 * 嘅對照，第二條就成功。所以結果唔係睇邊個快，係 constraint 決定：任何時候都只得一個合法結果。
 * 用一個 runner migrate 好嘅 scratch database，唔郁 DB_NAME。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const cleanups = [];
const db = { name: null, connection: null };
const now = Date.now();

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  Object.assign(db, await scratchDatabase({ after: (fn) => cleanups.push(fn) }));
  await runRunner(db.name);
});

after(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const connect = () => mysql.createConnection({ ...ADMIN_CONFIG(), database: db.name });
const duplicateOf = (key) => (error) => error?.code === "ER_DUP_ENTRY" && error.message.includes(key);

async function supplier(code) {
  const [row] = await db.connection.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', 'draft', ?, ?)`, [code, code.toLowerCase(), code, code.toLowerCase(), now, now]);
  return Number(row.insertId);
}

/**
 * `holder` 喺第一條連線寫入；`waiter` 喺第二條寫衝突資料。回傳 waiter 有冇被擋住、佢嘅結果。
 * `holderEnds` 係 "commit" 或者 "rollback"。
 */
async function race(holder, waiter, holderEnds) {
  const [first, second] = [await connect(), await connect()];
  try {
    await first.beginTransaction();
    await second.beginTransaction();
    await holder(first);
    let settled = false;
    const outcome = waiter(second).then(() => ({ ok: true }), (error) => ({ ok: false, error })).finally(() => { settled = true; });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    const blocked = !settled;
    await first[holderEnds]();
    const result = await outcome;
    await (result.ok ? second.commit() : second.rollback());
    return { blocked, ...result };
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
}

/**
 * 每個 constraint 跑兩次：holder commit（waiter 一定失敗）同 holder rollback（waiter 成功）。兩次之後都只得一個贏家。
 * `reset` 喺兩次之間清走贏家，令第二次由同一個起點開始。
 */
async function proveConstraint({ key, holder, waiter, winners, reset }) {
  const committed = await race(holder, waiter, "commit");
  assert.equal(committed.blocked, true, `${key}: the second transaction waited for the first, so they overlapped`);
  assert.equal(committed.ok, false, `${key}: the second transaction must fail once the first commits`);
  assert.ok(duplicateOf(key)(committed.error), `${key}: ${committed.error?.code} ${committed.error?.message}`);
  assert.deepEqual(await winners(), 1, `${key}: one legal result after the first commits`);

  await reset();
  assert.deepEqual(await winners(), 0, `${key}: reset`);
  const rolledBack = await race(holder, waiter, "rollback");
  assert.equal(rolledBack.blocked, true, `${key}: control overlapped too`);
  assert.equal(rolledBack.ok, true, `${key}: control: once the first rolls back, the second succeeds (${rolledBack.error?.message})`);
  assert.deepEqual(await winners(), 1, `${key}: control: still exactly one`);
}

const count = async (sql, params) => Number((await db.connection.query(sql, params))[0][0].n);

integrationTest("TC-003 (MIG-003, BR-001, BR-004): two transactions creating the same Supplier Code: the database lets exactly one through", async () => {
  const insert = (name) => (connection) => connection.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES ('RACE-CODE', 'race-code', ?, ?, '', 'HKD', '', '', '', '', 'draft', ?, ?)`, [name, name.toLowerCase(), now, now]);
  await proveConstraint({ key: "uq_suppliers_code_key", holder: insert("First"), waiter: insert("Second"),
    winners: () => count("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = 'race-code'"),
    reset: () => db.connection.query("DELETE FROM suppliers WHERE supplier_code_key = 'race-code'") });
});

integrationTest("TC-003 (MIG-003, BR-001, BR-010): two Suppliers taking the same identifier at once: exactly one keeps it", async () => {
  const [left, right] = [await supplier("RACE-ID-1"), await supplier("RACE-ID-2")];
  const insert = (supplierId) => (connection) => connection.query(
    `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
     VALUES (?, 'business_registration', 'HK', 'RACE 123', 'race123', ?, ?)`, [supplierId, now, now]);
  await proveConstraint({ key: "uq_supplier_identifier_value", holder: insert(left), waiter: insert(right),
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_identifiers WHERE identifier_value_key = 'race123'"),
    reset: () => db.connection.query("DELETE FROM supplier_identifiers WHERE identifier_value_key = 'race123'") });
});

for (const [kind, plural, parent, purposes, key] of [
  ["address", "addresses", "supplier_addresses", "supplier_address_purposes", "uq_supplier_address_primary"],
  ["contact", "contacts", "supplier_contacts", "supplier_contact_purposes", "uq_supplier_contact_primary"]
]) {
  integrationTest(`TC-003 (MIG-003): two ${plural} made primary for the same purpose at once: exactly one is primary`, async () => {
    const supplierId = await supplier(`RACE-${kind.toUpperCase()}`);
    const ids = [];
    for (let index = 0; index < 2; index += 1) {
      const [row] = kind === "address"
        ? await db.connection.query(`INSERT INTO ${parent} (supplier_id, created_at, updated_at) VALUES (?, ?, ?)`, [supplierId, now, now])
        : await db.connection.query(`INSERT INTO ${parent} (supplier_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
          [supplierId, `Contact ${index}`, now, now]);
      ids.push(Number(row.insertId));
      await db.connection.query(
        `INSERT INTO ${purposes} (${kind}_id, supplier_id, purpose_code, is_primary, created_at, updated_at) VALUES (?, ?, 'billing', 0, ?, ?)`,
        [row.insertId, supplierId, now, now]);
    }
    const makePrimary = (id) => (connection) => connection.query(
      `UPDATE ${purposes} SET is_primary = 1 WHERE ${kind}_id = ? AND purpose_code = 'billing'`, [id]);
    await proveConstraint({ key, holder: makePrimary(ids[0]), waiter: makePrimary(ids[1]),
      winners: () => count(`SELECT COUNT(*) AS n FROM ${purposes} WHERE supplier_id = ? AND purpose_code = 'billing' AND is_primary = 1`, [supplierId]),
      reset: () => db.connection.query(`UPDATE ${purposes} SET is_primary = 0 WHERE supplier_id = ?`, [supplierId]) });
  });
}

integrationTest("TC-003 (MIG-003, BR-019): two Bank accounts made default at once: exactly one active default", async () => {
  const supplierId = await supplier("RACE-BANK");
  const ids = [];
  for (let index = 0; index < 2; index += 1) {
    const [row] = await db.connection.query(
      `INSERT INTO supplier_bank_accounts (supplier_id, crypto_context, account_holder_name, bank_name, account_ciphertext, account_iv,
         account_auth_tag, encryption_key_id, account_blind_index, blind_index_key_id, last_four, account_length, is_default, status,
         created_at, updated_at)
       VALUES (?, ?, 'Race Holder', 'Race Bank', ?, ?, ?, 'enc-1', ?, 'look-1', '000${index}', 12, 0, 'active', ?, ?)`,
      [supplierId, randomUUID(), randomBytes(28), randomBytes(12), randomBytes(16), randomBytes(32), now, now]);
    ids.push(Number(row.insertId));
  }
  const makeDefault = (id) => (connection) => connection.query("UPDATE supplier_bank_accounts SET is_default = 1 WHERE id = ?", [id]);
  await proveConstraint({ key: "uq_supplier_bank_default", holder: makeDefault(ids[0]), waiter: makeDefault(ids[1]),
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE supplier_id = ? AND is_default = 1 AND status = 'active'", [supplierId]),
    reset: () => db.connection.query("UPDATE supplier_bank_accounts SET is_default = 0 WHERE supplier_id = ?", [supplierId]) });
});

integrationTest("TC-003 (MIG-003): two activation requests for one Supplier at once: exactly one is pending", async () => {
  const supplierId = await supplier("RACE-APPROVAL");
  const request = (connection) => connection.query(
    "INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, status, requested_at) VALUES (?, 1, '{}', 'pending', ?)",
    [supplierId, now]);
  await proveConstraint({ key: "uq_supplier_activation_pending", holder: request, waiter: request,
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_activation_requests WHERE supplier_id = ? AND status = 'pending'", [supplierId]),
    reset: () => db.connection.query("DELETE FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]) });
});

integrationTest("PR #244: the shared lock a Supplier create takes on its Currency and Payment Term still makes a Business Master status change wait, and two creates no longer wait for each other", async () => {
  const [term] = await db.connection.query(
    `INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
     VALUES ('RACE30', 'race30', 'Race 30', 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?)`, [now, now]);
  const repository = new BusinessMasterRepository();
  // Supplier create 經 Business Master provider 喺自己個交易入面驗證（supplierApproval 釘住佢用 LOCK IN SHARE MODE）。
  const provider = new BusinessMasterProvider({ database: db.connection, repository });
  const create = async (connection) => {
    await provider.assertCurrencyUsableInTransaction(connection, { code: "HKD" });
    await provider.assertPaymentTermUsableInTransaction(connection, { id: Number(term.insertId) });
  };
  // Business Master 改狀態（BusinessMasterAdminService）先用 forUpdate 讀。
  for (const [label, statusChange] of [
    ["Currency", (connection) => repository.getCurrency(connection, "HKD", { forUpdate: true })],
    ["Payment Term", (connection) => repository.getPaymentTerm(connection, Number(term.insertId), { forUpdate: true })]
  ]) {
    const waited = await race(create, statusChange, "commit");
    assert.deepEqual([waited.blocked, waited.ok], [true, true], `${label}: the status change waits until the create commits`);
  }
  const parallel = await race(create, create, "commit");
  assert.deepEqual([parallel.blocked, parallel.ok], [false, true], "two creates with the same Currency and Payment Term do not wait for each other");
});
