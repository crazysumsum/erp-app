import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterAdminService } from "../../src/modules/businessMaster/BusinessMasterAdminService.js";
import { BusinessMasterImpactRegistry } from "../../src/modules/businessMaster/BusinessMasterImpactRegistry.js";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierAdminService } from "../../src/modules/supplier/SupplierAdminService.js";
import { SupplierBusinessMasterImpactChecker } from "../../src/modules/supplier/SupplierBusinessMasterImpactChecker.js";
import { getActivationPolicy } from "../../src/modules/supplier/SupplierSettingsService.js";
import { ADMIN_CONFIG, runRunner, scratchDatabase } from "./supplierScratchDatabase.js";

/**
 * TASK-051 step 2b：MIG-003（DB 競態防護），真 MySQL、兩條獨立連線。
 *
 * 做法一（強制重疊）：兩條連線各開一個交易。第一條先寫入，佔住 unique slot；第二條寫衝突資料，要等。
 * 由 performance_schema 睇到第二條係等緊**嗰個 unique index**，先算重疊。第一條 commit，第二條一定
 * ER_DUP_ENTRY；第一條 rollback 嘅對照，第二條就成功。
 * 做法二（同時開始）：兩條同時寫同時 commit，重複好多次：每次都只得一個贏家；輸家係 ER_DUP_ENTRY，
 * 或者偶然係 ER_LOCK_DEADLOCK（InnoDB 揀一個 rollback），兩樣都唔會有第二個贏家（REV-103 M-2）。
 * 用一個 runner migrate 好嘅 scratch database，唔郁 DB_NAME。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const cleanups = [];
const db = { name: null, connection: null };
const now = Date.now();
const SIMULTANEOUS_ROUNDS = 25;

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  Object.assign(db, await scratchDatabase({ after: (fn) => cleanups.push(fn) }));
  await runRunner(db.name);
});

after(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/** 測試寫錯（例如 holder 永遠唔完）都只係等 5 秒就失敗，唔係等 server 預設嘅 50 秒（REV-103 L-3）。 */
async function connect() {
  const connection = await mysql.createConnection({ ...ADMIN_CONFIG(), database: db.name });
  await connection.query("SET SESSION innodb_lock_wait_timeout = 5");
  return connection;
}
const duplicateOf = (key) => (error) => error?.code === "ER_DUP_ENTRY" && error.message.includes(key);

/** `connection` 而家等緊邊個 index 嘅 lock（performance_schema）；5 秒內冇等就回 null。 */
async function lockWaitOf(connection) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [rows] = await db.connection.query(
      `SELECT l.OBJECT_NAME AS tableName, l.INDEX_NAME AS indexName, l.LOCK_MODE AS mode
         FROM performance_schema.data_lock_waits w
         JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
         JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
        WHERE t.PROCESSLIST_ID = ?`, [connection.threadId]);
    if (rows.length > 0) return rows[0];
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  return null;
}

async function supplier(code, status = "draft") {
  const [row] = await db.connection.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'HKD', '', '', '', '', ?, ?, ?)`, [code, code.toLowerCase(), code, code.toLowerCase(), status, now, now]);
  return Number(row.insertId);
}

/** holder 先寫；waiter 寫衝突資料，要等住 holder。回傳 waiter 等緊嘅 lock 同佢最後嘅結果。 */
async function race(holder, waiter, holderEnds) {
  const [first, second] = [await connect(), await connect()];
  try {
    await first.beginTransaction();
    await second.beginTransaction();
    await holder(first);
    const outcome = waiter(second).then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const lock = await lockWaitOf(second);
    await first[holderEnds]();
    const result = await outcome;
    await (result.ok ? second.commit() : second.rollback());
    return { lock, ...result };
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
}

/** 兩條連線同時寫、寫完即 commit。回傳每條嘅結果。 */
async function simultaneous(left, right) {
  const [first, second] = [await connect(), await connect()];
  const run = async (connection, work) => {
    try {
      await connection.beginTransaction();
      await work(connection);
      await connection.commit();
      return { ok: true };
    } catch (error) {
      await connection.rollback().catch(() => {});
      return { ok: false, error };
    }
  };
  try {
    return await Promise.all([run(first, left), run(second, right)]);
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
}

const count = async (sql, params) => Number((await db.connection.query(sql, params))[0][0].n);

/**
 * 每個 constraint：強制重疊兩次（holder commit／rollback），再同時開始 SIMULTANEOUS_ROUNDS 次。
 * `reset` 清走贏家，令每次由同一個起點開始。
 */
async function proveConstraint(t, { key, table, holder, waiter, winners, reset }) {
  const committed = await race(holder, waiter, "commit");
  assert.deepEqual([committed.lock?.tableName, committed.lock?.indexName], [table, key],
    `${key}: the second transaction waited on the unique slot itself (${JSON.stringify(committed.lock)})`);
  assert.equal(committed.ok, false, `${key}: the second transaction must fail once the first commits`);
  assert.ok(duplicateOf(key)(committed.error), `${key}: ${committed.error?.code} ${committed.error?.message}`);
  assert.equal(await winners(), 1, `${key}: one legal result after the first commits`);
  t.diagnostic(`${key}: waiter blocked on ${JSON.stringify(committed.lock)}, then ${committed.error.code}`);

  await reset();
  assert.equal(await winners(), 0, `${key}: reset`);
  const rolledBack = await race(holder, waiter, "rollback");
  assert.equal(rolledBack.lock?.indexName, key, `${key}: control overlapped on the same slot`);
  assert.equal(rolledBack.ok, true, `${key}: control: once the first rolls back, the second succeeds (${rolledBack.error?.message})`);
  assert.equal(await winners(), 1, `${key}: control: still exactly one`);

  const losers = { ER_DUP_ENTRY: 0, ER_LOCK_DEADLOCK: 0 };
  for (let round = 0; round < SIMULTANEOUS_ROUNDS; round += 1) {
    await reset();
    const results = await simultaneous(holder, waiter);
    assert.equal(results.filter((result) => result.ok).length, 1, `${key}: round ${round}: exactly one winner`);
    const loser = results.find((result) => !result.ok).error;
    assert.ok(loser.code in losers, `${key}: round ${round}: the loser fails as a duplicate or a deadlock, not ${loser.code}`);
    losers[loser.code] += 1;
    assert.equal(await winners(), 1, `${key}: round ${round}: still exactly one`);
  }
  t.diagnostic(`${key}: ${SIMULTANEOUS_ROUNDS} simultaneous starts, losers ${JSON.stringify(losers)}`);
}

integrationTest("TC-003 (MIG-003, BR-001, BR-004): two transactions creating the same Supplier Code, one of them archived: the database lets exactly one through", async (t) => {
  // BR-004：Code 唔理狀態都唯一，所以 holder 係 archived 都要擋到 waiter 嘅 draft。
  const insert = (name, status) => (connection) => connection.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES ('RACE-CODE', 'race-code', ?, ?, '', 'HKD', '', '', '', '', ?, ?, ?)`, [name, name.toLowerCase(), status, now, now]);
  await proveConstraint(t, { key: "uq_suppliers_code_key", table: "suppliers", holder: insert("First", "archived"), waiter: insert("Second", "draft"),
    winners: () => count("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = 'race-code'"),
    reset: () => db.connection.query("DELETE FROM suppliers WHERE supplier_code_key = 'race-code'") });
});

integrationTest("TC-003 (MIG-003, BR-001, BR-010): two Suppliers taking the same identifier at once: exactly one keeps it", async (t) => {
  const [left, right] = [await supplier("RACE-ID-1"), await supplier("RACE-ID-2")];
  const insert = (supplierId) => (connection) => connection.query(
    `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
     VALUES (?, 'business_registration', 'HK', 'RACE 123', 'race123', ?, ?)`, [supplierId, now, now]);
  await proveConstraint(t, { key: "uq_supplier_identifier_value", table: "supplier_identifiers", holder: insert(left), waiter: insert(right),
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_identifiers WHERE identifier_value_key = 'race123'"),
    reset: () => db.connection.query("DELETE FROM supplier_identifiers WHERE identifier_value_key = 'race123'") });
});

/** 同一個 Supplier 兩個 address／contact 同時設成同一 purpose 嘅 primary。 */
async function provePrimary(t, kind, parent, purposes, key) {
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
  await proveConstraint(t, { key, table: purposes, holder: makePrimary(ids[0]), waiter: makePrimary(ids[1]),
    winners: () => count(`SELECT COUNT(*) AS n FROM ${purposes} WHERE supplier_id = ? AND purpose_code = 'billing' AND is_primary = 1`, [supplierId]),
    reset: () => db.connection.query(`UPDATE ${purposes} SET is_primary = 0 WHERE supplier_id = ?`, [supplierId]) });
}

integrationTest("TC-003 (MIG-003): two addresses made primary for the same purpose at once: exactly one is primary", (t) =>
  provePrimary(t, "address", "supplier_addresses", "supplier_address_purposes", "uq_supplier_address_primary"));

integrationTest("TC-003 (MIG-003): two contacts made primary for the same purpose at once: exactly one is primary", (t) =>
  provePrimary(t, "contact", "supplier_contacts", "supplier_contact_purposes", "uq_supplier_contact_primary"));

integrationTest("TC-003 (MIG-003, BR-019): two Bank accounts made default at once: exactly one active default", async (t) => {
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
  await proveConstraint(t, { key: "uq_supplier_bank_default", table: "supplier_bank_accounts", holder: makeDefault(ids[0]), waiter: makeDefault(ids[1]),
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE supplier_id = ? AND is_default = 1 AND status = 'active'", [supplierId]),
    reset: () => db.connection.query("UPDATE supplier_bank_accounts SET is_default = 0 WHERE supplier_id = ?", [supplierId]) });
});

integrationTest("TC-003 (MIG-003): two activation requests for one Supplier at once: exactly one is pending", async (t) => {
  const supplierId = await supplier("RACE-APPROVAL");
  const request = (connection) => connection.query(
    "INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, status, requested_at) VALUES (?, 1, '{}', 'pending', ?)",
    [supplierId, now]);
  await proveConstraint(t, { key: "uq_supplier_activation_pending", table: "supplier_activation_requests", holder: request, waiter: request,
    winners: () => count("SELECT COUNT(*) AS n FROM supplier_activation_requests WHERE supplier_id = ? AND status = 'pending'", [supplierId]),
    reset: () => db.connection.query("DELETE FROM supplier_activation_requests WHERE supplier_id = ?", [supplierId]) });
});

integrationTest("PR #244: a Business Master deactivation that starts after a Supplier create has validated its Currency or Payment Term waits for the create, then sees the new Supplier and is refused", async () => {
  const [term] = await db.connection.query(
    `INSERT INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
     VALUES ('RACE30', 'race30', 'Race 30', 'NET_DAYS', 30, 'ACTIVE', 1, ?, ?)`, [now, now]);
  const termId = Number(term.insertId);
  await db.connection.query(
    "INSERT INTO currencies (code, name, decimal_places, status, version, created_at, updated_at) VALUES ('RQZ', 'Race Currency', 2, 'ACTIVE', 1, ?, ?)",
    [now, now]);
  const time = { nowMs: () => Date.now() };
  const logger = { warn() {}, info() {}, error() {} };
  const repository = new BusinessMasterRepository();
  const reader = await connect();
  // 真 Supplier impact checker，用自己嘅連線讀（同 production 一樣喺 BM 交易之外）。
  const registry = new BusinessMasterImpactRegistry({ checkers: [new SupplierBusinessMasterImpactChecker({ database: reader })], time });
  // scratch database 冇 users：actor 冇 ID（created_by／updated_by 係 NULL）。
  const actor = { id: null, username: "race", permissions: ["supplier.mgmt", "business_master.mgmt"] };
  /**
   * `pauseBefore`：交易入面第一句符合嘅 SQL 送出之前停低。Supplier create 停喺 INSERT INTO suppliers 之前：
   * 嗰陣佢已經驗完 currency／payment term 仲係 ACTIVE，但 FK 檢查嘅鎖仲未攞，即係只得 provider 嘅鎖喺度保護。
   */
  const transactionOn = (connection, pauseBefore = null) => ({
    query: (sql, params) => reader.query(sql, params),
    async withTransaction(work) {
      await connection.beginTransaction();
      let paused = false;
      const pausing = (method) => async (sql, ...rest) => {
        if (pauseBefore && !paused && pauseBefore.pattern.test(String(sql?.sql ?? sql))) {
          paused = true;
          await pauseBefore.wait();
        }
        return connection[method](sql, ...rest);
      };
      const inside = { query: pausing("query"), execute: pausing("execute") };
      try {
        const result = await work(inside);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  });
  const [creating, deactivating] = [await connect(), await connect()];
  try {
    for (const [label, subject, deactivate] of [
      ["Currency", { entityType: "CURRENCY", entityKey: "RQZ" },
        (admin, input) => admin.changeCurrencyStatus({ ...input, code: "RQZ" }, "INACTIVE")],
      ["Payment Term", { entityType: "PAYMENT_TERM", entityKey: String(termId) },
        (admin, input) => admin.changePaymentTermStatus({ ...input, id: termId }, "INACTIVE")]
    ]) {
      const version = subject.entityType === "CURRENCY"
        ? (await repository.getCurrency(reader, "RQZ")).version : (await repository.getPaymentTerm(reader, termId)).version;
      // 預覽時仲未有 Supplier 用佢。
      const preview = await registry.preview({ actorId: actor.id, ...subject, version, operation: "DEACTIVATE", proposedChange: { status: "INACTIVE" } });
      assert.equal(preview.results[0].openUseCount, 0, `${label}: no Supplier uses it yet`);

      // Supplier create 驗完 currency／payment term，停喺寫 suppliers 之前。
      let reachedInsert;
      const atInsert = new Promise((resolve) => { reachedInsert = resolve; });
      let releaseInsert;
      const insertGate = new Promise((resolve) => { releaseInsert = resolve; });
      const suppliers = new SupplierAdminService({
        database: transactionOn(creating, { pattern: /^\s*INSERT INTO suppliers\b/u, wait: async () => { reachedInsert(); await insertGate; } }),
        logger, time, authorize: async () => actor, approvalRequired: getActivationPolicy,
        businessMaster: new BusinessMasterLookupProvider({ provider: new BusinessMasterProvider({ database: reader, repository }),
          readiness: { async assertReady() { return true; } } })
      });
      const code = `RACE-BM-${label === "Currency" ? "C" : "P"}`;
      const created = suppliers.createSupplier({ actorId: actor.id, claimedRoles: [], claimedPermissions: actor.permissions,
        supplierCode: code, supplierName: `Race ${label}`, defaultCurrencyCode: label === "Currency" ? "RQZ" : "HKD",
        defaultPaymentTermId: label === "Payment Term" ? termId : null, requestId: "race", ip: "127.0.0.1" });
      // create 未去到 INSERT 就失敗都要即刻報，唔好一直等。
      await Promise.race([atInsert, created]);

      const admin = new BusinessMasterAdminService({ database: transactionOn(deactivating), repository, audit: { async record() {} },
        impactRegistry: registry, authorize: async () => actor, time, logger });
      const attempt = deactivate(admin, { actorId: actor.id, claimedRoles: [], claimedPermissions: actor.permissions, version,
        reason: "race test", impactToken: preview.impactToken }).then(() => ({ ok: true }), (error) => ({ ok: false, error }));
      const lock = await lockWaitOf(deactivating);
      assert.deepEqual([lock?.tableName, lock?.indexName], [label === "Currency" ? "currencies" : "payment_terms", "PRIMARY"],
        `${label}: the deactivation waits on the row the create has validated (${JSON.stringify(lock)})`);
      releaseInsert();
      await created;
      const outcome = await attempt;
      assert.equal(outcome.ok, false, `${label}: the deactivation must not go through once the create has committed`);
      assert.equal(outcome.error?.code ?? outcome.error?.publicCode, "IMPACT_CHANGED", `${label}: ${outcome.error?.message}`);
      const status = label === "Currency"
        ? (await repository.getCurrency(reader, "RQZ")).status : (await repository.getPaymentTerm(reader, termId)).status;
      assert.equal(status, "ACTIVE", `${label}: still active`);
      const [[row]] = await reader.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = ?", [code.toLowerCase()]);
      assert.equal(Number(row.n), 1, `${label}: the Supplier was created`);
    }
  } finally {
    await Promise.all([creating.end(), deactivating.end(), reader.end()]);
  }
});
