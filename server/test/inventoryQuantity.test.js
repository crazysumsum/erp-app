import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateInventoryAvailability,
  inventoryPositiveInteger,
  toBaseQuantity
} from "../src/modules/inventory/inventoryValidation.js";

test("Inventory quantities accept only positive safe Base UOM integers", () => {
  assert.equal(inventoryPositiveInteger(1), 1);
  assert.equal(inventoryPositiveInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);

  for (const value of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => inventoryPositiveInteger(value),
      (error) => error.code === "INVENTORY_QUANTITY_INVALID"
    );
  }
});

test("Pack conversion uses integer factors and rejects Base UOM overflow", () => {
  assert.equal(toBaseQuantity(7, 12), 84);
  assert.equal(toBaseQuantity(Number.MAX_SAFE_INTEGER, 1), Number.MAX_SAFE_INTEGER);

  for (const [quantity, factor] of [[1, 1.5], [1, 0], [1, "2"], [Number.MAX_SAFE_INTEGER, 2]]) {
    assert.throws(
      () => toBaseQuantity(quantity, factor),
      (error) => error.code === "INVENTORY_QUANTITY_INVALID"
    );
  }
});

test("ATP is clamped while uncovered reservations remain explicit", () => {
  assert.deepEqual(
    calculateInventoryAvailability({ eligibleOnHand: 10, reserved: 4 }),
    { eligibleOnHand: 10, reserved: 4, rawAtp: 6, atp: 6, uncoveredReserved: 0 }
  );
  assert.deepEqual(
    calculateInventoryAvailability({ eligibleOnHand: 3, reserved: 5 }),
    { eligibleOnHand: 3, reserved: 5, rawAtp: -2, atp: 0, uncoveredReserved: 2 }
  );
  assert.throws(
    () => calculateInventoryAvailability({ eligibleOnHand: -1, reserved: 0 }),
    (error) => error.code === "INVENTORY_QUANTITY_INVALID"
  );
});
