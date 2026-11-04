/** TASK-017／TC-004：PO 狀態機就係設計 §3.2 同 §5.2（Cancel）嗰張表，其他轉換一律 PO_STATE_CONFLICT。 */
import assert from "node:assert/strict";
import test from "node:test";

import { nextPurchaseOrderStatus } from "../../src/modules/purchasing/purchaseOrderStateMachine.js";

const ALLOWED = [
  ["DRAFT", "SAVE", "DRAFT"], ["DRAFT", "CONFIRM", "CONFIRMED"], ["DRAFT", "SUBMIT_FOR_APPROVAL", "PENDING_APPROVAL"], ["DRAFT", "CANCEL", "CANCELLED"],
  ["PENDING_APPROVAL", "APPROVE", "CONFIRMED"], ["PENDING_APPROVAL", "REJECT", "DRAFT"], ["PENDING_APPROVAL", "WITHDRAW_APPROVAL", "DRAFT"], ["PENDING_APPROVAL", "CANCEL", "CANCELLED"],
  ["CONFIRMED", "WITHDRAW_CONFIRMATION", "DRAFT"], ["CONFIRMED", "CANCEL", "CANCELLED"], ["CONFIRMED", "RECEIVE_PARTIAL", "PARTIALLY_RECEIVED"], ["CONFIRMED", "RECEIVE_ALL", "FULLY_RECEIVED"],
  ["PARTIALLY_RECEIVED", "RECEIVE_ALL", "FULLY_RECEIVED"], ["PARTIALLY_RECEIVED", "CLOSE_REMAINING", "CLOSED"]
];
const STATUSES = ["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED", "CANCELLED"];
const ACTIONS = [...new Set(ALLOWED.map(([, action]) => action))];

test("State machine 只准 §3.2 嘅轉換，其餘全部 PO_STATE_CONFLICT", () => {
  for (const status of STATUSES) {
    for (const action of ACTIONS) {
      const allowed = ALLOWED.find(([from, name]) => from === status && name === action);
      if (allowed) assert.equal(nextPurchaseOrderStatus(status, action), allowed[2], `${status} ${action}`);
      else assert.throws(() => nextPurchaseOrderStatus(status, action), { code: "PO_STATE_CONFLICT" }, `${status} ${action}`);
    }
  }
});

test("State machine 拒絕未知狀態同 Object 原型上嘅名", () => {
  for (const [status, action] of [["NOPE", "CONFIRM"], ["DRAFT", "NOPE"], ["DRAFT", "toString"], ["constructor", "name"], [undefined, undefined]]) {
    assert.throws(() => nextPurchaseOrderStatus(status, action), { code: "PO_STATE_CONFLICT" });
  }
});
