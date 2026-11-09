/**
 * TASK-025（§3.2、§8.4）：PO lifecycle 嘅純推導同 transaction 內規則，用假 tx。Sam 2026-11-09 批准 C4（U1～U7，22 個 registration）。
 * purchasingLifecycle.integration.test.js 經真 HTTP／MySQL 驗 I1～I4；真 lock 次序、trigger 同並發唔喺本批（並發要另外批准）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { derivedStatus, lineOutstanding, PurchaseOrderLifecycleService } from "../../src/modules/purchasing/PurchaseOrderLifecycleService.js";

const actor = { id: 7, username: "maker" }, request = { eventId: "e", version: 3, reason: "原因原因原因" };
const po = (status, received = 0) => ({ id: 8, po_number: "PO-202611-000008", status, version: 3, has_confirmed_receipt: received });
const kinds = (calls) => ({
  lock: calls.filter(([sql]) => sql.includes("FROM purchase_orders WHERE id = ? FOR UPDATE")).length,
  linesLock: calls.filter(([sql]) => sql.includes("FROM purchase_order_lines")).length,
  lineUpdate: calls.filter(([sql]) => sql.startsWith("UPDATE purchase_order_lines")).length,
  poUpdate: calls.filter(([sql]) => sql.startsWith("UPDATE purchase_orders")).length,
  history: calls.filter(([sql]) => sql.includes("purchase_order_status_history")).length
});
function fakeTx(row, lines = []) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push([sql.replace(/\s+/gu, " ").trim(), params]);
    if (sql.includes("FROM purchase_orders WHERE id = ? FOR UPDATE")) return [[row]];
    if (sql.includes("FROM purchase_order_lines")) return [lines];
    if (sql.includes("MAX(sequence_no)")) return [[{ next: 1 }]];
    return [{ affectedRows: 1 }];
  } };
}
function service(answer) {
  const invalidated = [], readerCalls = [];
  const receiptFacts = typeof answer === "function" ? { everConfirmed: async (...args) => { readerCalls.push(args); return answer(); } }
    : answer === "default" ? undefined : { everConfirmed: async (...args) => { readerCalls.push(args); return answer; } };
  const lifecycle = new PurchaseOrderLifecycleService({ approvals: { invalidateInTransaction: async (_tx, args) => { invalidated.push(args); } }, ...(receiptFacts ? { receiptFacts } : {}) });
  return { lifecycle, invalidated, readerCalls };
}
const run = (lifecycle, tx, kind, extra = {}) => lifecycle.runInTransaction(tx, { kind, purchaseOrderId: 8, request: { ...request, ...extra }, actor, nowMs: 1 });
const L = (ordered, net, closedRemaining = "0") => ({ ordered, net, closedRemaining });
const LINES = [{ id: 11, ordered_base_quantity: 10, net_received_base_quantity: 10, closed_remaining_base_quantity: 0 },
  { id: 12, ordered_base_quantity: 5, net_received_base_quantity: 2, closed_remaining_base_quantity: 0 },
  { id: 13, ordered_base_quantity: 4, net_received_base_quantity: 0, closed_remaining_base_quantity: 0 }];

// U1：§3.2 推導，8 行。
for (const [name, lines, status] of [
  ["未收", [L("10", "0")], "CONFIRMED"],
  ["部分收", [L("10", "4"), L("5", "0")], "PARTIALLY_RECEIVED"],
  ["全收（超收唔增加 Ordered）", [L("10", "10"), L("5", "6")], "FULLY_RECEIVED"],
  ["收完再關剩餘", [L("10", "10"), L("5", "2", "3")], "CLOSED"],
  ["一行關咗、另一行未收", [L("10", "4", "6"), L("5", "0")], "PARTIALLY_RECEIVED"],
  ["只係關咗冇收過", [L("10", "0", "10")], "CLOSED"],
  ["超過 2^53 嘅 Base quantity", [L("9007199254740993", "1")], "PARTIALLY_RECEIVED"],
  ["outstanding 唔會係負數", [L("10", "12")], "FULLY_RECEIVED"]
]) {
  test(`TASK-025 U1 derivedStatus：${name}`, () => {
    assert.equal(derivedStatus(lines), status);
    for (const line of lines) assert.ok(lineOutstanding(line) >= 0n);
  });
}

test("TASK-025 U2 取消 PENDING：同一 transaction 作廢審批，CANCELLED、version + 1、一行 status history", async () => {
  const { lifecycle, invalidated, readerCalls } = service(false), tx = fakeTx(po("PENDING_APPROVAL"));
  const result = await run(lifecycle, tx, "CANCEL");
  assert.deepEqual([result.summary.status, result.summary.version, result.audit.action], ["CANCELLED", 4, "purchase_order.cancelled"]);
  assert.deepEqual([invalidated.length, readerCalls.length], [1, 1]);
  assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 0, lineUpdate: 0, poUpdate: 1, history: 2 });
});

test("TASK-025 U3 撤回確認：DRAFT，清走 confirmed_at／confirmed_by", async () => {
  const { lifecycle, readerCalls } = service(false), tx = fakeTx(po("CONFIRMED"));
  const result = await run(lifecycle, tx, "WITHDRAW_CONFIRMATION");
  assert.equal(result.summary.status, "DRAFT");
  assert.equal(readerCalls.length, 1);
  const [, [changes]] = tx.calls.find(([sql]) => sql.startsWith("UPDATE purchase_orders"));
  assert.deepEqual([changes.status, changes.confirmed_at, changes.confirmed_by, changes.version], ["DRAFT", null, null, 4]);
  assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 0, lineUpdate: 0, poUpdate: 1, history: 2 });
});

// U4：錯誤分類，5 個 variant；明確 true 係衝突，唔係 boolean 係依賴不可用，reader 自己拋就照拋；一律冇寫入。
for (const [name, received, answer, expected, readerCount] of [
  ["projection 已係 1", 1, false, "PO_STATE_CONFLICT", 0],
  ["reader 明確 true", 0, true, "PO_STATE_CONFLICT", 1],
  ["reader 回 undefined", 0, undefined, "PURCHASING_DEPENDENCY_UNAVAILABLE", 1],
  ["reader 拋錯", 0, () => { throw Object.assign(new Error("boom"), { code: "READER_BROKE" }); }, "READER_BROKE", 1],
  ["冇接 reader（production 預設）", 0, "default", "PURCHASING_DEPENDENCY_UNAVAILABLE", 0]
]) {
  test(`TASK-025 U4 撤回／取消要權威 GR 事實：${name}`, async () => {
    const { lifecycle, readerCalls } = service(answer), tx = fakeTx(po("CONFIRMED", received));
    await assert.rejects(run(lifecycle, tx, "CANCEL"), (error) => error.code === expected);
    assert.equal(readerCalls.length, readerCount);
    assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 0, lineUpdate: 0, poUpdate: 0, history: 0 });
  });
}

// U5：reader 之前嘅守衛，3 個 variant。
for (const [name, status, kind, extra, expected] of [
  ["舊 version", "CONFIRMED", "WITHDRAW_CONFIRMATION", { version: 2 }, "VERSION_CONFLICT"],
  ["DRAFT 唔可以撤回確認", "DRAFT", "WITHDRAW_CONFIRMATION", {}, "PO_STATE_CONFLICT"],
  ["CONFIRMED 唔可以 Close Remaining", "CONFIRMED", "CLOSE_REMAINING", {}, "PO_STATE_CONFLICT"]
]) {
  test(`TASK-025 U5 ${name}`, async () => {
    const { lifecycle, readerCalls } = service(false), tx = fakeTx(po(status));
    await assert.rejects(run(lifecycle, tx, kind, extra), (error) => error.code === expected);
    assert.equal(readerCalls.length, 0);
    assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 0, lineUpdate: 0, poUpdate: 0, history: 0 });
  });
}

test("TASK-025 U6 Close Remaining 全部：只關有 outstanding 嘅行，每行關 ordered - net，PO CLOSED", async () => {
  const { lifecycle, readerCalls } = service(false), tx = fakeTx(po("PARTIALLY_RECEIVED"), LINES.slice(0, 2));
  const result = await run(lifecycle, tx, "CLOSE_REMAINING");
  assert.deepEqual([result.summary.status, result.audit.action, result.audit.detail], ["CLOSED", "purchase_order.remaining_closed", { version: 4, lineCount: 1 }]);
  assert.deepEqual(tx.calls.filter(([sql]) => sql.startsWith("UPDATE purchase_order_lines")).map(([, params]) => [params[0], params[5]]), [["3", 12]]);
  assert.equal(readerCalls.length, 0);
  assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 1, lineUpdate: 1, poUpdate: 1, history: 2 });
});

// U7：揀行，3 個 variant。
for (const [name, lineIds, expected, counts] of [
  ["揀咗冇 outstanding 嘅行", [11], "PO_STATE_CONFLICT", { lineUpdate: 0, poUpdate: 0, history: 0 }],
  ["揀咗唔屬於呢張 PO 嘅行", [99], "PURCHASE_ORDER_NOT_FOUND", { lineUpdate: 0, poUpdate: 0, history: 0 }],
  ["只關一行，其他仲未收：仍然 PARTIALLY_RECEIVED，唔寫 status history", [13], "PARTIALLY_RECEIVED", { lineUpdate: 1, poUpdate: 1, history: 0 }]
]) {
  test(`TASK-025 U7 ${name}`, async () => {
    const { lifecycle } = service(false), tx = fakeTx(po("PARTIALLY_RECEIVED"), LINES);
    if (expected === "PARTIALLY_RECEIVED") assert.equal((await run(lifecycle, tx, "CLOSE_REMAINING", { lineIds })).summary.status, expected);
    else await assert.rejects(run(lifecycle, tx, "CLOSE_REMAINING", { lineIds }), (error) => error.code === expected);
    assert.deepEqual(kinds(tx.calls), { lock: 1, linesLock: 1, ...counts });
  });
}
