import assert from "node:assert/strict";
import test from "node:test";

import { InventoryMasterService } from "../src/modules/inventory/InventoryMasterService.js";

const ACTOR = Object.freeze({
  actorId: 7,
  claimedRoles: ["warehouse-manager"],
  claimedPermissions: ["inventory.view", "inventory.mgmt"],
  requestId: "request-1",
  correlationId: "correlation-1",
  ip: "127.0.0.1"
});

function fixture({ query, execute, locked = {}, audit } = {}) {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push({ method: "query", sql, params });
      return query ? query(sql, params) : [[]];
    },
    async execute(sql, params = []) {
      calls.push({ method: "execute", sql, params });
      return execute ? execute(sql, params) : [{ affectedRows: 1, insertId: 11 }];
    }
  };
  const audits = [];
  const service = new InventoryMasterService({
    database: {
      query: connection.query.bind(connection),
      withTransaction: (work) => work(connection)
    },
    time: { nowMs: () => 1_700_000_000_000 },
    authorize: async () => ({ username: "sam", permissions: ["inventory.view", "inventory.mgmt"] }),
    lockService: { lockForCommand: async () => locked },
    audit: audit ?? { recordSucceeded: async (_connection, input) => audits.push(input) }
  });
  return { service, calls, audits };
}

test("InventoryMasterService normalizes a Warehouse code and records its Audit", async () => {
  const { service, calls, audits } = fixture();

  const warehouse = await service.createWarehouse({
    ...ACTOR,
    warehouseCode: "  Main  ",
    warehouseName: " Main Warehouse ",
    address: " 1 Harbour Road ",
    description: " Primary "
  });

  assert.deepEqual(warehouse, {
    id: 11,
    code: "Main",
    name: "Main Warehouse",
    address: "1 Harbour Road",
    description: "Primary",
    status: "ACTIVE",
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  });
  const insert = calls.find(({ method }) => method === "execute");
  assert.deepEqual(insert.params.slice(0, 3), ["Main", "MAIN", "Main Warehouse"]);
  assert.equal(audits[0].action, "warehouse.create");
  assert.equal(audits[0].actorLabel, "sam");
});

test("InventoryMasterService maps normalized Warehouse and Bin duplicates", async () => {
  const duplicate = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
  const warehouse = fixture({ execute: async () => { throw duplicate; } }).service;
  await assert.rejects(
    () => warehouse.createWarehouse({ ...ACTOR, warehouseCode: "main", warehouseName: "Main" }),
    (error) => error.code === "WAREHOUSE_CODE_TAKEN"
  );

  const bin = fixture({
    locked: { warehouses: [{ id: 1, status: "ACTIVE" }] },
    execute: async () => { throw duplicate; }
  }).service;
  await assert.rejects(
    () => bin.createBin({ ...ACTOR, warehouseId: 1, binCode: "A-01", binName: "A" }),
    (error) => error.code === "BIN_CODE_TAKEN"
  );
});

test("InventoryMasterService ignores Movement history for deactivate but blocks permanent delete", async () => {
  const locked = { warehouses: [{
    id: 3,
    warehouse_code: "MAIN",
    warehouse_name: "Main",
    address: null,
    description: "",
    status: "ACTIVE",
    version: 4,
    created_at: 10,
    updated_at: 20
  }] };
  let blockerKind = "current";
  const { service, calls } = fixture({
    locked,
    query: async (sql) => {
      if (sql.includes("current_on_hand")) {
        return [[{
          current_on_hand: 0,
          active_reservations: 0,
          active_allocations: 0,
          open_transfers: 0,
          active_stocktakes: 0,
          active_bin_locks: 0
        }]];
      }
      if (sql.includes("child_bins")) {
        assert.equal(blockerKind, "delete");
        return [[{
          child_bins: 0,
          stock_controls: 0,
          stock_balances: 0,
          movements: 1,
          reservations: 0,
          transfers: 0,
          stocktakes: 0,
          opening_jobs: 0
        }]];
      }
      return [[]];
    }
  });

  const deactivated = await service.deactivateWarehouse({ ...ACTOR, warehouseId: 3, version: 4, reason: "No longer used" });
  assert.equal(deactivated.status, "INACTIVE");
  assert.equal(deactivated.version, 5);
  assert.equal(calls.some(({ sql }) => sql.includes("inventory_movements") && sql.includes("current_on_hand")), false);

  blockerKind = "delete";
  locked.warehouses[0].status = "INACTIVE";
  locked.warehouses[0].version = 5;
  await assert.rejects(
    () => service.deleteWarehouse({ ...ACTOR, warehouseId: 3, version: 5, reason: "Remove unused master" }),
    (error) => error.code === "WAREHOUSE_IN_USE" && error.details.blockers.movements === 1
  );
});

test("InventoryMasterService blocks Warehouse deactivate on current state", async () => {
  const { service, calls } = fixture({
    locked: { warehouses: [{ id: 3, status: "ACTIVE", version: 2 }] },
    query: async () => [[{
      current_on_hand: 1,
      active_reservations: 0,
      active_allocations: 0,
      open_transfers: 0,
      active_stocktakes: 0,
      active_bin_locks: 0
    }]]
  });

  await assert.rejects(
    () => service.deactivateWarehouse({ ...ACTOR, warehouseId: 3, version: 2, reason: "No longer used" }),
    (error) => error.code === "WAREHOUSE_IN_USE" && error.details.blockers.currentOnHand === 1
  );
  assert.equal(calls.some(({ method }) => method === "execute"), false);
});

test("InventoryMasterService blocks Bin deactivate on current state", async () => {
  const { service, calls } = fixture({
    locked: {
      warehouses: [{ id: 4, status: "ACTIVE" }],
      bins: [{ id: 8, warehouse_id: 4, status: "ACTIVE", version: 3 }]
    },
    query: async () => [[{
      current_on_hand: 0,
      active_allocations: 1,
      open_transfers: 0,
      active_stocktake_locks: 0
    }]]
  });

  await assert.rejects(
    () => service.deactivateBin({
      ...ACTOR,
      warehouseId: 4,
      binId: 8,
      version: 3,
      reason: "Close this location"
    }),
    (error) => error.code === "BIN_IN_USE" && error.details.blockers.activeAllocations === 1
  );
  assert.equal(calls.some(({ method }) => method === "execute"), false);
});

test("InventoryMasterService rejects Bin create and reactivate under an inactive Warehouse", async () => {
  const { service } = fixture({
    locked: {
      warehouses: [{ id: 4, status: "INACTIVE" }],
      bins: [{ id: 9, warehouse_id: 4, bin_code: "A", status: "INACTIVE", version: 2 }]
    }
  });

  await assert.rejects(
    () => service.createBin({ ...ACTOR, warehouseId: 4, binCode: "A" }),
    (error) => error.code === "WAREHOUSE_INVALID"
  );
  await assert.rejects(
    () => service.reactivateBin({ ...ACTOR, warehouseId: 4, binId: 9, version: 2, reason: "Reopen location" }),
    (error) => error.code === "WAREHOUSE_INVALID"
  );
});

test("InventoryMasterService rejects stale versions before any write", async () => {
  const { service, calls } = fixture({
    locked: { warehouses: [{ id: 5, status: "ACTIVE", version: 3 }] }
  });

  await assert.rejects(
    () => service.updateWarehouse({
      ...ACTOR,
      warehouseId: 5,
      version: 2,
      warehouseCode: "MAIN",
      warehouseName: "Main"
    }),
    (error) => error.code === "VERSION_CONFLICT"
  );
  assert.equal(calls.some(({ method }) => method === "execute"), false);
});

test("InventoryMasterService rejects a write when fresh management permission is absent", async () => {
  let executed = false;
  const connection = {
    query: async () => [[]],
    execute: async () => {
      executed = true;
      return [{ affectedRows: 1, insertId: 1 }];
    }
  };
  const service = new InventoryMasterService({
    database: {
      query: connection.query,
      withTransaction: (work) => work(connection)
    },
    time: { nowMs: () => 1 },
    authorize: async () => ({ username: "sam", permissions: ["inventory.view"] }),
    lockService: { lockForCommand: async () => ({}) },
    audit: { recordSucceeded: async () => {} }
  });

  await assert.rejects(
    () => service.createWarehouse({ ...ACTOR, warehouseCode: "MAIN", warehouseName: "Main" }),
    (error) => error.code === "PERMISSION_STALE"
  );
  assert.equal(executed, false);
});

test("InventoryMasterService rolls a create back when required Audit fails", async () => {
  let committed = 0;
  const auditError = new Error("audit unavailable");
  const connection = {
    query: async () => [[]],
    execute: async () => [{ affectedRows: 1, insertId: 12 }]
  };
  const service = new InventoryMasterService({
    database: {
      query: connection.query,
      async withTransaction(work) {
        const result = await work(connection);
        committed += 1;
        return result;
      }
    },
    time: { nowMs: () => 1 },
    authorize: async () => ({ username: "sam", permissions: ["inventory.mgmt"] }),
    lockService: { lockForCommand: async () => ({}) },
    audit: { recordSucceeded: async () => { throw auditError; } }
  });

  await assert.rejects(
    () => service.createWarehouse({ ...ACTOR, warehouseCode: "MAIN", warehouseName: "Main" }),
    auditError
  );
  assert.equal(committed, 0);
});

test("InventoryMasterService applies allowlisted Warehouse sorting with an id tie-breaker", async () => {
  const { service, calls } = fixture({
    query: async (sql) => sql.includes("COUNT(*)") ? [[{ total: 0 }]] : [[]]
  });

  await service.listWarehouses({ sortBy: "updatedAt", descending: true });

  const list = calls.find(({ sql }) => sql.includes("SELECT * FROM inventory_warehouses"));
  assert.match(list.sql, /ORDER BY updated_at DESC, id DESC/);
});

test("InventoryMasterService filters Bin lock status and returns a locked projection", async () => {
  const { service, calls } = fixture({
    query: async (sql) => {
      if (sql === "SELECT id FROM inventory_warehouses WHERE id = ?") return [[{ id: 4 }]];
      if (sql.includes("COUNT(*) AS total")) return [[{ total: 1 }]];
      return [[{
        id: 9, warehouse_id: 4, bin_code: "A-01", bin_name: "A", description: "",
        status: "ACTIVE", version: 2, created_at: 10, updated_at: 20, locked: 1
      }]];
    }
  });

  const result = await service.listBins({
    warehouseId: 4, lockStatus: "LOCKED", sortBy: "name", descending: true
  });

  assert.equal(result.items[0].locked, true);
  assert.ok(calls.some(({ sql }) => sql.includes("inventory_bin_locks") && sql.includes("released_at IS NULL")));
  const list = calls.find(({ sql }) => sql.includes("SELECT b.*"));
  assert.match(list.sql, /ORDER BY b\.bin_name DESC, b\.id DESC/);
});

test("InventoryMasterService returns owner-safe Bin detail with its current lock", async () => {
  const { service } = fixture({
    query: async (sql) => {
      if (sql.includes("FROM inventory_bins") && sql.includes("warehouse_id = ?")) {
        return [[{
          id: 9, warehouse_id: 4, bin_code: "A-01", bin_name: "A", description: "",
          status: "ACTIVE", version: 2, created_at: 10, updated_at: 20
        }]];
      }
      if (sql.includes("current_on_hand")) {
        return [[{ current_on_hand: 0, active_allocations: 0, open_transfers: 0, active_stocktake_locks: 1 }]];
      }
      if (sql.includes("stocktake_number")) {
        return [[{ lock_type: "STOCKTAKE", stocktake_id: 12, stocktake_number: "ST-001", locked_at: 30 }]];
      }
      return [[]];
    }
  });

  const bin = await service.getBin(4, 9);
  assert.deepEqual(bin.currentLock, {
    type: "STOCKTAKE", stocktakeId: 12, stocktakeNumber: "ST-001", lockedAt: 30
  });

  const missing = fixture({ query: async () => [[]] }).service;
  await assert.rejects(() => missing.getBin(4, 9), (error) => error.code === "INVENTORY_RESOURCE_NOT_FOUND");
});
