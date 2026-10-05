import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { SalesOperationService } from "../../../src/modules/sales/SalesOperationService.js";
import { SalesAuditService } from "../../../src/modules/sales/SalesAuditService.js";
import { salesPayloadHash } from "../../../src/modules/sales/salesCanonicalHash.js";

const actor = { id: 7, username: "synthetic" };
const input = () => ({ eventId: randomUUID(), commandType: "CREATE_QUOTATION", targetId: null,
  payload: { quantity: "1.000000" }, actor, nowMs: 1 });
test("Sales operation claims a global event with canonical business payload and fixed command target", async () => {
  let args;
  const service = new SalesOperationService();
  const tx = { async execute(sql, values) { args = values; return [{ insertId: 9 }]; } };
  const request = input();
  assert.deepEqual(await service.claim(tx, request), { operationId: 9, replay: null });
  assert.equal(args[2], "QUOTATION");
  assert.equal(args[4], salesPayloadHash(request.payload));
  await assert.rejects(() => service.claim(tx, { ...request, commandType: "CONFIRM_ORDER" }), TypeError);
});
test("Sales operation replays only the same actor, command, target and payload", async () => {
  const service = new SalesOperationService(), request = input();
  const row = { id: 9, actor_user_id: actor.id, command_type: request.commandType, target_type: "QUOTATION", target_id: null,
    request_hash: salesPayloadHash(request.payload), status: "SUCCEEDED", result_summary: { id: 3, number: "QT-202610-000001", status: "DRAFT", version: 1 } };
  const tx = { async execute() { throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }); }, async query() { return [[row]]; } };
  assert.deepEqual((await service.claim(tx, request)).replay, row.result_summary);
  for (const patch of [{ actor: { ...actor, id: 8 } }, { commandType: "CREATE_ORDER" }, { targetId: 2 }, { payload: { quantity: "2.000000" } }])
    await assert.rejects(() => service.claim(tx, { ...request, ...patch }), { code: "SALES_EVENT_CONFLICT" });
  row.status = "IN_PROGRESS";
  await assert.rejects(() => service.claim(tx, request), { code: "CONCURRENT_OPERATION" });
});
test("Sales operation completion guards durable result fields and refuses double completion", async () => {
  const service = new SalesOperationService();
  let calls = 0;
  const tx = { async execute() { calls++; return [{ affectedRows: calls === 1 ? 1 : 0 }]; } };
  const result = { id: 2, number: "SO-202610-000001", status: "DRAFT", version: 1 };
  await assert.rejects(() => service.succeed(tx, { operationId: 1, result: { ...result, notes: "private" }, nowMs: 1 }), TypeError);
  assert.equal(calls, 0);
  await service.succeed(tx, { operationId: 1, result, nowMs: 1 });
  await assert.rejects(() => service.succeed(tx, { operationId: 1, result, nowMs: 1 }), { code: "CONCURRENT_OPERATION" });
});
test("Sales operation maps indeterminate commit to stable unknown outcome without retry", async () => {
  const service = new SalesOperationService();
  let calls = 0;
  const database = { async withTransaction() { calls++; throw Object.assign(new Error("internal"), { code: "DATABASE_TRANSACTION_INDETERMINATE" }); } };
  await assert.rejects(() => service.run(database, () => {}), { code: "TRANSACTION_OUTCOME_UNKNOWN" });
  assert.equal(calls, 1);
});
test("Sales operation lookup projects only the fresh actor's safe result", async () => {
  const service = new SalesOperationService(), eventId = randomUUID();
  let args;
  const tx = { async query(sql, values) { args = values; return [[{ status: "SUCCEEDED", result_summary: '{"id":2,"number":"SO-202610-000001","status":"DRAFT","version":1}' }]]; } };
  assert.equal((await service.getForActor(tx, { eventId, actor })).result.id, 2);
  assert.deepEqual(args, [eventId, actor.id]);
});
test("Sales Audit uses fixed action-specific safe builders and propagates required write failure", async () => {
  const service = new SalesAuditService();
  const request = { actor, action: "sales_quotation.created", targetId: 2, targetNumber: "QT-202610-000001", eventId: randomUUID(), nowMs: 1,
    details: { version: 1, lineCount: 1, totalAmount: "0.0000", currencyCode: "HKD" } };
  let calls = 0;
  const tx = { async execute(sql, args) { calls++; assert.equal(args[4], "QUOTATION"); assert.equal(JSON.parse(args[8]).totalAmount, "0.0000"); throw new Error("required audit failed"); } };
  for (const patch of [{ action: "sales_order.confirmed" }, { details: { ...request.details, notes: "private" } },
    { details: { ...request.details, totalAmount: 0 } }, { details: { fromStatus: "DRAFT", toStatus: "ISSUED", version: 1 } }])
    await assert.rejects(() => service.record(tx, { ...request, ...patch }), TypeError);
  assert.equal(calls, 0);
  await assert.rejects(() => service.record(tx, request), /required audit failed/u);
  assert.equal(calls, 1);
});
test("Sales Audit uses ORDER target identity distinct from the operation SALES_ORDER identity", async () => {
  let target;
  await new SalesAuditService().record({ async execute(sql, args) { target = args[4]; } },
    { actor, action: "sales_order.created", targetId: 2, targetNumber: "SO-202610-000001", eventId: randomUUID(), nowMs: 1,
      details: { version: 1, lineCount: 1, totalAmount: "0.0000", currencyCode: "HKD" } });
  assert.equal(target, "ORDER");
});
