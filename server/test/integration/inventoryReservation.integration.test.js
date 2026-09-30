import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createInventoryStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createInventoryMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as createInventoryReservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_RESERVATION_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task020_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-020 integration requires a disposable erp_inventory_task020_* schema");
  }
  return {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database, connectionLimit: 4
  };
}

function transactionalDatabase(pool) {
  return {
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

async function prepare(connection) {
  await connection.query(`CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, username VARCHAR(190) NOT NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE permissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(190) NOT NULL,
    description VARCHAR(255) NOT NULL DEFAULT '', created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_permissions_name (name)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE item_skus (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, sku_code VARCHAR(190) NOT NULL,
    sku_name VARCHAR(190) NOT NULL, PRIMARY KEY (id),
    UNIQUE KEY uq_item_skus_code (sku_code)
  ) ENGINE=InnoDB`);
  for (const migrate of [
    seedInventoryPermissions, createInventoryOperations, createInventoryAudit,
    createInventoryMaster, createInventoryStock, createInventoryMovements,
    createInventoryReservations
  ]) await migrate(connection);

  await connection.execute("INSERT INTO users (id, username) VALUES (7, 'sam')");
  await connection.execute("INSERT INTO item_skus (id, sku_code, sku_name) VALUES (12, 'SKU-12', 'Widget')");
  await connection.execute(
    `INSERT INTO inventory_warehouses
       (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
     VALUES (2, 'WH-2', 'wh-2', 'Main', 1, 1)`
  );
  await connection.execute(
    `INSERT INTO inventory_bins
       (id, warehouse_id, bin_code, normalized_code, created_at, updated_at)
     VALUES (3, 2, 'A-01', 'a-01', 1, 1)`
  );
  for (const [id, expiry] of [
    [1, "2026-10-28"], [2, "2026-10-27"], [3, "2026-09-27"]
  ]) {
    await connection.execute(
      `INSERT INTO inventory_lots
         (id, sku_id, lot_number, normalized_lot_number, expiry_date,
          first_receipt_date, sku_code_snapshot, created_at)
       VALUES (?, 12, ?, ?, ?, '2026-09-01', 'SKU-12', 1)`,
      [id, `LOT-${id}`, `lot-${id}`, expiry]
    );
  }
  for (const [lotId, status, quantity] of [
    [null, "AVAILABLE", 4], [1, "AVAILABLE", 6], [2, "AVAILABLE", 6],
    [3, "AVAILABLE", 3], [null, "QUARANTINED", 8], [null, "DAMAGED", 8]
  ]) {
    await connection.execute(
      `INSERT INTO inventory_stock_balances
         (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity,
          fifo_anchor_date, created_at, updated_at)
       VALUES (2, 3, 12, ?, ?, ?, '2026-09-01', 1, 1)`,
      [lotId, status, quantity]
    );
  }
}

function command(action, eventId, payload) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `reservation.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-20", eventId },
    correlationId: eventId,
    payload
  });
}

async function state(connection) {
  const [[row]] = await connection.query(
    `SELECT
       (SELECT COALESCE(SUM(reserved_quantity), 0) FROM inventory_stock_controls) AS reserved,
       (SELECT COUNT(*) FROM inventory_reservations) AS reservations,
       (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
       (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

integrationTest("TASK-020 serializes competing Reservations and rolls back failed state changes", async (t) => {
  const pool = mysql.createPool(config());
  const setup = await pool.getConnection();
  t.after(async () => { setup.release(); await pool.end(); });
  const [[version]] = await setup.query("SELECT VERSION() AS version");
  assert.equal(version.version, "26.7.0");
  await prepare(setup);

  let currentDate = "2026-09-28";
  let initialReads = 0;
  let releaseInitialReads;
  const initialReadBarrier = new Promise((resolve) => { releaseInitialReads = resolve; });
  const database = transactionalDatabase(pool);
  const options = {
    database,
    logger: { async error() {} },
    time: { nowMs: () => 1_798_000_000_000, fileDate: () => currentDate },
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
    itemLookup: { async getInventoryProfileInTransaction(transaction) {
      if (++initialReads <= 2) {
        await transaction.query("SELECT COUNT(*) FROM inventory_stock_balances");
        if (initialReads === 2) releaseInitialReads();
        await initialReadBarrier;
      }
      return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry", minimumSaleLifeDays: 30 };
    } }
  };
  const service = new InventoryReservationService(options);
  const reserve = (eventId, quantity = 7) => command("create", eventId, {
    skuId: 12, warehouseId: 2, quantity, purpose: "SALE", minimumRemainingDays: 10
  });

  const competing = await Promise.allSettled([
    service.create(reserve("reserve-a")), service.create(reserve("reserve-b"))
  ]);
  const winners = competing.filter((entry) => entry.status === "fulfilled");
  const losers = competing.filter((entry) => entry.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "INSUFFICIENT_ATP");
  assert.equal(winners[0].value.minimumRemainingDays, 30);
  assert.deepEqual(await state(setup), { reserved: 7, reservations: 1, operations: 1, audits: 1 });
  const eventId = competing[0].status === "fulfilled" ? "reserve-a" : "reserve-b";
  assert.deepEqual(await service.create(reserve(eventId)), winners[0].value);
  await assert.rejects(() => service.create(reserve(eventId, 6)),
    (error) => error.code === "INVENTORY_SOURCE_CONFLICT");

  currentDate = "2026-09-29";
  await assert.rejects(() => service.create(reserve("reserve-after-midnight", 1)),
    (error) => error.code === "INSUFFICIENT_ATP" &&
      error.details?.rawAtp === -3 && error.details?.uncoveredReserved === 3);
  assert.deepEqual(await state(setup), { reserved: 7, reservations: 1, operations: 1, audits: 1 });

  const reservationId = winners[0].value.id;
  const released = await service.release(command("release", "release-1", {
    reservationId, expectedVersion: 1, quantity: 2
  }));
  assert.deepEqual([released.releasedQuantity, released.outstandingQuantity, released.version], [2, 5, 2]);
  await assert.rejects(() => service.cancel(command("cancel", "cancel-stale", {
    reservationId, expectedVersion: 1
  })), (error) => error.code === "VERSION_CONFLICT");

  const failing = new InventoryReservationService({
    ...options, audit: { async recordSucceeded() { throw new Error("injected audit failure"); } }
  });
  await assert.rejects(() => failing.cancel(command("cancel", "cancel-audit-fails", {
    reservationId, expectedVersion: 2
  })), /injected audit failure/);
  assert.deepEqual(await state(setup), { reserved: 5, reservations: 1, operations: 2, audits: 2 });

  const cancelled = await service.cancel(command("cancel", "cancel-1", {
    reservationId, expectedVersion: 2
  }));
  assert.deepEqual([cancelled.originalQuantity, cancelled.consumedQuantity,
    cancelled.releasedQuantity, cancelled.outstandingQuantity, cancelled.status, cancelled.version],
  [7, 0, 7, 0, "CANCELLED", 3]);
  assert.deepEqual(await state(setup), { reserved: 0, reservations: 1, operations: 3, audits: 3 });
});
