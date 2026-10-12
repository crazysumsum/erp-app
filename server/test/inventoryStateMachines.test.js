import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompleteTransferLines,
  assertTransferWarehouses,
  transferTransition
} from "../src/modules/inventory/inventoryStateMachines.js";

for (const [state, action, result] of [
  ["DRAFT", "edit", "DRAFT"], ["DRAFT", "dispatch", "IN_TRANSIT"],
  ["DRAFT", "cancel", "CANCELLED"], ["IN_TRANSIT", "receive", "RECEIVED"]
]) {
  test(`Transfer ${state} ${action} becomes ${result}`, () => {
    assert.equal(transferTransition(state, action), result);
  });
}

test("Transfer rejects every other state/action pair", () => {
  for (const state of ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED", "UNKNOWN", null]) {
    for (const action of ["edit", "dispatch", "receive", "cancel", "UNKNOWN", null, "toString"]) {
      const legal = state === "DRAFT" && ["edit", "dispatch", "cancel"].includes(action) ||
        state === "IN_TRANSIT" && action === "receive";
      if (!legal) assert.throws(() => transferTransition(state, action), { code: "TRANSFER_STATE_CONFLICT" });
    }
  }
});

test("Transfer warehouses must be distinct positive safe integers", () => {
  assert.doesNotThrow(() => assertTransferWarehouses(1, 2));
  for (const pair of [[1, 1], [0, 2], [1, -1], ["1", 2], [1, 1.5], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => assertTransferWarehouses(...pair), { code: "INVENTORY_INPUT_INVALID" });
  }
});

const lines = [{ id: 1, quantity: 3 }, { id: 2, quantity: 5 }];
test("Transfer accepts all lines and full quantities regardless of input order", () => {
  const before = structuredClone(lines);
  assert.doesNotThrow(() => assertCompleteTransferLines(lines, [lines[1], lines[0]]));
  assert.deepEqual(lines, before);
});

for (const [label, submitted] of [
  ["missing line", [lines[0]]], ["partial quantity", [{ id: 1, quantity: 2 }, lines[1]]],
  ["excess quantity", [{ id: 1, quantity: 4 }, lines[1]]],
  ["duplicate line", [lines[0], lines[0]]],
  ["unknown line", [lines[0], { id: 3, quantity: 5 }]]
]) {
  test(`Transfer rejects ${label} without mutating lines`, () => {
    const before = structuredClone(lines);
    assert.throws(() => assertCompleteTransferLines(lines, submitted), { code: "TRANSFER_PARTIAL_NOT_SUPPORTED" });
    assert.deepEqual(lines, before);
  });
}

test("Transfer rejects malformed line sets and unsafe quantities", () => {
  for (const value of [null, {}, [], [null], [1], [Object.assign([], lines[0])], [{ id: 0, quantity: 1 }], [lines[0], lines[0]]]) {
    assert.throws(() => assertCompleteTransferLines(value, lines), { code: "INVENTORY_INPUT_INVALID" });
  }
  for (const quantity of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertCompleteTransferLines([{ id: 1, quantity }], [{ id: 1, quantity }]),
      { code: "INVENTORY_QUANTITY_INVALID" });
  }
  for (const submitted of [null, {}, [null], [{ id: "1", quantity: 3 }]]) {
    assert.throws(() => assertCompleteTransferLines(lines, submitted), { code: "INVENTORY_INPUT_INVALID" });
  }
});
