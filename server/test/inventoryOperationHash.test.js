import assert from "node:assert/strict";
import test from "node:test";

import { inventoryOperationHash } from "../src/modules/inventory/InventoryOperationService.js";

test("Inventory operation hash is canonical and includes command type", () => {
  const first = inventoryOperationHash({
    commandType: "RECEIPT_POST",
    payload: { quantity: 5, source: { id: "receipt-1", line: "1" } }
  });
  const reordered = inventoryOperationHash({
    commandType: "RECEIPT_POST",
    payload: { source: { line: "1", id: "receipt-1" }, quantity: 5 }
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, inventoryOperationHash({
    commandType: "RECEIPT_POST",
    payload: { quantity: 6, source: { id: "receipt-1", line: "1" } }
  }));
  assert.notEqual(first, inventoryOperationHash({
    commandType: "ISSUE_POST",
    payload: { quantity: 5, source: { id: "receipt-1", line: "1" } }
  }));
});

test("Inventory operation hash excludes authentication secrets but keeps business fields", () => {
  const base = {
    commandType: "ADJUSTMENT_POST",
    payload: {
      quantity: -2,
      reasonCategory: "COUNT_LOSS",
      auth: { password: "first", accessToken: "token-a", authorization: "Bearer a" }
    }
  };

  const withDifferentSecrets = inventoryOperationHash({
    ...base,
    payload: {
      ...base.payload,
      auth: { password: "second", accessToken: "token-b", authorization: "Bearer b" }
    }
  });

  assert.equal(inventoryOperationHash(base), withDifferentSecrets);
  assert.notEqual(inventoryOperationHash(base), inventoryOperationHash({
    ...base,
    payload: { ...base.payload, reasonCategory: "DAMAGE" }
  }));
});
