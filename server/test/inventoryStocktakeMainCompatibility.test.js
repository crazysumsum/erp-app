import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import { LookupInventorySkuHandler } from "../src/handlers/inventory/skuLookupHandlers.js";
import { InventoryAuditService } from "../src/modules/inventory/InventoryAuditService.js";
import { ItemLookupService } from "../src/modules/item/ItemLookupService.js";
import { MySqlDatabaseService, getActiveTransactionIsolation } from "../src/services/mysqldatabase/MySqlDatabaseService.js";

// Unit fixtures only: real domain/transaction-registry code, no native MySQL or HTTP/auth proof.
const NOW_MS = 1_700_000_000_000;
const ROW_WIDTH = 16;
const MAX_STRING_BYTES = 1_048_576;
const SINGLE_SQL = `INSERT INTO inventory_audit_logs
         (occurred_at, actor_user_id, actor_label, action, target_type, target_id,
          target_label, outcome, reason_category, reason_text, before_summary,
          after_summary, operation_request_id, request_id, correlation_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SCALAR_SQL = SINGLE_SQL.replace("\n       VALUES", " VALUES");

function auditInput(overrides = {}) {
  return { actorUserId: 7, actorLabel: "sam", action: "stocktake.post",
    targetType: "stocktake_line", targetId: 44, targetLabel: "ST-44",
    reasonCategory: "", reasonText: "", beforeSummary: { status: "READY", version: 1 },
    afterSummary: { status: "POSTED", version: 2 }, operationRequestId: 91,
    requestId: "request-1", correlationId: "correlation-1", ip: "203.0.113.7", ...overrides };
}

function auditLogger() {
  const entries = [];
  return { entries, async error(event, message, context) { entries.push({ event, message, context }); } };
}

function auditService(overrides = {}) {
  return new InventoryAuditService({
    database: { async withTransaction() { assert.fail("success audit must retain caller transaction ownership"); } },
    logger: auditLogger(), time: { nowMs: () => NOW_MS }, ...overrides
  });
}

function auditExecutor(onExecute = () => undefined) {
  const calls = [];
  return { calls, async execute(sql, params) {
    calls.push({ sql, params: [...params] });
    return await onExecute(sql, params, calls.length) ?? [{ affectedRows: params.length / ROW_WIDTH }];
  }, async beginTransaction() { assert.fail("Audit must not begin a transaction"); },
  async commit() { assert.fail("Audit must not commit its caller's transaction"); },
  async rollback() { assert.fail("Audit must not roll back its caller's transaction"); } };
}

function transactionFixture() {
  const calls = [], events = [];
  const native = {
    async query(sql) { assert.match(sql, /^SET TRANSACTION ISOLATION LEVEL /u); events.push("isolation"); return [[]]; },
    async execute({ sql }, params) { calls.push({ sql, params: [...params] }); return [{ affectedRows: params.length / ROW_WIDTH }]; },
    async beginTransaction() { events.push("begin"); }, async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); }, release() { events.push("release"); },
    destroy() { events.push("destroy"); }
  };
  let context = {};
  const database = new MySqlDatabaseService({
    pool: { async query() { assert.fail("transaction must retain its acquired connection"); }, async getConnection() { events.push("acquire"); return native; } },
    config: { acquireTimeoutMs: 1000, queryTimeoutMs: 1000, transactionTimeoutMs: 2000 },
    context: { get: () => context, update(values) { context = { ...context, ...values }; } }
  });
  return { database, calls, events };
}

async function scalarRows(inputs) {
  let tick = NOW_MS;
  const executor = auditExecutor();
  const service = auditService({ time: { nowMs: () => tick++ } });
  for (const input of inputs) await service.recordSucceeded(executor, input);
  for (const call of executor.calls) assert.equal(call.sql, SCALAR_SQL);
  return executor.calls.map(call => call.params);
}

function stringBytes(params) {
  return params.reduce((bytes, value) => bytes + (typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0), 0);
}

function assertP4Batch(calls, expectedRows) {
  const rows = [];
  for (const { sql, params } of calls) {
    const count = params.length / ROW_WIDTH;
    assert.ok(Number.isInteger(count) && count >= 1 && count <= 100);
    assert.ok(params.length <= 3200, "original parameter budget");
    assert.ok(stringBytes(params) <= MAX_STRING_BYTES, "original UTF8 string budget");
    assert.equal(sql.split("VALUES")[0].trim(), SINGLE_SQL.split("VALUES")[0].trim());
    assert.equal(sql.split("VALUES")[1].trim().replace(/\s+/gu, " "),
      Array(count).fill(`(${Array(ROW_WIDTH).fill("?").join(", ")})`).join(", "));
    assert.equal((sql.match(/\?/gu) ?? []).length, params.length);
    for (let offset = 0; offset < params.length; offset += ROW_WIDTH) rows.push(params.slice(offset, offset + ROW_WIDTH));
  }
  assert.deepEqual(rows, expectedRows, "scalar values, timestamps, order and original bytes survive batching");
}

function largeAuditInputs() {
  const summary = { name: "界".repeat(2727) };
  assert.equal(Buffer.byteLength(JSON.stringify(summary), "utf8"), 8192);
  return Array.from({ length: 100 }, (_, index) => auditInput({ targetId: index + 1, beforeSummary: summary, afterSummary: summary }));
}

function lookupRequest(query) {
  const req = { params: {}, query, body: undefined, headers: {} };
  new RequestValidator().compile(LookupInventorySkuHandler.api.requestSchema, "compatibility lookup")(req);
  return req;
}

function lookupFixture({ sku = {}, uoms, missing = false, staleSku = {} } = {}) {
  const calls = [], row = { id: 12, sku_code: "SKU-%_", sku_name: "Current SKU", sku_status: "active",
    item_status: "active", item_id: 1, item_name: "Private Item", product_type: "standard", inventory_tracked: 1,
    tracking_policy: "none", purchasable: 0, sellable: 0, suggested_price_amount: "99.0000", ...sku };
  const mappings = uoms ?? [{ id: 20, sku_id: 12, uom_id: 4, uom_code: "EA", is_base: 1, to_base_factor: 1 }];
  const tx = { async query(sql, params) {
    calls.push({ sql, params });
    // Support both historical profile reads and current lookup reads so failures expose product behavior.
    if (sql.includes("s.id AS sku_id")) return [mappings.length
      ? mappings.map(mapping => ({ ...mapping, item_id: 1 }))
      : [{ sku_id: 12, item_id: 1, id: null, uom_id: null }]];
    if (sql.includes("FROM item_uoms")) return [mappings.map(mapping => ({ id: mapping.uom_id, code: mapping.uom_code, name: "Each", status: "active", version: 1 }))];
    if (sql.includes("FROM items")) return [[{ id: 1, name: row.item_name, product_type: row.product_type, status: row.item_status, version: 1 }]];
    if (sql.includes("FROM item_sku_uoms")) return [mappings];
    assert.match(sql, /FROM item_skus/u);
    return [missing ? [] : [{ ...row, ...(sql.includes("FOR SHARE") ? staleSku : {}) }]];
  } };
  const database = { query() { assert.fail("lookup escaped its caller transaction"); }, async withTransaction(work) { return work(tx); } };
  const handler = new LookupInventorySkuHandler({ require(name) {
    if (name === "mysqldatabase") return database;
    if (name === "logging") return { logger: { async error() {} } };
    if (name === "time") return { nowMs: () => NOW_MS };
    throw new Error(name);
  } });
  return { calls, handler, async lookup(query) {
    const result = await handler.execute(lookupRequest(query));
    // The production dispatcher applies this response contract before exposing malformed Item data.
    new ResponseValidator({ environment: "production" }).compile(LookupInventorySkuHandler.api.responseSchema, "compatibility lookup")(200, result.data);
    return result.data;
  } };
}

test("MC01 main scalar Audit preserves validation, exact values and independent rejection/failure paths", async () => {
  const caller = auditExecutor(), independent = auditExecutor(), logger = auditLogger();
  let transactions = 0;
  const service = auditService({ logger, database: { async withTransaction(work) { transactions++; return work(independent); } } });
  assert.equal(await service.recordSucceeded(caller, auditInput()), undefined);
  assert.equal(transactions, 0);
  assert.equal(caller.calls[0].sql, SCALAR_SQL);
  assert.deepEqual(caller.calls[0].params, [NOW_MS, 7, "sam", "stocktake.post", "stocktake_line", 44,
    "ST-44", "SUCCEEDED", "", "", '{"status":"READY","version":1}', '{"status":"POSTED","version":2}',
    91, "request-1", "correlation-1", "203.0.113.7"]);
  await service.recordSucceeded(caller, auditInput({ actorUserId: null, targetId: undefined, beforeSummary: undefined,
    afterSummary: undefined, operationRequestId: null, requestId: undefined, correlationId: undefined, ip: undefined }));
  assert.deepEqual(caller.calls[1].params, [NOW_MS, null, "sam", "stocktake.post", "stocktake_line", null,
    "ST-44", "SUCCEEDED", "", "", null, null, null, "", "", ""]);
  for (const [overrides, message] of [[{ action: "stocktake.run_sql" }, /Unsupported Inventory audit action/u],
    [{ actorUserId: 0 }, /Invalid Inventory audit actor user id/u],
    [{ afterSummary: { password: "private" } }, /Unsupported Inventory audit summary field/u]]) {
    await assert.rejects(service.recordSucceeded(caller, auditInput(overrides)), message);
  }
  assert.equal(caller.calls.length, 2);
  for (const [method, outcome] of [["recordRejected", "REJECTED"], ["recordFailed", "FAILED"]]) {
    assert.equal(await service[method](auditInput()), true);
    const call = independent.calls.at(-1);
    assert.equal(call.sql, SCALAR_SQL); assert.equal(call.params[7], outcome);
    assert.equal(call.params[11], null); assert.equal(call.params[12], null);
  }
  assert.equal(transactions, 2);
  const failure = new Error("scalar SQL failure");
  await assert.rejects(service.recordSucceeded(auditExecutor(() => { throw failure; }), auditInput()), error => error === failure);
  const fallback = auditService({ logger, database: { async withTransaction() { throw Object.assign(new Error("private-secret"), { code: "ER_LOCK_WAIT_TIMEOUT" }); } } });
  assert.equal(await fallback.recordFailed(auditInput({ reasonText: "private-secret", targetLabel: "private-label" })), false);
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].event, "inventory.audit.write_failed");
  assert.equal(logger.entries[0].context.databaseErrorCode, "ER_LOCK_WAIT_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(logger.entries), /private-secret|private-label/u);
});

test("MC02 main createSucceededBatch requires the real active registry and preserves fixed 100-row caller-owned flushes", async () => {
  const service = auditService(), fixture = transactionFixture();
  assert.throws(() => service.createSucceededBatch(auditExecutor()), /actual active transaction/u);
  let batch, transaction;
  await fixture.database.withTransaction(async tx => {
    transaction = tx;
    assert.equal(getActiveTransactionIsolation(tx), "REPEATABLE READ");
    batch = service.createSucceededBatch(tx);
    await batch.flush();
    const inputs = largeAuditInputs();
    const first = { ...inputs[0], afterSummary: { status: "POSTED" } };
    await batch.record(first);
    first.afterSummary.status = "MUTATED";
    for (let index = 1; index < 99; index++) await batch.record(inputs[index]);
    assert.equal(fixture.calls.length, 0, "99 entries remain pending");
    await batch.record(inputs[99]);
    assert.equal(fixture.calls.length, 1, "entry 100 flushes without P4 byte-budget semantics");
    assert.equal(fixture.calls[0].params.length, 100 * ROW_WIDTH);
    assert.ok(stringBytes(fixture.calls[0].params) > MAX_STRING_BYTES, "main keeps its fixed-row flush rather than adopting P4's byte chunks");
    assert.equal(JSON.parse(fixture.calls[0].params[11]).status, "POSTED", "capture precedes later caller mutation");
    await batch.record(auditInput({ targetId: 101 }));
    assert.equal(fixture.calls.length, 1);
    await batch.flush(); await batch.flush();
    assert.equal(fixture.calls.length, 2);
    assert.equal(fixture.calls[1].params.length, ROW_WIDTH);
    assert.equal(fixture.calls[1].params[5], 101);
    assert.deepEqual(fixture.events, ["acquire", "isolation", "begin"], "Audit never commits early");
  });
  assert.deepEqual(fixture.events, ["acquire", "isolation", "begin", "commit", "release"]);
  assert.equal(getActiveTransactionIsolation(transaction), null);
  await assert.rejects(batch.record(auditInput()), /actual active transaction/u);
  await assert.rejects(batch.flush(), /actual active transaction/u);
});

test("MC03 P4 recordSucceededBatch keeps 0/1/100 boundaries, original bytes/parameters and exact affectedRows proof", async () => {
  const empty = auditExecutor();
  assert.equal(await auditService().recordSucceededBatch(empty, []), undefined);
  assert.equal(empty.calls.length, 0);
  for (const inputs of [[auditInput()], Array.from({ length: 100 }, (_, index) => auditInput({ targetId: index + 1 })), largeAuditInputs()]) {
    const expected = await scalarRows(inputs), tx = auditExecutor();
    let tick = NOW_MS;
    assert.equal(await auditService({ time: { nowMs: () => tick++ } }).recordSucceededBatch(tx, inputs), undefined);
    assert.equal(tick, NOW_MS + inputs.length);
    assertP4Batch(tx.calls, expected);
    if (inputs.length === 1) assert.equal(tx.calls[0].sql, SINGLE_SQL);
    assert.equal(tx.calls.length, stringBytes(expected.flat()) > MAX_STRING_BYTES ? 2 : 1);
  }
  for (const invalid of [null, {}, new Array(1), Array.from({ length: 101 }, () => auditInput())]) {
    const tx = auditExecutor();
    await assert.rejects(async () => auditService().recordSucceededBatch(tx, invalid), TypeError);
    assert.equal(tx.calls.length, 0);
  }
  for (const invalid of [null, {}, { execute: 1 }]) {
    await assert.rejects(async () => auditService().recordSucceededBatch(invalid, []), /caller-owned transaction connection/u);
  }
  for (const affectedRows of [0, 2, undefined, "1"]) {
    const tx = auditExecutor(() => [{ affectedRows }]);
    await assert.rejects(async () => auditService().recordSucceededBatch(tx, [auditInput()]), /persist every row/u);
    assert.equal(tx.calls.length, 1);
  }
});

test("MC04 both batch APIs share scalar validation and the 500 Unicode-codepoint reason bound", async () => {
  const validReason = "😀".repeat(250) + "界".repeat(250);
  assert.equal([...validReason].length, 500);
  assert.ok(Buffer.byteLength(validReason, "utf8") > 500);
  const expected = await scalarRows([auditInput({ reasonText: validReason })]);
  const p4 = auditExecutor();
  await auditService().recordSucceededBatch(p4, [auditInput({ reasonText: validReason })]);
  assertP4Batch(p4.calls, expected);
  const fixture = transactionFixture();
  await fixture.database.withTransaction(async tx => {
    const batch = auditService().createSucceededBatch(tx);
    await batch.record(auditInput({ reasonText: validReason })); await batch.flush();
  });
  assert.deepEqual(fixture.calls[0].params, expected[0]);
  for (const overrides of [{ reasonText: validReason + "x" }, { reasonText: "a\u0000b" },
    { reasonText: 5 }, { actorUserId: 0, actorLabel: "" }, { afterSummary: { status: { hidden: "private" } } }]) {
    const input = auditInput(overrides), scalar = auditExecutor();
    let scalarError;
    await assert.rejects(auditService().recordSucceeded(scalar, input), error => { scalarError = error; return error instanceof TypeError; });
    assert.equal(scalar.calls.length, 0);
    const tx = auditExecutor();
    await assert.rejects(async () => auditService().recordSucceededBatch(tx, [...largeAuditInputs().slice(0, 80), input]),
      error => error.constructor === scalarError.constructor && error.message === scalarError.message);
    assert.equal(tx.calls.length, 0, "all P4 inputs validate before any byte-budget chunk is written");
    const active = transactionFixture();
    await active.database.withTransaction(async connection => {
      const batch = auditService().createSucceededBatch(connection);
      await assert.rejects(batch.record(input), error => error.constructor === scalarError.constructor && error.message === scalarError.message);
      await assert.rejects(batch.flush(), /batch has failed/u);
    });
    assert.equal(active.calls.length, 0);
  }
});

test("MC05 later P4 SQL failure propagates unchanged without independent audit, transaction completion or later chunks", async () => {
  const failure = Object.assign(new Error("second audit INSERT failed"), { code: "ER_LOCK_WAIT_TIMEOUT" });
  const logger = auditLogger();
  const tx = auditExecutor((_sql, _params, number) => { if (number === 2) throw failure; });
  await assert.rejects(async () => auditService({ logger }).recordSucceededBatch(tx, largeAuditInputs()), error => error === failure);
  assert.equal(tx.calls.length, 2);
  assert.equal(logger.entries.length, 0, "required audit errors are never converted into independent outcomes");
  const short = auditExecutor((_sql, params, number) => [{ affectedRows: params.length / ROW_WIDTH - (number === 2 ? 1 : 0) }]);
  await assert.rejects(async () => auditService().recordSucceededBatch(short, largeAuditInputs()), /persist every row/u);
  assert.equal(short.calls.length, 2);
});

test("MC06 Code normalization uses one current Item result and one UOM read without a second profile snapshot", async () => {
  const fixture = lookupFixture({ staleSku: { sku_name: "Stale second profile" } });
  const result = await fixture.lookup({ code: "  SKU-%_  " });
  assert.equal(result.skuName, "Current SKU", "return the original current Item result");
  assert.equal(fixture.calls.length, 2, "one Item lookup plus its UOM projection");
  assert.match(fixture.calls[0].sql, /s\.sku_code = \?/u);
  assert.deepEqual(fixture.calls[0].params, ["SKU-%_"]);
  assert.match(fixture.calls[1].sql, /FROM item_sku_uoms/u);
  assert.deepEqual(fixture.calls[1].params, [12]);
  assert.doesNotMatch(fixture.calls[0].sql, /LIKE|item_sku_barcodes/u);
});

test("MC07 Barcode forwards the raw value to Item and preserves 190-codepoint/760-byte/control boundaries", async t => {
  const received = [], original = ItemLookupService.prototype.findByBarcode;
  t.mock.method(ItemLookupService.prototype, "findByBarcode", async function(raw, options) {
    received.push(raw); return original.call(this, raw, options);
  });
  for (const [raw, normalized] of [[" 12-34 56 ", "123456"], ["  internal-12 ", "internal-12"],
    ["a".repeat(190), "a".repeat(190)], ["😀".repeat(190), "😀".repeat(190)]]) {
    const fixture = lookupFixture(); await fixture.lookup({ barcode: raw });
    assert.equal(received.at(-1), raw, "Inventory must not normalize before the Item API");
    assert.deepEqual(fixture.calls[0].params, [normalized]);
    assert.match(fixture.calls[0].sql, /b\.normalized_barcode = \?/u);
  }
  assert.equal(Buffer.byteLength(received.at(-1), "utf8"), 760);
  const invalid = ["", "   ", "a".repeat(191), "😀".repeat(191), ` ${"a".repeat(190)} `];
  for (const control of ["\u0000", "\t", "\r", "\n", "\u007f", "\u0085", "\u009f"]) {
    invalid.push(control + "known", "kn" + control + "own", "known" + control);
  }
  for (const barcode of invalid) {
    const fixture = lookupFixture();
    await assert.rejects(fixture.handler.execute({ query: { barcode }, input: { query: { barcode: barcode.trim() } } }),
      { code: "REQUEST_VALIDATION_FAILED", statusCode: 400 });
    assert.equal(fixture.calls.length, 0, "raw validation precedes any Item query");
  }
  assert.equal(received.length, 4);
});

test("MC08 exclusive raw lookup keys and malformed Item/UOM response projections fail closed", async () => {
  for (const query of [{}, { code: "X", barcode: "Y" }, { code: 12 }, { barcode: 12 },
    { barcode: ["X"] }, { code: ["X"] }, { barcode: null }, { barcode: "" }, { barcode: " ", other: "X" }]) {
    const fixture = lookupFixture();
    await assert.rejects(fixture.lookup(query), { code: "REQUEST_VALIDATION_FAILED", statusCode: 400 });
    assert.equal(fixture.calls.length, 0);
  }
  for (const query of [{}, { code: "X", barcode: "Y" }, { code: 12 }, { barcode: 12 }, { barcode: ["X"] }]) {
    const fixture = lookupFixture();
    await assert.rejects(fixture.handler.execute({ query, input: { query: { code: "coerced", barcode: "coerced" } } }),
      { code: "REQUEST_VALIDATION_FAILED", statusCode: 400 });
    assert.equal(fixture.calls.length, 0, "handler must reject raw coercion even with prevalidated-looking input");
  }
  for (const options of [{ sku: { id: "not-an-id" } }, { sku: { sku_code: null } }, { sku: { sku_name: null } },
    { sku: { tracking_policy: "unexpected" } },
    { uoms: [{ id: 20, sku_id: 12, uom_id: null, uom_code: "EA", is_base: 1, to_base_factor: 1 }] },
    { uoms: [{ id: 20, sku_id: 12, uom_id: 4, uom_code: null, is_base: 1, to_base_factor: 1 }] }]) {
    await assert.rejects(lookupFixture(options).lookup({ code: "SKU-%_" }), "malformed data must never pass the production response boundary");
  }
  const missing = lookupFixture({ missing: true });
  await assert.rejects(missing.lookup({ barcode: "unknown" }), { code: "INVENTORY_RESOURCE_NOT_FOUND", statusCode: 404 });
  assert.equal(missing.calls.length, 1);
});

test("MC09 missing Base UOM or factor other than one is rejected and valid output is the minimal main projection", async () => {
  for (const uoms of [[], [{ id: 20, sku_id: 12, uom_id: 4, uom_code: "EA", is_base: 0, to_base_factor: 1 }],
    ...[0, 2, 1.5, "invalid"].map(to_base_factor => [{ id: 20, sku_id: 12, uom_id: 4, uom_code: "EA", is_base: 1, to_base_factor }])]) {
    await assert.rejects(lookupFixture({ uoms }).lookup({ code: "SKU-%_" }), { code: "UOM_CONVERSION_INVALID", statusCode: 400 });
  }
  for (const tracking_policy of ["none", "batch", "batch_expiry"]) {
    assert.deepEqual(await lookupFixture({ sku: { tracking_policy } }).lookup({ barcode: "known" }), {
      skuId: 12, skuCode: "SKU-%_", skuName: "Current SKU", trackingPolicy: tracking_policy, baseUom: { uomId: 4, uomCode: "EA" }
    });
  }
});

test("MC10 Inventory view permission and tracked/usable/serial decisions survive without Item writes or redundant share locks", async () => {
  assert.equal(LookupInventorySkuHandler.api.authType, "jwt");
  assert.deepEqual(LookupInventorySkuHandler.api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
  for (const query of [{ code: "SKU-%_" }, { barcode: "known" }]) {
    for (const [sku, code] of [[{ inventory_tracked: 0 }, "SKU_NOT_INVENTORY_TRACKED"],
      [{ sku_status: "inactive" }, "INVENTORY_INPUT_INVALID"], [{ item_status: "archived" }, "INVENTORY_INPUT_INVALID"],
      [{ sku_status: "archived" }, "INVENTORY_INPUT_INVALID"], [{ tracking_policy: "serial" }, "SERIAL_TRACKING_UNSUPPORTED"]]) {
      await assert.rejects(lookupFixture({ sku }).lookup(query), { code, statusCode: 400 });
    }
    const fixture = lookupFixture({ sku: { item_status: "discontinued", purchasable: 0, sellable: 0 } });
    assert.equal((await fixture.lookup(query)).skuId, 12, "Inventory does not require purchase/sale eligibility");
    for (const call of fixture.calls) {
      assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|FOR SHARE|inventory_stock/iu);
    }
    assert.equal(fixture.calls.length, 2);
  }
});
