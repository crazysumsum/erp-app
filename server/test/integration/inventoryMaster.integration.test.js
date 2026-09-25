import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { InventoryLockService } from "../../src/modules/inventory/InventoryLockService.js";
import { InventoryMasterService } from "../../src/modules/inventory/InventoryMasterService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_MASTER_RACE_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task009_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-009 test requires a disposable erp_inventory_task009_* schema");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionLimit: 8
  };
}

function transactionalDatabase(pool) {
  return {
    query: pool.query.bind(pool),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

const ACTOR = Object.freeze({
  actorId: 1,
  claimedRoles: ["warehouse-manager"],
  claimedPermissions: ["inventory.view", "inventory.mgmt"],
  requestId: "task009-request",
  correlationId: "task009-correlation",
  ip: "127.0.0.1"
});

function input(values) {
  return { ...ACTOR, ...values };
}

async function createPrerequisites(connection) {
  await connection.query(`
    CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(190) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);
  await connection.query("INSERT INTO users (id, username) VALUES (1, 'sam')");
  await createInventoryMaster(connection);

  const tables = [
    `CREATE TABLE inventory_stock_controls (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_stock_balances (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL,
       bin_id BIGINT UNSIGNED NOT NULL,
       on_hand_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_reservations (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL,
       status VARCHAR(30) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_allocations (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       stock_balance_id BIGINT UNSIGNED NOT NULL,
       status VARCHAR(30) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_transfers (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       source_warehouse_id BIGINT UNSIGNED NOT NULL,
       destination_warehouse_id BIGINT UNSIGNED NOT NULL,
       status VARCHAR(30) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_transfer_lines (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       transfer_id BIGINT UNSIGNED NOT NULL,
       source_bin_id BIGINT UNSIGNED NOT NULL,
       destination_bin_id BIGINT UNSIGNED NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_stocktakes (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL,
       status VARCHAR(30) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_stocktake_bins (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       bin_id BIGINT UNSIGNED NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_bin_locks (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       bin_id BIGINT UNSIGNED NOT NULL,
       released_at BIGINT UNSIGNED NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_movements (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL,
       bin_id BIGINT UNSIGNED NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_opening_jobs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       warehouse_id BIGINT UNSIGNED NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE inventory_opening_rows (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       bin_id BIGINT UNSIGNED NULL
     ) ENGINE=InnoDB`
  ];
  for (const ddl of tables) await connection.query(ddl);
}

integrationTest("TASK-009 enforces master lifecycle and both Warehouse lock race orderings", async (t) => {
  const pool = mysql.createPool(config());
  const setup = await pool.getConnection();
  t.after(async () => {
    setup.release();
    await pool.end();
  });
  const [[versionRow]] = await setup.query("SELECT VERSION() AS version");
  assert.equal(versionRow.version, "26.7.0");
  await createPrerequisites(setup);

  let now = 1_700_000_000_000;
  const database = transactionalDatabase(pool);
  const authorize = async () => ({ username: "sam", permissions: ["inventory.view", "inventory.mgmt"] });
  const audit = { recordSucceeded: async () => {} };
  const service = new InventoryMasterService({
    database,
    time: { nowMs: () => now++ },
    authorize,
    audit
  });

  const first = await service.createWarehouse(input({ warehouseCode: "Main", warehouseName: "Main" }));
  const second = await service.createWarehouse(input({ warehouseCode: "Overflow", warehouseName: "Overflow" }));
  await assert.rejects(
    () => service.createWarehouse(input({ warehouseCode: " main ", warehouseName: "Duplicate" })),
    (error) => error.code === "WAREHOUSE_CODE_TAKEN"
  );
  const firstBin = await service.createBin(input({ warehouseId: first.id, binCode: "A-01", binName: "A" }));
  await service.createBin(input({ warehouseId: second.id, binCode: "a-01", binName: "A" }));
  await assert.rejects(
    () => service.createBin(input({ warehouseId: first.id, binCode: "a-01", binName: "Duplicate" })),
    (error) => error.code === "BIN_CODE_TAKEN"
  );

  const ephemeral = await service.createWarehouse(input({ warehouseCode: "Temp", warehouseName: "Temporary" }));
  const updatedWarehouse = await service.updateWarehouse(input({
    warehouseId: ephemeral.id,
    version: ephemeral.version,
    warehouseCode: "Temp-2",
    warehouseName: "Temporary 2"
  }));
  await assert.rejects(
    () => service.updateWarehouse(input({
      warehouseId: ephemeral.id,
      version: ephemeral.version,
      warehouseCode: "Temp-3",
      warehouseName: "Stale"
    })),
    (error) => error.code === "VERSION_CONFLICT"
  );
  const inactiveWarehouse = await service.deactivateWarehouse(input({
    warehouseId: ephemeral.id,
    version: updatedWarehouse.version,
    reason: "Temporary warehouse closed"
  }));
  const activeWarehouse = await service.reactivateWarehouse(input({
    warehouseId: ephemeral.id,
    version: inactiveWarehouse.version,
    reason: "Temporary warehouse reopened"
  }));
  const inactiveAgain = await service.deactivateWarehouse(input({
    warehouseId: ephemeral.id,
    version: activeWarehouse.version,
    reason: "Temporary warehouse removed"
  }));
  assert.deepEqual(await service.deleteWarehouse(input({
    warehouseId: ephemeral.id,
    version: inactiveAgain.version,
    reason: "Remove unused warehouse"
  })), { id: ephemeral.id, deleted: true });

  const temporaryBin = await service.createBin(input({
    warehouseId: second.id,
    binCode: "TEMP",
    binName: "Temporary"
  }));
  const updatedBin = await service.updateBin(input({
    warehouseId: second.id,
    binId: temporaryBin.id,
    version: temporaryBin.version,
    binCode: "TEMP-2",
    binName: "Temporary 2"
  }));
  const inactiveBin = await service.deactivateBin(input({
    warehouseId: second.id,
    binId: temporaryBin.id,
    version: updatedBin.version,
    reason: "Temporary bin closed"
  }));
  const activeBin = await service.reactivateBin(input({
    warehouseId: second.id,
    binId: temporaryBin.id,
    version: inactiveBin.version,
    reason: "Temporary bin reopened"
  }));
  const inactiveBinAgain = await service.deactivateBin(input({
    warehouseId: second.id,
    binId: temporaryBin.id,
    version: activeBin.version,
    reason: "Temporary bin removed"
  }));
  assert.deepEqual(await service.deleteBin(input({
    warehouseId: second.id,
    binId: temporaryBin.id,
    version: inactiveBinAgain.version,
    reason: "Remove unused bin"
  })), { id: temporaryBin.id, warehouseId: second.id, deleted: true });

  const listed = await service.listWarehouses({ status: "ALL", q: "main" });
  assert.equal(listed.items.some(({ id }) => id === first.id), true);
  const detail = await service.getWarehouse(first.id);
  assert.equal(detail.binSummary.total, 1);
  assert.equal((await service.getBin(first.id, firstBin.id)).warehouseId, first.id);

  const poster = await pool.getConnection();
  t.after(() => poster.release());
  await poster.beginTransaction();
  const lockService = new InventoryLockService();
  const [lockedWarehouse] = (await lockService.lockForCommand(poster, { warehouseIds: [first.id] })).warehouses;
  assert.equal(lockedWarehouse.status, "ACTIVE");
  await poster.execute(
    "INSERT INTO inventory_stock_balances (warehouse_id, bin_id, on_hand_quantity) VALUES (?, ?, 1)",
    [first.id, firstBin.id]
  );

  let deactivateLockStarted;
  const lockStarted = new Promise((resolve) => { deactivateLockStarted = resolve; });
  const waitingService = new InventoryMasterService({
    database,
    time: { nowMs: () => now++ },
    authorize,
    audit,
    lockService: {
      lockForCommand(connection, lockInput) {
        const pending = lockService.lockForCommand(connection, lockInput);
        deactivateLockStarted();
        return pending;
      }
    }
  });
  const waitingDeactivate = waitingService.deactivateWarehouse(input({
    warehouseId: first.id,
    version: first.version,
    reason: "Posting should win"
  }));
  await lockStarted;
  await poster.commit();
  await assert.rejects(waitingDeactivate, (error) => error.code === "WAREHOUSE_IN_USE");
  assert.equal((await service.getWarehouse(first.id)).status, "ACTIVE");

  const raceWarehouse = await service.createWarehouse(input({ warehouseCode: "Race", warehouseName: "Race" }));
  const raceBin = await service.createBin(input({ warehouseId: raceWarehouse.id, binCode: "R-01" }));
  let auditEntered;
  let releaseAudit;
  const enteredAudit = new Promise((resolve) => { auditEntered = resolve; });
  const auditRelease = new Promise((resolve) => { releaseAudit = resolve; });
  const deactivatingService = new InventoryMasterService({
    database,
    time: { nowMs: () => now++ },
    authorize,
    audit: {
      async recordSucceeded() {
        auditEntered();
        await auditRelease;
      }
    }
  });
  const winningDeactivate = deactivatingService.deactivateWarehouse(input({
    warehouseId: raceWarehouse.id,
    version: raceWarehouse.version,
    reason: "Deactivate should win"
  }));
  await enteredAudit;

  const latePoster = await pool.getConnection();
  t.after(() => latePoster.release());
  await latePoster.beginTransaction();
  const lateLock = lockService.lockForCommand(latePoster, { warehouseIds: [raceWarehouse.id] });
  releaseAudit();
  const [lateWarehouse] = (await lateLock).warehouses;
  await winningDeactivate;
  assert.equal(lateWarehouse.status, "INACTIVE");
  await latePoster.rollback();
  const [[lateBalance]] = await pool.query(
    "SELECT COUNT(*) AS total FROM inventory_stock_balances WHERE warehouse_id = ? AND bin_id = ?",
    [raceWarehouse.id, raceBin.id]
  );
  assert.equal(Number(lateBalance.total), 0);
});
