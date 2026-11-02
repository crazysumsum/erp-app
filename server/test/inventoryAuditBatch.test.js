import assert from "node:assert/strict";
import test from "node:test";

import { InventoryAuditService } from "../src/modules/inventory/InventoryAuditService.js";

// Semantic executor tests only: these do not establish native MySQL behavior.
const NOW_MS = 1_700_000_000_000;
const ROW_WIDTH = 16;
const MAX_STRING_BYTES = 1_048_576;
const SINGLE_SQL = `INSERT INTO inventory_audit_logs
         (occurred_at, actor_user_id, actor_label, action, target_type, target_id,
          target_label, outcome, reason_category, reason_text, before_summary,
          after_summary, operation_request_id, request_id, correlation_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function input(overrides = {}) {
  return {
    actorUserId: 7, actorLabel: "sam", action: "stocktake.post",
    targetType: "stocktake_line", targetId: 44, targetLabel: "ST-44",
    reasonCategory: "", reasonText: "",
    beforeSummary: { status: "READY", version: 1 },
    afterSummary: { status: "POSTED", version: 2 },
    operationRequestId: 91, requestId: "request-1", correlationId: "correlation-1",
    ip: "203.0.113.7", errorCode: "", ...overrides
  };
}

function logger() {
  const entries = [];
  return { entries, async error(event, message, context) { entries.push({ event, message, context }); } };
}

function service(options = {}) {
  return new InventoryAuditService({
    database: { async withTransaction() { assert.fail("batch must use only its caller-owned executor"); } },
    logger: logger(), time: { nowMs: () => NOW_MS }, ...options
  });
}

function stringBytes(params) {
  return params.reduce((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0), 0);
}

function executor(onExecute = () => undefined) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params: [...params] });
      const result = await onExecute(sql, params, calls.length);
      return result === undefined ? [{ affectedRows: params.length / ROW_WIDTH, insertId: 9100 }] : result;
    },
    async beginTransaction() { assert.fail("batch must not begin a transaction"); },
    async commit() { assert.fail("batch must not commit"); },
    async rollback() { assert.fail("batch must not roll back its caller's transaction"); }
  };
}

async function singleRows(inputs, start = NOW_MS) {
  let tick = start;
  const capture = executor();
  const single = service({ time: { nowMs: () => tick++ } });
  for (const value of inputs) {
    assert.equal(await single.recordSucceeded(capture, value), undefined);
  }
  for (const call of capture.calls) assert.equal(call.sql, SINGLE_SQL);
  return capture.calls.map((call) => call.params);
}

function assertBatchCalls(calls, expectedRows) {
  const actualRows = [];
  for (const { sql, params } of calls) {
    assert.equal(params.length % ROW_WIDTH, 0);
    const rowCount = params.length / ROW_WIDTH;
    assert.ok(rowCount >= 1 && rowCount <= 100, "each INSERT has 1..100 rows");
    assert.ok(params.length <= 3200, "bind budget");
    assert.ok(stringBytes(params) <= MAX_STRING_BYTES, "UTF8 string parameter budget");
    assert.equal(sql.split("VALUES")[0].trim(), SINGLE_SQL.split("VALUES")[0].trim());
    const valuesSql = sql.split("VALUES")[1].trim();
    const tuples = Array.from({ length: rowCount }, () => `(${Array(ROW_WIDTH).fill("?").join(", ")})`).join(", ");
    assert.equal(valuesSql.replace(/\s+/gu, " "), tuples, "only parameterized multi-VALUES tuples");
    assert.equal((sql.match(/\?/gu) ?? []).length, params.length);
    for (let index = 0; index < params.length; index += ROW_WIDTH) actualRows.push(params.slice(index, index + ROW_WIDTH));
  }
  assert.deepEqual(actualRows, expectedRows, "every row preserves the single-entry parameters and order");
}

function largeInputs() {
  // 11 bytes of JSON framing + 2727 three-byte characters = exactly 8192.
  const summary = { name: "界".repeat(2727) };
  assert.equal(Buffer.byteLength(JSON.stringify(summary), "utf8"), 8192);
  return Array.from({ length: 100 }, (_, index) => input({
    targetId: index + 1, beforeSummary: summary, afterSummary: summary
  }));
}

async function rejectionOf(run) {
  try { await run(); } catch (error) { return error; }
  assert.fail("expected rejection");
}

test("AB01 batch accepts an empty array as undefined/no SQL and rejects invalid executor, non-array and over-100 inputs", async () => {
  const audit = service();
  const tx = executor();
  assert.equal(await audit.recordSucceededBatch(tx, []), undefined);
  assert.equal(tx.calls.length, 0);
  for (const sparse of [new Array(1), Object.assign(new Array(3), { 0: input(), 2: input() })]) {
    const sparseTx = executor(() => { throw new Error("Sparse input reached SQL"); });
    await assert.rejects(() => audit.recordSucceededBatch(sparseTx, sparse), TypeError);
    assert.equal(sparseTx.calls.length, 0, "every array index must validate before any SQL");
  }
  for (const invalid of [undefined, null, {}, "", 0, new Set(), Array.from({ length: 101 }, () => input())]) {
    await assert.rejects(async () => audit.recordSucceededBatch(tx, invalid), TypeError);
  }
  const hiddenInvalid = [input({ action: "invalid" })];
  hiddenInvalid[Symbol.iterator] = function* () {};
  await assert.rejects(() => audit.recordSucceededBatch(tx, hiddenInvalid), TypeError);
  const empty = [];
  empty[Symbol.iterator] = function* () { yield input(); };
  assert.equal(await audit.recordSucceededBatch(tx, empty), undefined);
  assert.equal(tx.calls.length, 0, "array entries, not an overridden iterator, define the batch");
  for (const invalid of [null, undefined, {}, { execute: 1 }]) {
    await assert.rejects(async () => audit.recordSucceededBatch(invalid, [input()]), /caller-owned transaction connection/u);
  }
  assert.equal(tx.calls.length, 0);
});

test("AB02 one batch row preserves the original literal single SQL and all single parameters including nullable defaults", async () => {
  const inputs = [input(), input({
    actorUserId: null, targetId: undefined, reasonCategory: undefined, reasonText: undefined,
    beforeSummary: undefined, afterSummary: undefined, operationRequestId: null,
    requestId: undefined, correlationId: undefined, ip: undefined
  })];
  for (const value of inputs) {
    const expected = await singleRows([value]);
    const tx = executor();
    assert.equal(await service().recordSucceededBatch(tx, [value]), undefined);
    assert.equal(tx.calls.length, 1);
    assertBatchCalls(tx.calls, expected);
  }
});

test("AB03 100 rows use ordered multi-VALUES binds and independently captured per-row timestamps on the same executor", async () => {
  const inputs = Array.from({ length: 100 }, (_, index) => input({
    targetId: index + 1, targetLabel: `ST-${index + 1}`, actorUserId: index % 2 ? "7" : 7,
    afterSummary: { stocktakeId: 44, movementId: 900 - index, quantity: index, locked: false }
  }));
  const expected = await singleRows(inputs);
  let tick = NOW_MS;
  const tx = executor();
  assert.equal(await service({ time: { nowMs: () => tick++ } }).recordSucceededBatch(tx, inputs), undefined);
  assert.equal(tx.calls.length, 1, "100 small rows fit a single INSERT");
  assertBatchCalls(tx.calls, expected);
  assert.deepEqual(expected.map((row) => row[0]), inputs.map((_, index) => NOW_MS + index));
});

test("AB04 batch shares single field validation and first-error order and validates all inputs before any SQL", async () => {
  const invalidCases = [
    { action: "stocktake.run_sql", actorUserId: 0 },
    { actorUserId: 0, actorLabel: "" }, { actorUserId: Number.MAX_SAFE_INTEGER + 1 },
    { actorLabel: "", targetType: "bad\ntype" }, { actorLabel: "界".repeat(64) },
    { targetType: "movement_組", targetId: 0 }, { targetType: "x".repeat(41) },
    { targetId: -1, targetLabel: "" }, { targetId: "00" },
    { targetLabel: "界".repeat(64), reasonCategory: "bad\ncategory" },
    { reasonCategory: "組", reasonText: "x".repeat(501) },
    { reasonText: "x".repeat(501), beforeSummary: { password: "private" } },
    { beforeSummary: { password: "private" }, afterSummary: { nested: {} } },
    { afterSummary: { status: [] }, operationRequestId: 0 },
    { operationRequestId: 0, requestId: "x".repeat(65) },
    { requestId: "x".repeat(65), correlationId: "bad\ncorrelation" },
    { correlationId: "x".repeat(65), ip: "x".repeat(46) }, { ip: "組" }
  ];
  const precedingRows = largeInputs().slice(0, 80);
  for (const overrides of invalidCases) {
    const value = input(overrides);
    const oracle = executor();
    const expected = await rejectionOf(() => service().recordSucceeded(oracle, value));
    assert.equal(oracle.calls.length, 0);
    const tx = executor();
    const actual = await rejectionOf(() => service().recordSucceededBatch(tx, [...precedingRows, value]));
    assert.equal(actual.constructor, expected.constructor);
    assert.equal(actual.message, expected.message);
    assert.equal(tx.calls.length, 0, "even an invalid row after a full byte-budget chunk prevents every INSERT");
  }
});

test("AB05 batch uses the real scalar whitelist and exact 8192-byte boundary without nested, unknown or secret fields", async () => {
  const valid = input({ beforeSummary: { name: "界".repeat(2727) }, afterSummary: {
    id: 1, stocktakeId: 44, quantity: -1, deviceId: "a".repeat(64), signedRequestAt: NOW_MS,
    stockStatus: "AVAILABLE", locked: true, lotId: null
  } });
  const tx = executor();
  assert.equal(await service().recordSucceededBatch(tx, [valid]), undefined);
  assertBatchCalls(tx.calls, await singleRows([valid]));
  const invalidSummaries = [
    [], "summary", { status: { rawPayload: "hidden" } }, { status: ["READY"] },
    { quantity: Infinity }, { quantity: NaN }, { quantity: 1n },
    { unexpectedField: "hidden" }, { password: "private" }, { access_token: "private" },
    { authorization: "private" }, { requestProof: "private" }, { name: `${"界".repeat(2727)}x` }
  ];
  for (const summary of invalidSummaries) {
    for (const field of ["beforeSummary", "afterSummary"]) {
      const value = input({ [field]: summary });
      const expected = await rejectionOf(() => service().recordSucceeded(executor(), value));
      const rejectedTx = executor();
      const actual = await rejectionOf(() => service().recordSucceededBatch(rejectedTx, [valid, value]));
      assert.equal(actual.constructor, expected.constructor);
      assert.equal(actual.message, expected.message);
      assert.equal(rejectedTx.calls.length, 0);
    }
  }
});

test("AB06 UTF8 summaries force bounded sequential chunks without truncation, reordering or extra timestamp sampling", async () => {
  const inputs = largeInputs();
  const expected = await singleRows(inputs);
  assert.ok(stringBytes(expected.flat()) > MAX_STRING_BYTES);
  assert.ok(expected.flat().reduce((sum, value) => sum + (typeof value === "string" ? value.length : 0), 0) < MAX_STRING_BYTES);
  let tick = NOW_MS;
  let inFlight = false;
  const tx = executor(async (_sql, params) => {
    assert.equal(inFlight, false, "SQL chunks must execute sequentially");
    inFlight = true;
    await Promise.resolve();
    assert.ok(stringBytes(params) <= MAX_STRING_BYTES);
    inFlight = false;
  });
  assert.equal(await service({ time: { nowMs: () => tick++ } }).recordSucceededBatch(tx, inputs), undefined);
  assert.ok(tx.calls.length > 1, "UTF8 bytes require smaller chunks even though character counts fit");
  assert.equal(tick, NOW_MS + inputs.length);
  assertBatchCalls(tx.calls, expected);
});

test("AB07 later SQL failure preserves error identity and every affectedRows mismatch rejects without independent audit or transaction", async () => {
  const inputs = largeInputs();
  const expectedError = Object.assign(new Error("injected second audit INSERT failure"), { code: "ER_LOCK_WAIT_TIMEOUT" });
  const auditLogger = logger();
  const failedTx = executor(async (_sql, _params, callNumber) => {
    if (callNumber === 2) throw expectedError;
  });
  const actualError = await rejectionOf(() => service({ logger: auditLogger }).recordSucceededBatch(failedTx, inputs));
  assert.equal(actualError, expectedError);
  assert.equal(failedTx.calls.length, 2);
  assert.equal(auditLogger.entries.length, 0, "required success audit failures are propagated, not independently recorded");
  for (const affectedRows of [0, 2, undefined]) {
    const tx = executor(async () => [{ affectedRows }]);
    await assert.rejects(async () => service().recordSucceededBatch(tx, [input()]), Error);
    assert.equal(tx.calls.length, 1);
  }
  const shortTx = executor(async (_sql, params, callNumber) => [{
    affectedRows: params.length / ROW_WIDTH - (callNumber === 2 ? 1 : 0)
  }]);
  await assert.rejects(async () => service().recordSucceededBatch(shortTx, inputs), Error);
  assert.equal(shortTx.calls.length, 2, "later short write must stop instead of returning success");
});

test("AB08 adding batch leaves original single, rejected, failed and safe fallback behavior intact", async () => {
  const independent = executor();
  let transactions = 0;
  const auditLogger = logger();
  const audit = service({
    database: { async withTransaction(work) { transactions += 1; return work(independent); } },
    logger: auditLogger
  });
  const caller = executor();
  assert.equal(await audit.recordSucceededBatch(caller, [input()]), undefined);
  assert.equal(transactions, 0);
  assert.equal(await audit.recordSucceeded(caller, input()), undefined);
  assert.equal(caller.calls[1].sql, SINGLE_SQL);
  assert.equal(await audit.recordRejected(input({ errorCode: "VERSION_CONFLICT" })), true);
  assert.equal(await audit.recordFailed(input({ errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE" })), true);
  assert.equal(transactions, 2);
  for (const [index, outcome] of ["REJECTED", "FAILED"].entries()) {
    assert.equal(independent.calls[index].sql, SINGLE_SQL);
    assert.equal(independent.calls[index].params[7], outcome);
    assert.equal(independent.calls[index].params[11], null);
    assert.equal(independent.calls[index].params[12], null);
  }
  const sqlError = new Error("private database details");
  await assert.rejects(() => audit.recordSucceeded(executor(async () => { throw sqlError; }), input()), (error) => error === sqlError);
  const fallback = service({
    database: { async withTransaction() { throw Object.assign(new Error("private-secret"), { code: "ER_LOCK_WAIT_TIMEOUT" }); } },
    logger: auditLogger
  });
  assert.equal(await fallback.recordFailed(input({
    reasonText: "private-secret", targetLabel: "private-label", errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE"
  })), false);
  assert.equal(auditLogger.entries.length, 1);
  assert.equal(auditLogger.entries[0].event, "inventory.audit.write_failed");
  assert.deepEqual(auditLogger.entries[0].context, {
    action: "stocktake.post", targetType: "stocktake_line", targetId: 44, actorUserId: 7,
    requestId: "request-1", correlationId: "correlation-1", outcome: "FAILED",
    errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE", databaseErrorCode: "ER_LOCK_WAIT_TIMEOUT"
  });
  assert.doesNotMatch(JSON.stringify(auditLogger.entries), /private-secret|private-label|private database details/u);
});
