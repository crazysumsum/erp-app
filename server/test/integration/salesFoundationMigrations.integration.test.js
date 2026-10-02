import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { up as sequenceUp, inspectSalesSequenceSchema } from "../../database/migrations/0068_create_sales_document_sequences.js";
import { up as operationUp, inspectSalesOperationSchema } from "../../database/migrations/0069_create_sales_operation_requests.js";
import { salesPayloadHash } from "../../src/modules/sales/salesCanonicalHash.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = app.services.require("mysqldatabase");
  const suffix = randomUUID().replaceAll("-", "");
  const sequence = `sales_sequence_test_${suffix}`, operation = `sales_operation_test_${suffix}`;
  const cleanups = [];
  t.after(async () => {
    try { for (const cleanup of cleanups) await cleanup(); await db.query(`DROP TABLE IF EXISTS ${operation}`); await db.query(`DROP TABLE IF EXISTS ${sequence}`); }
    finally { await app.shutdown("sales_foundation_migrations_complete"); }
  });
  // Nonce fixture tables only. Production names are never dropped, altered or truncated.
  const scoped = (base, probe) => ({ async query(sql, params = []) {
    return db.query(sql.replaceAll(base, probe).replaceAll("fk_sales_operation_actor", `fk_sales_probe_${suffix}`), params.map(value => value === base ? probe : value));
  } });
  return { app, db, sequence, operation, cleanups,
    sequenceConnection: scoped("sales_document_sequences", sequence), operationConnection: scoped("sales_operation_requests", operation) };
}

integrationTest("TC-002 Sales foundations create from empty, preserve upgrade data on rerun and reject schema drift", async t => {
  const f = await setup(t);
  assert.equal(await inspectSalesSequenceSchema(f.db), true);
  assert.equal(await inspectSalesOperationSchema(f.db), true);
  await sequenceUp(f.sequenceConnection); await operationUp(f.operationConnection);
  await f.db.execute(`INSERT INTO ${f.sequence} (document_type, period_key, next_value, updated_at) VALUES ('SALES_ORDER', '202610', 7, 1)`);
  const event = randomUUID();
  await f.db.execute(`INSERT INTO ${f.operation} (event_id, command_type, target_type, request_hash, status, actor_label, created_at, updated_at)
    VALUES (?, 'CONFIRM_ORDER', 'SALES_ORDER', ?, 'IN_PROGRESS', 'Sales test', 1, 1)`, [event, "a".repeat(64)]);
  await sequenceUp(f.sequenceConnection); await operationUp(f.operationConnection);
  assert.equal(Number((await f.db.query(`SELECT next_value FROM ${f.sequence}`))[0][0].next_value), 7);
  assert.equal((await f.db.query(`SELECT event_id FROM ${f.operation}`))[0][0].event_id, event);
  await assert.rejects(() => f.db.execute(`INSERT INTO ${f.sequence} (document_type, period_key, updated_at) VALUES ('SALES_ORDER', '202610', 1)`), e => e.cause?.code === "ER_DUP_ENTRY" || e.code === "ER_DUP_ENTRY");
  await assert.rejects(() => f.db.execute(`INSERT INTO ${f.operation} (event_id, command_type, target_type, request_hash, status, actor_label, created_at, updated_at)
    VALUES (?, 'CONFIRM_ORDER', 'SALES_ORDER', ?, 'IN_PROGRESS', 'Sales test', 1, 1)`, [event, "b".repeat(64)]), e => e.cause?.code === "ER_DUP_ENTRY" || e.code === "ER_DUP_ENTRY");
  await f.db.query(`ALTER TABLE ${f.sequence} MODIFY next_value BIGINT UNSIGNED NOT NULL DEFAULT 1`);
  await assert.rejects(() => sequenceUp(f.sequenceConnection), /column next_value/u);
  await f.db.query(`ALTER TABLE ${f.operation} DROP INDEX uq_sales_operation_event, ADD UNIQUE KEY uq_sales_operation_event (event_id(8))`);
  await assert.rejects(() => operationUp(f.operationConnection), /index prefix/u);
  await f.db.query(`ALTER TABLE ${f.operation} DROP INDEX uq_sales_operation_event`);
  await assert.rejects(() => operationUp(f.operationConnection), /index uq_sales_operation_event/u);
});

integrationTest("Sales sequence native primitives serialize, roll back and preserve HKT periods/exhausted state", async t => {
  const f = await setup(t); await sequenceUp(f.sequenceConnection);
  const time = f.app.services.require("time");
  const period = ms => time.fileDate(time.at(ms)).slice(0, 7).replace("-", "");
  assert.equal(period(Date.parse("2026-09-30T15:59:59.999Z")), "202609");
  assert.equal(period(Date.parse("2026-09-30T16:00:00.000Z")), "202610");
  // Exercises the approved DB primitive contract, not the later TASK015 product service.
  const allocate = async tx => {
    await tx.execute(`INSERT INTO ${f.sequence} (document_type, period_key, updated_at) VALUES ('SALES_ORDER', '202610', 1) ON DUPLICATE KEY UPDATE id = id`);
    const [[row]] = await tx.query(`SELECT id, next_value FROM ${f.sequence} WHERE document_type = 'SALES_ORDER' AND period_key = '202610' FOR UPDATE`);
    const value = Number(row.next_value);
    if (value > 999999) throw Object.assign(new Error("Sales sequence exhausted"), { code: "SALES_SEQUENCE_EXHAUSTED" });
    await tx.execute(`UPDATE ${f.sequence} SET next_value = next_value + 1, updated_at = 2 WHERE id = ?`, [Number(row.id)]);
    return value;
  };
  const values = await Promise.all(Array.from({ length: 4 }, () => f.db.withTransaction(allocate)));
  assert.deepEqual(values.toSorted((a, b) => a - b), [1, 2, 3, 4]);
  await assert.rejects(() => f.db.withTransaction(async tx => { await allocate(tx); throw new Error("rollback"); }), e => e.cause?.message === "rollback");
  assert.equal(await f.db.withTransaction(allocate), 5);
  await f.db.execute(`UPDATE ${f.sequence} SET next_value = 999999`);
  assert.equal(await f.db.withTransaction(allocate), 999999);
  await assert.rejects(() => f.db.withTransaction(allocate), e => e.code === "SALES_SEQUENCE_EXHAUSTED" || e.cause?.code === "SALES_SEQUENCE_EXHAUSTED");
  assert.equal(Number((await f.db.query(`SELECT next_value FROM ${f.sequence}`))[0][0].next_value), 1000000);
});

integrationTest("Sales operation native event identity and actor SET NULL retain safe result/lease evidence", async t => {
  const f = await setup(t); await operationUp(f.operationConnection);
  const now = Date.now(), event = randomUUID();
  const [user] = await f.db.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, 'test-only', 'Sales foundation test', ?, ?)", [`sales-foundation-${event.slice(0, 8)}`, now, now]);
  const userId = Number(user.insertId);
  f.cleanups.push(() => f.db.execute("DELETE FROM users WHERE id = ?", [userId]));
  const hash = salesPayloadHash({ quantity: 1, skuId: 12 });
  await f.db.execute(`INSERT INTO ${f.operation} (event_id, command_type, target_type, request_hash, recovery_payload, status,
    result_type, result_summary, lease_owner, lease_until, actor_user_id, actor_label, created_at, updated_at)
    VALUES (?, 'CONFIRM_ORDER', 'SALES_ORDER', ?, ?, 'SUCCEEDED', 'SALES_ORDER', ?, ?, ?, ?, 'Sales test', ?, ?)`,
  [event, hash, JSON.stringify({ targetId: 42, expectedVersion: 1 }), JSON.stringify({ id: 42, status: "CONFIRMED" }), randomUUID(), now + 1000, userId, now, now]);
  await f.db.execute("DELETE FROM users WHERE id = ?", [userId]);
  const [[row]] = await f.db.query(`SELECT * FROM ${f.operation} WHERE event_id = ?`, [event]);
  assert.equal(row.actor_user_id, null); assert.equal(row.actor_label, "Sales test"); assert.equal(row.request_hash, hash);
  assert.equal(row.target_id, null); assert.equal(row.error_code, ""); assert.equal(row.request_id, "");
  assert.deepEqual(typeof row.result_summary === "string" ? JSON.parse(row.result_summary) : row.result_summary, { id: 42, status: "CONFIRMED" });
  assert.ok(row.lease_owner); assert.equal(Number(row.lease_until), now + 1000);
});
