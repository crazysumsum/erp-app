import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createInventoryStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createInventoryMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as createInventoryReservations } from "../../database/migrations/0061_create_inventory_reservations.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_ALLOCATION_TESTS === "1" ? test : test.skip;
const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function config() {
  const database = process.env.DB_NAME;
  const socketPath = process.env.DB_SOCKET;
  if (!/^erp_inventory_task021_[a-z0-9_]+$/u.test(database ?? "") ||
      !/^\/private\/tmp\/erp-inventory-task021-mysql-2670\.[^/]+\/mysql\.sock$/u.test(socketPath ?? "")) {
    throw new Error("TASK-021 integration requires its own disposable schema and socket");
  }
  return { socketPath, user: "root", database, connectionLimit: 4 };
}

function transactionalDatabase(pool) {
  return { async withTransaction(work) {
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
  } };
}

function service(database, overrides = {}) {
  return new InventoryReservationService({
    database, logger: { error() {} },
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    authorize: async () => ({ username: "sam", permissions: ["inventory.operation"] }),
    itemLookup: { async getInventoryProfileInTransaction() {
      return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry", minimumSaleLifeDays: 0 };
    } },
    ...overrides
  });
}

function command(purpose, eventId, payload) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose, requiredCallerPermission: "inventory.operation" },
    source: { module: "FULFILLMENT", documentType: "PICK", documentId: "PICK-021", eventId },
    correlationId: eventId, payload
  });
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

  for (const skuId of [12, 13, 14]) {
    const warehouseId = skuId - 10;
    const binId = skuId + 10;
    await connection.execute(
      "INSERT INTO item_skus (id, sku_code, sku_name) VALUES (?, ?, 'Widget')",
      [skuId, `SKU-${skuId}`]
    );
    await connection.execute(
      `INSERT INTO inventory_warehouses
         (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
       VALUES (?, ?, ?, 'Main', 1, 1)`,
      [warehouseId, `WH-${warehouseId}`, `wh-${warehouseId}`]
    );
    await connection.execute(
      `INSERT INTO inventory_bins
         (id, warehouse_id, bin_code, normalized_code, created_at, updated_at)
       VALUES (?, ?, 'A-01', 'a-01', 1, 1)`,
      [binId, warehouseId]
    );
    for (const [sequence, expiry] of [
      [1, "2026-10-31"], [2, "2026-11-30"], [3, "2026-09-27"]
    ]) {
      const lotId = skuId * 10 + sequence;
      await connection.execute(
        `INSERT INTO inventory_lots
           (id, sku_id, lot_number, normalized_lot_number, expiry_date,
            first_receipt_date, sku_code_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, '2026-09-01', ?, 1)`,
        [lotId, skuId, `LOT-${lotId}`, `lot-${lotId}`, expiry, `SKU-${skuId}`]
      );
      await connection.execute(
        `INSERT INTO inventory_stock_balances
           (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity,
            fifo_anchor_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'AVAILABLE', 5, '2026-09-01', 1, 1)`,
        [warehouseId, binId, skuId, lotId]
      );
    }
  }
}

async function reservationFor(serviceUnderTest, skuId, quantity) {
  return serviceUnderTest.create(command("reservation.create", `reserve-${skuId}`, {
    skuId, warehouseId: skuId - 10, quantity, purpose: "SALE", minimumRemainingDays: 0
  }));
}

async function balances(connection, skuId) {
  const [rows] = await connection.query(
    `SELECT b.id, b.version, b.on_hand_quantity, b.allocated_quantity,
            DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date
       FROM inventory_stock_balances b JOIN inventory_lots l ON l.id = b.lot_id
      WHERE b.sku_id = ? ORDER BY l.expiry_date`, [skuId]
  );
  return rows.map((row) => ({
    id: Number(row.id), version: Number(row.version),
    onHand: Number(row.on_hand_quantity), allocated: Number(row.allocated_quantity),
    expiryDate: row.expiry_date
  }));
}

async function snapshot(connection, reservationId, balanceId) {
  const [[row]] = await connection.query(
    `SELECT
       (SELECT version FROM inventory_reservations WHERE id = ?) AS reservation_version,
       (SELECT allocated_quantity FROM inventory_stock_balances WHERE id = ?) AS allocated,
       (SELECT COUNT(*) FROM inventory_allocations WHERE reservation_id = ?) AS allocations,
       (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
       (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`,
    [reservationId, balanceId, reservationId]
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

integrationTest("TASK-021 real MySQL Allocation integrity, contention and rollback", async (t) => {
  const pool = mysql.createPool(config());
  const setup = await pool.getConnection();
  t.after(async () => { setup.release(); await pool.end(); });
  const [[version]] = await setup.query("SELECT VERSION() AS version");
  assert.equal(version.version, "26.7.0");
  const [[existing]] = await setup.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  assert.equal(Number(existing.count), 0, "TASK-021 schema must start empty");
  await prepare(setup);
  const database = transactionalDatabase(pool);
  const inventory = service(database);

  await t.test("DEV-021-DB-01 persists FEFO Allocation once and enforces the MySQL quantity check", async () => {
    const reservation = await reservationFor(inventory, 12, 6);
    const candidates = await database.withTransaction((transaction) =>
      inventory.listAllocationCandidatesInTransaction(transaction, {
        reservationId: reservation.id, requestedQuantity: 4
      }));
    const initial = await balances(setup, 12);
    assert.deepEqual(candidates.items.map(({ balanceId, expiryDate, freeQuantity, balanceVersion }) =>
      [balanceId, expiryDate, freeQuantity, balanceVersion]), [
      [initial[1].id, "2026-10-31", 5, 1], [initial[2].id, "2026-11-30", 5, 1]
    ]);
    const request = command("allocation.create", "allocate-12", {
      reservationId: reservation.id, expectedVersion: 1,
      allocations: [{ balanceId: initial[1].id, expectedVersion: 1, quantity: 4 }]
    });
    const result = await inventory.allocate(request);
    assert.deepEqual(await inventory.allocate(request), result);
    const [[allocation]] = await setup.query(
      "SELECT status, outstanding_quantity, selection_strategy FROM inventory_allocations WHERE reservation_id = ?",
      [reservation.id]
    );
    assert.deepEqual([allocation.status, Number(allocation.outstanding_quantity), allocation.selection_strategy],
      ["ACTIVE", 4, "FEFO"]);
    assert.deepEqual((await balances(setup, 12))[1], {
      ...initial[1], version: 2, allocated: 4
    });
    const [audits] = await setup.query(
      "SELECT action FROM inventory_audit_logs WHERE action = 'allocation.create' AND target_id = ?",
      [result.allocations[0].id]
    );
    assert.equal(audits.length, 1);
    await assert.rejects(() => setup.execute(
      "UPDATE inventory_allocations SET outstanding_quantity = 9 WHERE id = ?",
      [result.allocations[0].id]
    ), (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
    const [[unchanged]] = await setup.query(
      "SELECT outstanding_quantity FROM inventory_allocations WHERE id = ?", [result.allocations[0].id]
    );
    assert.equal(Number(unchanged.outstanding_quantity), 4);
  });

  await t.test("DEV-021-DB-02 serializes two competing Allocation transactions", async () => {
    const reservation = await reservationFor(inventory, 13, 4);
    const first = (await balances(setup, 13))[1];
    const underlying = new InventoryOperationService();
    let arrivals = 0;
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const racing = service(database, { operations: {
      async claim(transaction, input) {
        const claim = await underlying.claim(transaction, input);
        await transaction.query("SELECT COUNT(*) FROM inventory_stock_balances");
        if (++arrivals === 2) release();
        await barrier;
        return claim;
      },
      complete: (...args) => underlying.complete(...args)
    } });
    const allocate = (eventId) => racing.allocate(command("allocation.create", eventId, {
      reservationId: reservation.id, expectedVersion: 1,
      allocations: [{ balanceId: first.id, expectedVersion: 1, quantity: 3 }]
    }));
    const outcomes = await Promise.allSettled([allocate("race-a"), allocate("race-b")]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const loser = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(["VERSION_CONFLICT", "CONCURRENT_OPERATION"].includes(loser?.reason?.code));
    const [[row]] = await setup.query(
      `SELECT COALESCE(SUM(outstanding_quantity), 0) AS outstanding, COUNT(*) AS count
         FROM inventory_allocations WHERE reservation_id = ?`, [reservation.id]
    );
    assert.deepEqual([Number(row.outstanding), Number(row.count)], [3, 1]);
    const current = (await balances(setup, 13))[1];
    assert.deepEqual([current.onHand, current.allocated, current.version], [5, 3, 2]);
  });

  await t.test("DEV-021-DB-03 rolls back all Allocation writes when required Audit fails", async () => {
    const reservation = await reservationFor(inventory, 14, 2);
    const first = (await balances(setup, 14))[1];
    const before = await snapshot(setup, reservation.id, first.id);
    const failing = service(database, { audit: {
      async recordSucceeded() { throw new Error("injected audit failure"); }
    } });
    await assert.rejects(() => failing.allocate(command("allocation.create", "audit-fails", {
      reservationId: reservation.id, expectedVersion: 1,
      allocations: [{ balanceId: first.id, expectedVersion: 1, quantity: 2 }]
    })), /injected audit failure/u);
    assert.deepEqual(await snapshot(setup, reservation.id, first.id), before);
  });
});
