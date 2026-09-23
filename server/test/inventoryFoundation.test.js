import assert from "node:assert/strict";
import test from "node:test";
import { up as seedInventoryPermissions } from "../database/migrations/0054_seed_inventory_permissions.js";
import { PERMISSION_NAMES } from "../src/modules/authorization/permissionCatalogue.js";
import {
  INVENTORY_ADJUSTMENT_REASON_CATEGORIES,
  INVENTORY_AUDIT_ACTIONS,
  INVENTORY_COMMAND_TYPES,
  INVENTORY_OPENING_JOB_STATUSES,
  INVENTORY_STOCK_STATUSES
} from "../src/modules/inventory/inventoryConstants.js";
import {
  INVENTORY_ERROR_DEFINITIONS,
  inventoryError
} from "../src/modules/inventory/inventoryErrors.js";

const INVENTORY_PERMISSIONS = [
  "inventory.view",
  "inventory.operation",
  "inventory.mgmt",
  "inventory.adjust",
  "inventory.fefo.override"
];

test("Inventory permissions are explicit and are not inherited by system-admin", async () => {
  const permissions = new Map();
  let nextId = 1;
  const connection = {
    async query(sql, [name]) {
      assert.match(sql, /SELECT id FROM permissions/);
      const row = permissions.get(name);
      return [row ? [{ id: row.id }] : []];
    },
    async execute(sql, [name, description]) {
      assert.match(sql, /INSERT INTO permissions/);
      permissions.set(name, { id: nextId, description });
      return [{ insertId: nextId++ }];
    }
  };

  await seedInventoryPermissions(connection);
  await seedInventoryPermissions(connection);

  assert.deepEqual([...permissions.keys()], INVENTORY_PERMISSIONS);
  assert.ok(INVENTORY_PERMISSIONS.every((name) => PERMISSION_NAMES.includes(name)));
});

test("Inventory domain allowlists are frozen, unique and contain the approved values", () => {
  for (const values of [
    INVENTORY_STOCK_STATUSES,
    INVENTORY_OPENING_JOB_STATUSES,
    INVENTORY_ADJUSTMENT_REASON_CATEGORIES,
    INVENTORY_COMMAND_TYPES,
    INVENTORY_AUDIT_ACTIONS
  ]) {
    assert.equal(Object.isFrozen(values), true);
    assert.equal(new Set(values).size, values.length);
  }

  assert.deepEqual(INVENTORY_STOCK_STATUSES, ["AVAILABLE", "QUARANTINED", "DAMAGED"]);
  assert.ok(INVENTORY_OPENING_JOB_STATUSES.includes("POSTING"));
  assert.ok(INVENTORY_ADJUSTMENT_REASON_CATEGORIES.includes("OTHER"));
  assert.ok(INVENTORY_COMMAND_TYPES.includes("RECEIPT_POST"));
  assert.ok(INVENTORY_AUDIT_ACTIONS.includes("inventory.go_live"));
});

test("Inventory public errors use only the stable allowlist", () => {
  const error = inventoryError("SERIAL_TRACKING_UNSUPPORTED", { skuId: 7 });
  assert.equal(error.code, "SERIAL_TRACKING_UNSUPPORTED");
  assert.equal(error.publicCode, "SERIAL_TRACKING_UNSUPPORTED");
  assert.equal(error.statusCode, 400);
  assert.deepEqual(error.publicDetails, { skuId: 7 });
  assert.ok(Object.isFrozen(INVENTORY_ERROR_DEFINITIONS));
  assert.throws(() => inventoryError("CALLER_CONTROLLED_CODE"), /Unknown Inventory error code/);
});
