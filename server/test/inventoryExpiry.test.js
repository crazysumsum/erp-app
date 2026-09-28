import assert from "node:assert/strict";
import test from "node:test";

import {
  isInventoryLotExpired,
  meetsMinimumRemainingLife
} from "../src/modules/inventory/inventoryValidation.js";

test("Expiry date is the final usable APP_TIME_ZONE local date", () => {
  assert.equal(isInventoryLotExpired("2026-09-28", "2026-09-28"), false);
  assert.equal(isInventoryLotExpired("2026-09-27", "2026-09-28"), true);
  assert.equal(isInventoryLotExpired("2026-09-29", "2026-09-28"), false);
  assert.equal(isInventoryLotExpired(null, "2026-09-28"), false);
});

test("Minimum remaining life uses date-only calendar arithmetic", () => {
  assert.equal(meetsMinimumRemainingLife("2026-03-10", "2026-03-08", 2), true);
  assert.equal(meetsMinimumRemainingLife("2026-03-09", "2026-03-08", 2), false);
  assert.equal(meetsMinimumRemainingLife("2028-02-29", "2028-02-28", 1), true);
  assert.equal(meetsMinimumRemainingLife(null, "2026-03-08", 365), true);
});

test("Expiry rules reject malformed dates and minimum-life values", () => {
  for (const expiryDate of ["2026-02-29", "2026-2-09", "not-a-date"]) {
    assert.throws(
      () => isInventoryLotExpired(expiryDate, "2026-02-28"),
      (error) => error.code === "INVENTORY_INPUT_INVALID"
    );
  }
  assert.throws(
    () => meetsMinimumRemainingLife("2026-09-30", "2026-09-28", -1),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});
