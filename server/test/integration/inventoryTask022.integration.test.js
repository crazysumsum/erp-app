import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as createReservations } from "../../database/migrations/0061_create_inventory_reservations.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { assertActorFresh } from "../../src/modules/authorization/directoryLookups.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const task025 = process.env.INVENTORY_TASK025_TESTS === "1";
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  (process.env.INVENTORY_TASK022_TESTS === "1" || task025) ? test : test.skip;
const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function config() {
  const database = process.env.DB_NAME;
  const socketPath = process.env.DB_SOCKET;
  const task = task025 ? "task025" : "task022";
  if (!new RegExp(`^erp_inventory_${task}_[a-z0-9_]+$`, "u").test(database ?? "") ||
      !new RegExp(`^/private/tmp/erp-inventory-${task}-mysql-2670\\.[^/]+/mysql\\.sock$`, "u").test(socketPath ?? "")) {
    throw new Error(`TASK-022/025 integration requires its own disposable schema and socket`);
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

function command(purpose, skuId, eventId, payload) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose, requiredCallerPermission: "inventory.operation" },
    source: { module: "FULFILLMENT", documentType: purpose === "issue.post" ? "SHIPMENT" : "PICK",
      documentId: `DOC-${skuId}`, eventId },
    correlationId: eventId, payload
  });
}

function services(database, time, overrides = {}) {
  const authorize = async () => ({ username: "sam",
    permissions: ["inventory.operation", "inventory.fefo.override"] });
  const itemLookup = { async getInventoryProfileInTransaction(_transaction, skuId) {
    return { usable: true, inventoryTracked: true, trackingPolicy: "batch_expiry",
      minimumSaleLifeDays: 0, skuCode: `SKU-${skuId}`, skuName: "Widget",
      baseUom: { uomId: 5, uomCode: "EA" } };
  } };
  const options = { database, logger: { error() {} }, time, authorize, itemLookup, ...overrides };
  return { reservation: new InventoryReservationService(options),
    posting: new InventoryPostingService(options) };
}

function synchronizedClaims(count) {
  const underlying = new InventoryOperationService();
  let arrivals = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  return {
    async claim(transaction, input) {
      const claimed = await underlying.claim(transaction, input);
      await transaction.query("SELECT COUNT(*) FROM inventory_stock_balances");
      if (++arrivals === count) releaseBarrier();
      await barrier;
      return claimed;
    },
    complete: (...args) => underlying.complete(...args)
  };
}

async function prepare(connection) {
  await connection.query(`CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, username VARCHAR(190) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    PRIMARY KEY (id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(190) NOT NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE user_roles (
    user_id BIGINT UNSIGNED NOT NULL, role_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, role_id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE role_permissions (
    role_id BIGINT UNSIGNED NOT NULL, permission_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id)
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
  for (const migrate of [seedPermissions, createOperations, createAudit,
    createMaster, createStock, createMovements, createReservations]) await migrate(connection);
  await connection.execute("INSERT INTO users (id, username) VALUES (7, 'sam')");
  await connection.execute("INSERT INTO roles (id, name) VALUES (1, 'warehouse-operator')");
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (7, 1)");
  await connection.execute(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT 1, id FROM permissions WHERE name = 'inventory.operation'`);
  for (const skuId of [12, 13, 14, 15, 16, 17, 18, 19]) {
    const warehouseId = skuId - 10;
    const binId = skuId + 10;
    await connection.execute("INSERT INTO item_skus (id, sku_code, sku_name) VALUES (?, ?, 'Widget')",
      [skuId, `SKU-${skuId}`]);
    await connection.execute(
      `INSERT INTO inventory_warehouses
         (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
       VALUES (?, ?, ?, 'Main', 1, 1)`,
      [warehouseId, `WH-${warehouseId}`, `wh-${warehouseId}`]
    );
    await connection.execute(
      `INSERT INTO inventory_bins
         (id, warehouse_id, bin_code, normalized_code, created_at, updated_at)
       VALUES (?, ?, 'A-01', 'a-01', 1, 1)`, [binId, warehouseId]
    );
    for (const [sequence, expiry] of [[1, skuId === 14 ? "2026-09-29" : "2026-10-31"],
      [2, "2026-11-30"]]) {
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
         VALUES (?, ?, ?, ?, 'AVAILABLE', ?, '2026-09-01', 1, 1)`,
        [warehouseId, binId, skuId, lotId, skuId === 13 && sequence === 1 ? 2 : 5]
      );
    }
  }
}

async function balances(connection, skuId) {
  const [rows] = await connection.query(
    `SELECT b.id, b.version, b.on_hand_quantity, b.allocated_quantity
       FROM inventory_stock_balances b JOIN inventory_lots l ON l.id = b.lot_id
      WHERE b.sku_id = ? ORDER BY l.expiry_date`, [skuId]
  );
  return rows.map((row) => ({ id: Number(row.id), version: Number(row.version),
    onHand: Number(row.on_hand_quantity), allocated: Number(row.allocated_quantity) }));
}

async function reserveAndAllocate(inventory, connection, skuId, quantities) {
  const quantity = quantities.reduce((sum, value) => sum + value, 0);
  const reservation = await inventory.reservation.create(command("reservation.create", skuId,
    `reserve-${skuId}`, { skuId, warehouseId: skuId - 10, quantity,
      purpose: "SALE", minimumRemainingDays: 0 }));
  const current = await balances(connection, skuId);
  const allocation = await inventory.reservation.allocate(command("allocation.create", skuId,
    `allocate-${skuId}`, { reservationId: reservation.id, expectedVersion: reservation.version,
      allocations: quantities.map((lineQuantity, index) => ({ balanceId: current[index].id,
        expectedVersion: current[index].version, quantity: lineQuantity })) }));
  return { reservation, allocation, initialBalances: current };
}

async function snapshot(connection, skuId) {
  const [controls] = await connection.query(
    "SELECT id, version, reserved_quantity FROM inventory_stock_controls WHERE sku_id = ? ORDER BY id", [skuId]);
  const [reservations] = await connection.query(
    `SELECT id, version, status, original_quantity, consumed_quantity, released_quantity,
            outstanding_quantity FROM inventory_reservations WHERE sku_id = ? ORDER BY id`, [skuId]);
  const [allocations] = await connection.query(
    `SELECT a.id, a.version, a.status, a.allocated_quantity, a.consumed_quantity,
            a.released_quantity, a.outstanding_quantity, a.stock_balance_id
       FROM inventory_allocations a JOIN inventory_reservations r ON r.id = a.reservation_id
      WHERE r.sku_id = ? ORDER BY a.id`, [skuId]);
  const [stock] = await connection.query(
    `SELECT id, version, on_hand_quantity, allocated_quantity, fifo_anchor_date
       FROM inventory_stock_balances WHERE sku_id = ? ORDER BY id`, [skuId]);
  const [movements] = await connection.query(
    `SELECT id, operation_request_id, movement_group_id, movement_type, quantity,
            balance_before, balance_after, balance_version_after, reservation_id, allocation_id
       FROM inventory_movements WHERE sku_id = ? ORDER BY id`, [skuId]);
  const [[counts]] = await connection.query(
    `SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
            (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`);
  return { controls, reservations, allocations, stock, movements,
    operations: Number(counts.operations), audits: Number(counts.audits) };
}

integrationTest("TASK-022 real MySQL Allocation transitions and Issue consume", async (t) => {
  const pool = mysql.createPool(config());
  const setup = await pool.getConnection();
  t.after(async () => { setup.release(); await pool.end(); });
  const [[server]] = await setup.query("SELECT VERSION() AS version, @@skip_networking AS skip_networking");
  assert.equal(server.version, "26.7.0");
  assert.equal(Number(server.skip_networking), 1);
  const [[existing]] = await setup.query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  assert.equal(Number(existing.count), 0, "TASK-022/025 schema must start empty");
  await prepare(setup);
  let currentDate = "2026-09-28";
  const time = { nowMs: () => NOW, fileDate: () => currentDate };
  const database = transactionalDatabase(pool);
  const inventory = services(database, time);

  await t.test("DEV-022-DB-01 releases, reallocates and cancels only matching holds", async () => {
    const { reservation, allocation, initialBalances } = await reserveAndAllocate(inventory, setup, 12, [4]);
    const first = allocation.allocations[0];
    const releaseRequest = command("allocation.release", 12, "release-12", {
      reservationId: reservation.id, expectedVersion: allocation.version,
      releases: [{ allocationId: first.id, expectedVersion: first.version, quantity: 2 }]
    });
    const released = await inventory.reservation.releaseAllocation(releaseRequest);
    assert.deepEqual(await inventory.reservation.releaseAllocation(releaseRequest), released);
    assert.deepEqual((await balances(setup, 12)).map(({ onHand, allocated }) => [onHand, allocated]),
      [[5, 2], [5, 0]]);
    const reallocated = await inventory.reservation.reallocateAllocation(command(
      "allocation.reallocate", 12, "reallocate-12", {
        reservationId: reservation.id, expectedVersion: released.version,
        releases: [{ allocationId: first.id, expectedVersion: released.allocations[0].version, quantity: 2 }],
        allocations: [{ balanceId: initialBalances[1].id,
          expectedVersion: initialBalances[1].version, quantity: 2 }],
        overrideReason: "Move hold to later lot for verification"
      }
    ));
    assert.deepEqual((await balances(setup, 12)).map(({ onHand, allocated }) => [onHand, allocated]),
      [[5, 0], [5, 2]]);
    const cancelled = await inventory.reservation.cancel(command("reservation.cancel", 12,
      "cancel-12", { reservationId: reservation.id, expectedVersion: reallocated.version }));
    const state = await snapshot(setup, 12);
    assert.deepEqual([cancelled.status, Number(state.controls[0].reserved_quantity),
      Number(state.reservations[0].outstanding_quantity)], ["CANCELLED", 0, 0]);
    assert.deepEqual(state.allocations.map(({ outstanding_quantity }) => Number(outstanding_quantity)), [0, 0]);
    assert.deepEqual(state.stock.map(({ allocated_quantity }) => Number(allocated_quantity)), [0, 0]);
    assert.equal(state.movements.length, 0);
    assert.equal(state.operations, 5);
    const [[releaseAudits]] = await setup.query(
      "SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action = 'allocation.release'");
    assert.equal(Number(releaseAudits.count), 2);
  });

  await t.test("DEV-022-DB-02 posts a two-line Issue once with matching persisted quantities", async () => {
    const { reservation, allocation } = await reserveAndAllocate(inventory, setup, 13, [2, 2]);
    const lines = allocation.allocations.map((row, index) => ({ allocationId: row.id,
      expectedVersion: row.version, balanceId: row.balanceId,
      expectedBalanceVersion: row.balanceVersion, quantity: index === 0 ? 2 : 1 }));
    const request = command("issue.post", 13, "issue-13", {
      reservationId: reservation.id, expectedVersion: allocation.version, lines
    });
    const result = await inventory.posting.postIssue(request);
    assert.deepEqual(await inventory.posting.postIssue(request), result);
    await assert.rejects(() => inventory.posting.postIssue(command("issue.post", 13, "issue-13", {
      reservationId: reservation.id, expectedVersion: allocation.version,
      lines: [{ ...lines[0], quantity: 1 }, lines[1]]
    })), (error) => error.code === "INVENTORY_SOURCE_CONFLICT");
    const state = await snapshot(setup, 13);
    assert.deepEqual(state.stock.map(({ on_hand_quantity, allocated_quantity }) =>
      [Number(on_hand_quantity), Number(allocated_quantity)]), [[0, 0], [4, 1]]);
    assert.deepEqual([Number(state.controls[0].reserved_quantity),
      Number(state.reservations[0].consumed_quantity),
      Number(state.reservations[0].outstanding_quantity)], [1, 3, 1]);
    assert.deepEqual(state.allocations.map(({ consumed_quantity, outstanding_quantity }) =>
      [Number(consumed_quantity), Number(outstanding_quantity)]), [[2, 0], [1, 1]]);
    assert.deepEqual(state.movements.map(({ movement_type, balance_before, balance_after }) =>
      [movement_type, Number(balance_before), Number(balance_after)]),
    [["ISSUE", 2, 0], ["ISSUE", 5, 4]]);
    assert.equal(state.operations, 8);
    const [[audit]] = await setup.query(
      "SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action = 'issue.post'");
    assert.equal(Number(audit.count), 1);
  });

  await t.test("DEV-022-DB-03 rejects mismatch, expiry and required-Audit failure without writes", async () => {
    const { reservation, allocation, initialBalances } = await reserveAndAllocate(inventory, setup, 14, [2]);
    const first = allocation.allocations[0];
    const line = { allocationId: first.id, expectedVersion: first.version,
      balanceId: first.balanceId, expectedBalanceVersion: first.balanceVersion, quantity: 2 };
    const before = await snapshot(setup, 14);
    await assert.rejects(() => inventory.posting.postIssue(command("issue.post", 14,
      "mismatch-14", { reservationId: reservation.id, expectedVersion: allocation.version,
        lines: [{ ...line, balanceId: initialBalances[1].id }] })),
    (error) => error.code === "ALLOCATION_STATE_CONFLICT");
    assert.deepEqual(await snapshot(setup, 14), before);
    currentDate = "2026-09-30";
    await assert.rejects(() => inventory.posting.postIssue(command("issue.post", 14,
      "expired-14", { reservationId: reservation.id, expectedVersion: allocation.version,
        lines: [line] })), (error) => error.code === "LOT_EXPIRED");
    assert.deepEqual(await snapshot(setup, 14), before);
    currentDate = "2026-09-28";
    const failing = services(database, time, { audit: {
      async recordSucceeded() { throw new Error("injected audit failure"); }
    } }).posting;
    await assert.rejects(() => failing.postIssue(command("issue.post", 14,
      "audit-fails-14", { reservationId: reservation.id, expectedVersion: allocation.version,
        lines: [line] })), /injected audit failure/u);
    assert.deepEqual(await snapshot(setup, 14), before);
  });

  await t.test("DEV-022-DB-04 serializes competing Issue and Allocation release", async () => {
    const { reservation, allocation } = await reserveAndAllocate(inventory, setup, 15, [2]);
    const first = allocation.allocations[0];
    const racing = services(database, time, { operations: synchronizedClaims(2) });
    const outcomes = await Promise.allSettled([
      racing.posting.postIssue(command("issue.post", 15, "race-issue-15", {
        reservationId: reservation.id, expectedVersion: allocation.version,
        lines: [{ allocationId: first.id, expectedVersion: first.version,
          balanceId: first.balanceId, expectedBalanceVersion: first.balanceVersion, quantity: 2 }]
      })),
      racing.reservation.releaseAllocation(command("allocation.release", 15, "race-release-15", {
        reservationId: reservation.id, expectedVersion: allocation.version,
        releases: [{ allocationId: first.id, expectedVersion: first.version, quantity: 2 }]
      }))
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const loser = outcomes.find(({ status }) => status === "rejected");
    assert.ok(["VERSION_CONFLICT", "CONCURRENT_OPERATION", "ALLOCATION_STATE_CONFLICT"]
      .includes(loser?.reason?.code), loser?.reason?.message);
    const state = await snapshot(setup, 15);
    const reservationRow = state.reservations[0];
    const allocationRow = state.allocations[0];
    const balanceRow = state.stock[0];
    assert.equal(Number(reservationRow.outstanding_quantity), Number(state.controls[0].reserved_quantity));
    assert.equal(Number(reservationRow.original_quantity), Number(reservationRow.consumed_quantity) +
      Number(reservationRow.released_quantity) + Number(reservationRow.outstanding_quantity));
    assert.equal(Number(allocationRow.allocated_quantity), Number(allocationRow.consumed_quantity) +
      Number(allocationRow.released_quantity) + Number(allocationRow.outstanding_quantity));
    assert.equal(Number(balanceRow.allocated_quantity), Number(allocationRow.outstanding_quantity));
    assert.equal(state.movements.length, outcomes[0].status === "fulfilled" ? 1 : 0);
  });

  if (task025) await t.test("DEV-025-DB-01 concurrent 7+7 Reservations cannot oversell ATP 10", async () => {
    const before = await snapshot(setup, 16);
    const racing = services(database, time, { operations: synchronizedClaims(2) });
    const request = (eventId) => command("reservation.create", 16, eventId, {
      skuId: 16, warehouseId: 6, quantity: 7, purpose: "SALE", minimumRemainingDays: 0
    });
    const outcomes = await Promise.allSettled([
      racing.reservation.create(request("race-reserve-16-a")),
      racing.reservation.create(request("race-reserve-16-b"))
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const loser = outcomes.find(({ status }) => status === "rejected");
    assert.ok(["INSUFFICIENT_ATP", "CONCURRENT_OPERATION", "VERSION_CONFLICT"]
      .includes(loser?.reason?.code), loser?.reason?.message);
    const state = await snapshot(setup, 16);
    assert.equal(state.reservations.length, 1);
    assert.equal(Number(state.controls[0].reserved_quantity), 7);
    assert.equal(Number(state.reservations[0].outstanding_quantity), 7);
    assert.equal(state.stock.reduce((sum, row) => sum + Number(row.on_hand_quantity), 0), 10);
    assert.equal(state.operations, before.operations + 1);
    assert.equal(state.audits, before.audits + 1);
  });

  if (task025) await t.test("DEV-025-DB-02 Allocation, Issue and release serialize on one Balance", async () => {
    const reservation = await inventory.reservation.create(command("reservation.create", 17,
      "reserve-17", { skuId: 17, warehouseId: 7, quantity: 5,
        purpose: "SALE", minimumRemainingDays: 0 }));
    const available = await balances(setup, 17);
    const allocation = await inventory.reservation.allocate(command("allocation.create", 17,
      "allocate-17", { reservationId: reservation.id, expectedVersion: reservation.version,
        allocations: [{ balanceId: available[0].id, expectedVersion: available[0].version, quantity: 2 }] }));
    const first = allocation.allocations[0];
    const current = await balances(setup, 17);
    const before = await snapshot(setup, 17);
    const racing = services(database, time, { operations: synchronizedClaims(3) });
    const outcomes = await Promise.allSettled([
      racing.reservation.allocate(command("allocation.create", 17, "race-allocate-17", {
        reservationId: reservation.id, expectedVersion: allocation.version,
        allocations: [{ balanceId: current[0].id, expectedVersion: current[0].version, quantity: 3 }]
      })),
      racing.posting.postIssue(command("issue.post", 17, "race-issue-17", {
        reservationId: reservation.id, expectedVersion: allocation.version,
        lines: [{ allocationId: first.id, expectedVersion: first.version,
          balanceId: first.balanceId, expectedBalanceVersion: first.balanceVersion, quantity: 2 }]
      })),
      racing.reservation.releaseAllocation(command("allocation.release", 17, "race-release-17", {
        reservationId: reservation.id, expectedVersion: allocation.version,
        releases: [{ allocationId: first.id, expectedVersion: first.version, quantity: 2 }]
      }))
    ]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    for (const loser of outcomes.filter(({ status }) => status === "rejected")) {
      assert.ok(["VERSION_CONFLICT", "CONCURRENT_OPERATION", "ALLOCATION_STATE_CONFLICT"]
        .includes(loser.reason?.code), loser.reason?.message);
    }
    const state = await snapshot(setup, 17);
    const reservationRow = state.reservations[0];
    assert.equal(Number(reservationRow.outstanding_quantity), Number(state.controls[0].reserved_quantity));
    assert.equal(Number(reservationRow.original_quantity), Number(reservationRow.consumed_quantity) +
      Number(reservationRow.released_quantity) + Number(reservationRow.outstanding_quantity));
    assert.equal(state.allocations.reduce((sum, row) => sum + Number(row.outstanding_quantity), 0),
      state.stock.reduce((sum, row) => sum + Number(row.allocated_quantity), 0));
    assert.ok(state.stock.every((row) => Number(row.allocated_quantity) >= 0 &&
      Number(row.allocated_quantity) <= Number(row.on_hand_quantity)));
    assert.equal(state.operations, before.operations + 1);
    assert.equal(state.audits, before.audits + 1);
    assert.equal(state.movements.length, outcomes[1].status === "fulfilled" ? 1 : 0);
  });

  if (task025) await t.test("DEV-025-DB-03 FEFO permission and ineligible buckets fail closed", async () => {
    const controlled = services(database, time, { authorize: assertActorFresh });
    const reservation = await controlled.reservation.create(command("reservation.create", 18,
      "reserve-18", { skuId: 18, warehouseId: 8, quantity: 4,
        purpose: "SALE", minimumRemainingDays: 0 }));
    const current = await balances(setup, 18);
    const candidates = await controlled.reservation.listAllocationCandidates({
      reservationId: reservation.id, requestedQuantity: 2
    });
    assert.deepEqual(candidates.items.map(({ balanceId }) => balanceId), current.map(({ id }) => id));
    const later = (eventId, overrideReason) => command("allocation.create", 18, eventId, {
      reservationId: reservation.id, expectedVersion: reservation.version,
      allocations: [{ balanceId: current[1].id, expectedVersion: current[1].version, quantity: 2 }],
      ...(overrideReason ? { overrideReason } : {})
    });
    const before = await snapshot(setup, 18);
    await assert.rejects(() => controlled.reservation.allocate(later("no-reason-18")),
      (error) => error.code === "FEFO_OVERRIDE_REQUIRED");
    await assert.rejects(() => controlled.reservation.allocate(later("no-permission-18", "Later eligible lot requested")),
      (error) => error.code === "FEFO_OVERRIDE_DENIED");
    assert.deepEqual(await snapshot(setup, 18), before);

    await setup.execute(`INSERT INTO role_permissions (role_id, permission_id)
      SELECT 1, id FROM permissions WHERE name = 'inventory.fefo.override'`);
    const authorized = later("authorized-18", "Later eligible lot requested");
    authorized.actor.claimedPermissions.push("inventory.fefo.override");
    const allocation = await controlled.reservation.allocate(authorized);
    assert.equal(allocation.allocations[0].isSequenceOverride, true);
    const [[saved]] = await setup.query(
      "SELECT override_reason FROM inventory_allocations WHERE reservation_id = ?", [reservation.id]);
    assert.equal(saved.override_reason, "Later eligible lot requested");
    const [[audit]] = await setup.query(
      "SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action = 'allocation.create'");
    assert.ok(Number(audit.count) >= 1);

    await setup.execute(`DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = 1 AND p.name = 'inventory.fefo.override'`);
    const stale = command("allocation.create", 18, "stale-after-revoke-18", {
      reservationId: reservation.id, expectedVersion: allocation.version,
      allocations: [{ balanceId: current[0].id, expectedVersion: current[0].version, quantity: 1 }]
    });
    stale.actor.claimedPermissions.push("inventory.fefo.override");
    const beforeRevoked = await snapshot(setup, 18);
    await assert.rejects(() => controlled.reservation.allocate(stale),
      (error) => error.code === "PERMISSION_STALE");
    assert.deepEqual(await snapshot(setup, 18), beforeRevoked);

    await setup.execute("UPDATE inventory_lots SET expiry_date = '2026-10-01' WHERE id = 191");
    const filtered = await controlled.reservation.create(command("reservation.create", 19,
      "reserve-19", { skuId: 19, warehouseId: 9, quantity: 4,
        purpose: "SALE", minimumRemainingDays: 30 }));
    const stock = await balances(setup, 19);
    const eligible = await controlled.reservation.listAllocationCandidates({
      reservationId: filtered.id, requestedQuantity: 1
    });
    assert.deepEqual(eligible.items.map(({ balanceId }) => balanceId), [stock[1].id]);
    const invalidLine = (eventId, balance) => command("allocation.create", 19, eventId, {
      reservationId: filtered.id, expectedVersion: filtered.version,
      allocations: [{ balanceId: balance.id, expectedVersion: balance.version, quantity: 1 }]
    });
    const beforeInvalid = await snapshot(setup, 19);
    await assert.rejects(() => controlled.reservation.allocate(invalidLine("short-life-19", stock[0])),
      (error) => error.code === "ALLOCATION_INSUFFICIENT");
    await setup.execute("UPDATE inventory_lots SET expiry_date = '2026-09-27' WHERE id = 191");
    await assert.rejects(() => controlled.reservation.allocate(invalidLine("expired-19", stock[0])),
      (error) => error.code === "ALLOCATION_INSUFFICIENT");
    await setup.execute("UPDATE inventory_stock_balances SET stock_status = 'QUARANTINED' WHERE id = ?", [stock[1].id]);
    await assert.rejects(() => controlled.reservation.allocate(invalidLine("quarantined-19", stock[1])),
      (error) => error.code === "ALLOCATION_INSUFFICIENT");
    await setup.execute("UPDATE inventory_stock_balances SET stock_status = 'AVAILABLE' WHERE id = ?", [stock[1].id]);
    await setup.execute("UPDATE inventory_bins SET status = 'INACTIVE' WHERE id = 29");
    await assert.rejects(() => controlled.reservation.allocate(invalidLine("inactive-bin-19", stock[1])),
      (error) => error.code === "ALLOCATION_INSUFFICIENT");
    assert.deepEqual(await snapshot(setup, 19), beforeInvalid);
    await setup.execute("UPDATE inventory_bins SET status = 'ACTIVE' WHERE id = 29");
    const normal = await controlled.reservation.allocate(invalidLine("normal-19", stock[1]));
    assert.equal(normal.allocations[0].isSequenceOverride, false);
    const [[normalRow]] = await setup.query(
      "SELECT outstanding_quantity FROM inventory_allocations WHERE reservation_id = ?", [filtered.id]);
    assert.equal(Number(normalRow.outstanding_quantity), 1);
  });
});
