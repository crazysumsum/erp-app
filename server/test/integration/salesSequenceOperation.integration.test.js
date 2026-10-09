import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { up as sequenceUp } from "../../database/migrations/0068_create_sales_document_sequences.js";
import { up as operationUp } from "../../database/migrations/0069_create_sales_operation_requests.js";
import { up as quotationUp } from "../../database/migrations/0070_create_sales_quotations.js";
import { up as auditUp } from "../../database/migrations/0076_create_sales_audit_logs.js";
import { SalesSequenceService } from "../../src/modules/sales/SalesSequenceService.js";
import { SalesOperationService } from "../../src/modules/sales/SalesOperationService.js";
import { SalesAuditService } from "../../src/modules/sales/SalesAuditService.js";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const f = await migrationFixture(t, ["sales_document_sequences", "sales_operation_requests", "sales_audit_logs", "sales_quotations"]);
  await sequenceUp(f.scoped); await operationUp(f.scoped); await auditUp(f.scoped); await quotationUp(f.scoped);
  const source = defaultConfigurationSource();
  const app = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  t.after(() => app.shutdown("sales_sequence_operation_complete"));
  const database = app.services.require("mysqldatabase"), time = app.services.require("time");
  const sequence = new SalesSequenceService({ time }), operations = new SalesOperationService(), audit = new SalesAuditService();
  const scope = tx => Object.fromEntries(["query", "execute"].map(method => [method, (sql, args = []) => {
    for (const [name, mapped] of Object.entries(f.names)) sql = sql.replace(new RegExp(`\\b${name}\\b`, "gu"), mapped);
    return tx[method](sql, args);
  }]));
  const run = work => operations.run(database, tx => work(scope(tx)));
  const username = `sales-p1-${randomUUID().slice(0, 8)}`;
  const userId = await f.insert("users", { username, password_hash: "test-only", display_name: "Sales native probe", created_at: f.now, updated_at: f.now });
  return { ...f, sequence, operations, audit, database, scope, run, actor: { id: userId, username } };
}
async function insertQuotation(tx, f, number) {
  const [row] = await tx.execute(`INSERT INTO sales_quotations
    (quotation_number,status,customer_id,customer_code_snapshot,customer_name_snapshot,currency_code,
      quotation_date,valid_until,line_count,total_amount,created_at,updated_at,last_business_updated_at)
    VALUES (?, 'DRAFT', ?, 'Synthetic', 'Synthetic', ?, '2026-10-01', '2026-10-31', 1, '0.0000', ?, ?, ?)`,
  [number, f.customerId, f.currency, f.now, f.now, f.now]);
  return { id: Number(row.insertId), number, status: "DRAFT", version: 1 };
}

integrationTest("TC-013 Sales sequence service serializes 100 parallel document creates and respects HKT boundaries", async t => {
  const f = await setup(t);
  const nowMs = Date.parse("2026-09-30T16:00:00Z");
  const rows = await Promise.all(Array.from({ length: 100 }, () => f.run(async tx => {
    const number = await f.sequence.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs });
    return insertQuotation(tx, f, number);
  })));
  assert.equal(new Set(rows.map(row => row.number)).size, 100);
  assert.equal(rows.map(row => row.number).toSorted()[99], "QT-202610-000100");
  assert.equal(await f.run(tx => f.sequence.nextNumberInTransaction(tx, { documentType: "SALES_ORDER", nowMs: nowMs - 1 })), "SO-202609-000001");
  assert.equal(await f.run(tx => f.sequence.nextNumberInTransaction(tx, { documentType: "SALES_ORDER", nowMs })), "SO-202610-000001");
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_quotations}`))[0][0].n, 100);
});

integrationTest("TC-013 Sales sequence rolls back allocations and fails closed after the last six-digit number", async t => {
  const f = await setup(t), allocation = tx => f.sequence.nextNumberInTransaction(tx, { documentType: "SALES_ORDER", nowMs: f.now });
  await assert.rejects(() => f.run(async tx => { await allocation(tx); throw new Error("probe rollback"); }), error => error.cause?.message === "probe rollback");
  const number = await f.run(allocation);
  assert.ok(number.endsWith("000001"));
  await f.db.execute(`UPDATE ${f.names.sales_document_sequences} SET next_value = 999999`);
  assert.ok((await f.run(allocation)).endsWith("999999"));
  await assert.rejects(() => f.run(allocation), { code: "SALES_SEQUENCE_EXHAUSTED" });
  assert.equal((await f.db.query(`SELECT next_value FROM ${f.names.sales_document_sequences}`))[0][0].next_value, 1000000);
});

integrationTest("Sales operation service races one event, replays one durable result and rejects changed intent/owner", async t => {
  const f = await setup(t);
  const request = { eventId: randomUUID(), commandType: "CREATE_QUOTATION", payload: { customerId: f.customerId }, actor: f.actor, nowMs: f.now };
  const execute = () => f.run(async tx => {
    const claim = await f.operations.claim(tx, request);
    if (claim.replay) return claim.replay;
    const number = await f.sequence.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs: f.now });
    const result = await insertQuotation(tx, f, number);
    await f.operations.succeed(tx, { operationId: claim.operationId, result, nowMs: f.now });
    return result;
  });
  const results = await Promise.all([execute(), execute()]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_quotations}`))[0][0].n, 1);
  await assert.rejects(() => f.run(tx => f.operations.claim(tx, { ...request, payload: { customerId: f.customerId + 1 } })), { code: "SALES_EVENT_CONFLICT" });
  assert.equal(await f.run(tx => f.operations.getForActor(tx, { eventId: request.eventId, actor: { ...f.actor, id: f.actor.id + 1 } })), null);
  assert.deepEqual((await f.run(tx => f.operations.getForActor(tx, request))).result, results[0]);
});

integrationTest("Sales unknown commit outcome is resolved by original event without repeating its effects", async t => {
  const f = await setup(t), eventId = randomUUID();
  const request = { eventId, commandType: "CREATE_QUOTATION", payload: { customerId: f.customerId }, actor: f.actor, nowMs: f.now };
  const work = async tx => {
    const claim = await f.operations.claim(tx, request);
    if (claim.replay) return claim.replay;
    const result = await insertQuotation(tx, f, await f.sequence.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs: f.now }));
    await f.operations.succeed(tx, { operationId: claim.operationId, result, nowMs: f.now });
    return result;
  };
  const ackLost = { async withTransaction(callback) {
    await f.database.withTransaction(tx => callback(f.scope(tx)));
    // Real COMMIT precedes a synthetic lost acknowledgment; this is not a mocked database effect.
    throw Object.assign(new Error("probe lost commit acknowledgment"), { code: "DATABASE_TRANSACTION_INDETERMINATE" });
  } };
  await assert.rejects(() => f.operations.run(ackLost, work), { code: "TRANSACTION_OUTCOME_UNKNOWN" });
  const fact = await f.run(tx => f.operations.getForActor(tx, request));
  assert.equal(fact.status, "SUCCEEDED");
  assert.deepEqual(await f.run(work), fact.result);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_quotations}`))[0][0].n, 1);
});

integrationTest("Sales required Audit failure rolls back document, operation and sequence together", async t => {
  const f = await setup(t), request = { eventId: randomUUID(), commandType: "CREATE_QUOTATION", payload: { customerId: f.customerId }, actor: f.actor, nowMs: f.now };
  await f.ddl.query(`CREATE TRIGGER ${f.names.sales_audit_logs}_fail BEFORE INSERT ON ${f.names.sales_audit_logs}
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Required audit probe failure'`);
  await assert.rejects(() => f.run(async tx => {
    const claim = await f.operations.claim(tx, request);
    const result = await insertQuotation(tx, f, await f.sequence.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs: f.now }));
    await f.audit.record(tx, { ...request, action: "sales_quotation.created", targetId: result.id, targetNumber: result.number,
      details: { version: 1, lineCount: 1, totalAmount: "0.0000", currencyCode: f.currency } });
    await f.operations.succeed(tx, { operationId: claim.operationId, result, nowMs: f.now });
  }), error => error.cause?.code === "ER_SIGNAL_EXCEPTION");
  for (const table of Object.values(f.names)) assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n, 0);
});
