import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createInventoryStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createInventoryMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import { InventoryAuditService } from "../../src/modules/inventory/InventoryAuditService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" &&
  process.env.INVENTORY_POSTING_TESTS === "1" ? test : test.skip;

function config() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task014_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-014 posting test requires a disposable erp_inventory_task014_* schema");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionLimit: 4
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

async function createPrerequisites(connection) {
  await connection.query(`
    CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(190) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE permissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(190) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      created_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_permissions_name (name)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE item_skus (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sku_code VARCHAR(190) NOT NULL,
      sku_name VARCHAR(190) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_skus_code (sku_code)
    ) ENGINE=InnoDB
  `);
  await seedInventoryPermissions(connection);
  await createInventoryOperations(connection);
  await createInventoryAudit(connection);
  await createInventoryMaster(connection);
  await createInventoryStock(connection);
  await createInventoryMovements(connection);
}

function command({ eventId = "posted-1", quantity = 2, payload = {} } = {}) {
  return inventoryCommandFixture({
    actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: { documentId: "receipt-42", eventId },
    correlationId: `request-${eventId}`,
    payload: {
      skuId: 1,
      quantity,
      uomId: 8,
      warehouseId: 1,
      binId: 1,
      stockStatus: "AVAILABLE",
      ...payload
    }
  });
}

function itemLookup(profile = {}) {
  const value = {
    skuId: 1, skuCode: "SKU-1", skuName: "Widget", skuStatus: "active", itemStatus: "active",
    inventoryTracked: true, trackingPolicy: "none", shelfLifeDays: null,
    minimumReceiptLifeDays: 0, minimumSaleLifeDays: 0,
    baseUom: { uomId: 5, uomCode: "EA" }, usable: true, reasons: [],
    ...profile
  };
  return {
    async getInventoryProfileInTransaction() { return structuredClone(value); },
    async resolveUomInTransaction() {
      return { skuId: 1, uomId: 8, uomCode: "CASE", toBaseFactor: 12, isBase: false };
    }
  };
}

integrationTest("TASK-014 posts, replays, conflicts and rolls back against real MySQL 26.7.0", async (t) => {
  const pool = mysql.createPool(config());
  const setup = await pool.getConnection();
  t.after(async () => {
    setup.release();
    await pool.end();
  });
  const [[version]] = await setup.query("SELECT VERSION() AS version");
  assert.equal(version.version, "26.7.0");
  await createPrerequisites(setup);
  await setup.execute("INSERT INTO users (id, username) VALUES (7, 'sam')");
  await setup.execute("INSERT INTO item_skus (id, sku_code, sku_name) VALUES (1, 'SKU-1', 'Widget')");
  await setup.execute(
    `INSERT INTO inventory_warehouses
       (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
     VALUES (1, 'WH-1', 'WH-1', 'Main', 1, 1)`
  );
  await setup.execute(
    `INSERT INTO inventory_bins
       (id, warehouse_id, bin_code, normalized_code, created_at, updated_at)
     VALUES (1, 1, 'A-01', 'A-01', 1, 1)`
  );

  const database = transactionalDatabase(pool);
  const time = { nowMs: () => 1_797_000_000_000, fileDate: () => "2026-12-10" };
  const authorize = async () => ({ username: "sam", permissions: ["inventory.operation"] });
  const audit = new InventoryAuditService({
    database,
    logger: { async error() {} },
    time
  });
  const service = new InventoryPostingService({
    database, time, authorize, audit, itemLookup: itemLookup(),
    createMovementGroupId: () => "11111111-1111-4111-8111-111111111111"
  });

  const first = await service.postReceipt(command());
  const replay = await service.postReceipt(command());
  assert.deepEqual(replay, first);
  assert.equal(first.baseQuantity, 24);
  const [[balance]] = await setup.query(
    "SELECT on_hand_quantity, version FROM inventory_stock_balances WHERE id = ?",
    [first.balance.id]
  );
  assert.deepEqual([Number(balance.on_hand_quantity), Number(balance.version)], [24, 2]);
  const [[counts]] = await setup.query(
    `SELECT
       (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
       (SELECT COUNT(*) FROM inventory_movements) AS movements,
       (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`
  );
  assert.deepEqual([Number(counts.operations), Number(counts.movements), Number(counts.audits)], [1, 1, 1]);

  await assert.rejects(
    () => service.postReceipt(command({ quantity: 3 })),
    (error) => error.code === "INVENTORY_SOURCE_CONFLICT"
  );

  const failing = new InventoryPostingService({
    database, time, authorize, itemLookup: itemLookup(),
    audit: { async recordSucceeded() { throw new Error("injected audit failure"); } },
    createMovementGroupId: () => "22222222-2222-4222-8222-222222222222"
  });
  await assert.rejects(
    () => failing.postReceipt(command({ eventId: "posted-2" })),
    /injected audit failure/
  );
  const [[afterFailure]] = await setup.query(
    `SELECT
       (SELECT on_hand_quantity FROM inventory_stock_balances WHERE id = ?) AS quantity,
       (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,
       (SELECT COUNT(*) FROM inventory_movements) AS movements,
       (SELECT COUNT(*) FROM inventory_audit_logs) AS audits`,
    [first.balance.id]
  );
  assert.deepEqual(
    [Number(afterFailure.quantity), Number(afterFailure.operations), Number(afterFailure.movements), Number(afterFailure.audits)],
    [24, 1, 1, 1]
  );
});
