import assert from "node:assert/strict";
import os from "node:os";
import { performance } from "node:perf_hooks";
import test from "node:test";
import mysql from "mysql2/promise";

import { up as seedInventoryPermissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as createInventoryOperations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as createInventoryAudit } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as createInventoryMaster } from "../../database/migrations/0058_create_inventory_master.js";
import { up as createInventoryStock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as createInventoryMovements } from "../../database/migrations/0060_create_inventory_movements.js";
import { InventoryAuditService } from "../../src/modules/inventory/InventoryAuditService.js";
import { InventoryInquiryService } from "../../src/modules/inventory/InventoryInquiryService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.INVENTORY_CORE_TESTS === "1";
const run = enabled ? test : test.skip;
const SKU_COUNT = Number(process.env.INVENTORY_PERFORMANCE_SKU_COUNT || 100_000);
const BUCKET_COUNT = Number(process.env.INVENTORY_PERFORMANCE_BUCKET_COUNT || 500_000);
const MOVEMENT_COUNT = Number(process.env.INVENTORY_PERFORMANCE_MOVEMENT_COUNT || 2_000_000);
const CONCURRENCY = Number(process.env.INVENTORY_PERFORMANCE_CONCURRENCY || 20);
const ROUNDS = Number(process.env.INVENTORY_PERFORMANCE_ROUNDS || 5);
const BUDGET_MS = 2_000;
const MOVEMENT_START_MS = 1_700_000_000_000;
const RECENT_MOVEMENT_FROM = MOVEMENT_START_MS + (SKU_COUNT - 7 * 24 * 60) * 60_000;

function configuration() {
  const database = process.env.DB_NAME;
  if (!/^erp_inventory_task018_[a-z0-9_]+$/u.test(database ?? "")) {
    throw new Error("TASK-018 requires a disposable erp_inventory_task018_* schema");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionLimit: Math.max(CONCURRENCY + 4, 24)
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function metrics(values) {
  return {
    samples: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99)
  };
}

async function timed(work) {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

async function createPrerequisites(connection) {
  await connection.query(`CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, username VARCHAR(190) NOT NULL, PRIMARY KEY (id)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE permissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(190) NOT NULL,
    description VARCHAR(255) NOT NULL DEFAULT '', created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_permissions_name (name)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE item_skus (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, sku_code VARCHAR(190) NOT NULL,
    sku_name VARCHAR(190) NOT NULL, PRIMARY KEY (id), UNIQUE KEY uq_item_skus_code (sku_code)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE item_uoms (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, code VARCHAR(30) NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_item_uoms_code (code)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE item_sku_uoms (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, sku_id BIGINT UNSIGNED NOT NULL,
    uom_id BIGINT UNSIGNED NOT NULL, is_base TINYINT(1) NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_item_sku_uoms_scope (sku_id, uom_id),
    KEY idx_item_sku_uoms_base (sku_id, is_base)
  ) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE item_sku_barcodes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, sku_id BIGINT UNSIGNED NOT NULL,
    normalized_barcode VARCHAR(190) NOT NULL, PRIMARY KEY (id),
    UNIQUE KEY uq_item_sku_barcodes_value (normalized_barcode), KEY idx_item_sku_barcodes_sku (sku_id)
  ) ENGINE=InnoDB`);
  await seedInventoryPermissions(connection);
  await createInventoryOperations(connection);
  await createInventoryAudit(connection);
  await createInventoryMaster(connection);
  await createInventoryStock(connection);
  await createInventoryMovements(connection);
}

async function seedCapacity(connection) {
  assert.equal(SKU_COUNT, 100_000, "TASK-018 evidence must use the approved 100k SKU baseline");
  assert.equal(BUCKET_COUNT, 500_000, "TASK-018 evidence must use the approved 500k bucket baseline");
  assert.equal(MOVEMENT_COUNT, 2_000_000, "TASK-018 evidence must use the approved 2M Movement baseline");
  await connection.query("INSERT INTO users (id, username) VALUES (1, 'inventory-performance')");
  await connection.query("INSERT INTO item_uoms (id, code) VALUES (1, 'EA')");
  await connection.query(`CREATE TABLE inventory_test_digits (n TINYINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB`);
  await connection.query("INSERT INTO inventory_test_digits (n) VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)");
  await connection.query(`CREATE TABLE inventory_test_numbers (
    n INT UNSIGNED NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB AS
  SELECT ones.n + tens.n * 10 + hundreds.n * 100 + thousands.n * 1000 + ten_thousands.n * 10000 AS n
    FROM inventory_test_digits ones
    CROSS JOIN inventory_test_digits tens
    CROSS JOIN inventory_test_digits hundreds
    CROSS JOIN inventory_test_digits thousands
    CROSS JOIN inventory_test_digits ten_thousands`);

  await connection.query(`INSERT INTO item_skus (id, sku_code, sku_name)
    SELECT n + 1, CONCAT('PERF-SKU-', LPAD(n + 1, 6, '0')), CONCAT('Performance SKU ', n + 1)
      FROM inventory_test_numbers WHERE n < ? ORDER BY n`, [SKU_COUNT]);
  await connection.query(`INSERT INTO item_sku_uoms (sku_id, uom_id, is_base)
    SELECT id, 1, 1 FROM item_skus`);
  await connection.query(`INSERT INTO item_sku_barcodes (sku_id, normalized_barcode)
    SELECT id, CONCAT('990', LPAD(id, 9, '0')) FROM item_skus`);
  await connection.query(`INSERT INTO inventory_warehouses
    (id, warehouse_code, normalized_code, warehouse_name, created_at, updated_at)
    SELECT n + 1, CONCAT('WH-', n + 1), CONCAT('WH-', n + 1), CONCAT('Warehouse ', n + 1), 1, 1
      FROM inventory_test_numbers WHERE n < 5`);
  await connection.query(`INSERT INTO inventory_bins
    (id, warehouse_id, bin_code, normalized_code, bin_name, created_at, updated_at)
    SELECT n + 1, FLOOR(n / 200) + 1, CONCAT('BIN-', LPAD(n + 1, 4, '0')),
           CONCAT('BIN-', LPAD(n + 1, 4, '0')), CONCAT('Bin ', n + 1), 1, 1
      FROM inventory_test_numbers WHERE n < 1000`);
  await connection.query(`INSERT INTO inventory_stock_balances
    (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity,
     allocated_quantity, fifo_anchor_date, version, created_at, updated_at)
    SELECT warehouse.n + 1,
           warehouse.n * 200 + MOD(sku.n, 200) + 1,
           sku.n + 1, NULL, 'AVAILABLE', 100, 0, '2026-01-01', 1, 1, 1
      FROM inventory_test_numbers sku
      CROSS JOIN inventory_test_digits warehouse
     WHERE sku.n < ? AND warehouse.n < 5`, [SKU_COUNT]);
  await connection.query(`INSERT INTO inventory_stock_controls
    (warehouse_id, sku_id, reserved_quantity, version, created_at, updated_at)
    SELECT warehouse.n + 1, sku.n + 1, 0, 1, 1, 1
      FROM inventory_test_numbers sku
      CROSS JOIN inventory_test_digits warehouse
     WHERE sku.n < ? AND warehouse.n < 5`, [SKU_COUNT]);
  await connection.query(`INSERT INTO inventory_operation_requests
    (id, command_type, source_module, source_document_type, source_document_id,
     source_line_id, source_event_id, request_hash, result_type, result_id,
     completed_at, actor_user_id, actor_label, request_id, correlation_id, created_at)
    SELECT n + 1, 'RECEIPT_POST', 'PERFORMANCE', 'BASELINE', CONCAT('DOC-', n + 1), '',
           'posted', REPEAT('0', 64), 'movement_group', CONCAT(n + 1), 1, 1,
           'inventory-performance', '', '', 1
      FROM inventory_test_numbers WHERE n < ?`, [SKU_COUNT]);
  await connection.query(`INSERT INTO inventory_movements
    (movement_group_id, operation_request_id, movement_type, location_kind,
     warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity,
     balance_before, balance_after, balance_version_after, reason_category, reason_text,
     sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot,
     lot_number_snapshot, posted_at, posted_by, posted_by_label)
    SELECT CONCAT('00000000-0000-4000-8000-', LPAD(sku.n + 1, 12, '0')),
           sku.n + 1, IF(MOD(copy.n, 2) = 0, 'RECEIPT', 'ADJUSTMENT'), 'BIN',
           MOD(copy.n, 5) + 1,
           MOD(copy.n, 5) * 200 + MOD(sku.n, 200) + 1,
           sku.n + 1, NULL, 'AVAILABLE', 'IN', 1, 99, 100, 1, '', '',
           CONCAT('PERF-SKU-', LPAD(sku.n + 1, 6, '0')),
           CONCAT('Performance SKU ', sku.n + 1),
           CONCAT('WH-', MOD(copy.n, 5) + 1),
           CONCAT('BIN-', LPAD(MOD(copy.n, 5) * 200 + MOD(sku.n, 200) + 1, 4, '0')),
           '', ? + sku.n * 60000 + copy.n, 1, 'inventory-performance'
      FROM inventory_test_numbers sku
      CROSS JOIN inventory_test_numbers copy
     WHERE sku.n < ? AND copy.n < 20`, [MOVEMENT_START_MS, SKU_COUNT]);
  await connection.query("ANALYZE TABLE item_skus, item_sku_barcodes, inventory_stock_balances, inventory_movements");
}

async function explain(connection, sql, params) {
  const [rows] = await connection.query(`EXPLAIN FORMAT=TRADITIONAL ${sql}`, params);
  return rows.map((row) => ({
    table: row.table,
    type: row.type,
    key: row.key,
    rows: Number(row.rows),
    extra: row.Extra
  }));
}

function assertLargeTableIndexed(label, plan, table) {
  const row = plan.find((entry) => entry.table === table);
  assert.ok(row, `${label} plan must include ${table}`);
  assert.notEqual(row.type, "ALL", `${label} must not full-scan ${table}: ${JSON.stringify(row)}`);
  assert.ok(row.key, `${label} must use an index for ${table}: ${JSON.stringify(row)}`);
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

function receipt(eventId, quantity = 1) {
  return inventoryCommandFixture({
    actor: { userId: 1, claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: { module: "TASK018", documentType: "CONCURRENCY", documentId: "DOC-1", eventId },
    correlationId: `request-${eventId}`,
    payload: { skuId: 1, quantity, uomId: 1, warehouseId: 1, binId: 1, stockStatus: "AVAILABLE" }
  });
}

function postingService(database, suffix = "1") {
  const time = { nowMs: () => 1_797_000_100_000, fileDate: () => "2026-12-10" };
  return new InventoryPostingService({
    database,
    time,
    authorize: async () => ({ username: "inventory-performance", permissions: ["inventory.operation"] }),
    itemLookup: {
      async getInventoryProfileInTransaction() {
        return {
          skuId: 1, skuCode: "PERF-SKU-000001", skuName: "Performance SKU 1",
          skuStatus: "active", itemStatus: "active", inventoryTracked: true,
          trackingPolicy: "none", minimumReceiptLifeDays: 0,
          baseUom: { uomId: 1, uomCode: "EA" }, usable: true, reasons: []
        };
      },
      async resolveUomInTransaction() {
        return { skuId: 1, uomId: 1, uomCode: "EA", toBaseFactor: 1, isBase: true };
      }
    },
    audit: new InventoryAuditService({ database, logger: { async error() {} }, time }),
    createMovementGroupId: () => `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`
  });
}

run("TASK-018 Core Stock capacity, query-plan and two-connection concurrency gate", { timeout: 45 * 60 * 1000 }, async (t) => {
  const pool = mysql.createPool(configuration());
  const setup = await pool.getConnection();
  t.after(async () => {
    setup.release();
    await pool.end();
  });
  const [[version]] = await setup.query("SELECT VERSION() AS version");
  assert.equal(version.version, "26.7.0");
  await createPrerequisites(setup);

  const seedStarted = performance.now();
  await seedCapacity(setup);
  const seedMs = performance.now() - seedStarted;
  const [[counts]] = await setup.query(`SELECT
    (SELECT COUNT(*) FROM item_skus) AS skus,
    (SELECT COUNT(*) FROM inventory_stock_balances) AS buckets,
    (SELECT COUNT(*) FROM inventory_movements) AS movements`);
  assert.deepEqual([Number(counts.skus), Number(counts.buckets), Number(counts.movements)], [SKU_COUNT, BUCKET_COUNT, MOVEMENT_COUNT]);

  const sampleSkuId = 50_001;
  const sampleSkuCode = "PERF-SKU-050001";
  const sampleBarcode = "990000050001";
  const plans = {
    exactSku: await explain(setup, "SELECT id FROM item_skus WHERE sku_code = ?", [sampleSkuCode]),
    exactBarcode: await explain(setup, "SELECT sku_id FROM item_sku_barcodes WHERE normalized_barcode = ?", [sampleBarcode]),
    stockSummary: await explain(setup, "SELECT SUM(on_hand_quantity) FROM inventory_stock_balances WHERE warehouse_id = ? AND sku_id = ?", [3, sampleSkuId]),
    bucketDrillDown: await explain(setup, "SELECT id FROM inventory_stock_balances WHERE warehouse_id = ? AND sku_id = ? AND stock_status = 'AVAILABLE' ORDER BY bin_id, id LIMIT 20", [3, sampleSkuId]),
    movementFilter: await explain(setup, "SELECT id FROM inventory_movements WHERE warehouse_id = ? AND posted_at >= ? ORDER BY posted_at DESC, id DESC LIMIT 20", [3, RECENT_MOVEMENT_FROM])
  };
  assertLargeTableIndexed("exact SKU", plans.exactSku, "item_skus");
  assertLargeTableIndexed("exact barcode", plans.exactBarcode, "item_sku_barcodes");
  assertLargeTableIndexed("stock summary", plans.stockSummary, "inventory_stock_balances");
  assertLargeTableIndexed("bucket drill-down", plans.bucketDrillDown, "inventory_stock_balances");
  assertLargeTableIndexed("Movement common filter", plans.movementFilter, "inventory_movements");

  const inquiry = new InventoryInquiryService({ database: pool, time: { fileDate: () => "2026-12-10" } });
  const aggregate = await inquiry.listStockAggregates({ q: sampleSkuCode, page: 1, pageSize: 20 });
  const buckets = await inquiry.listStocks({ warehouseId: 3, skuId: sampleSkuId, page: 1, pageSize: 20 });
  const movements = await inquiry.listMovements({ warehouseId: 3, postedFrom: RECENT_MOVEMENT_FROM, page: 1, pageSize: 20 });
  assert.deepEqual([aggregate.total, aggregate.items.length], [1, 1]);
  assert.deepEqual([buckets.total, buckets.items.length], [1, 1]);
  assert.deepEqual([movements.total, movements.items.length], [40_320, 20]);
  const timings = { exactSku: [], exactBarcode: [], stockSummary: [], bucketDrillDown: [], movementFilter: [] };
  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, worker) => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const skuId = 1 + ((worker * ROUNDS + round) * 997) % SKU_COUNT;
      const skuCode = `PERF-SKU-${String(skuId).padStart(6, "0")}`;
      const barcode = `990${String(skuId).padStart(9, "0")}`;
      timings.exactSku.push(await timed(() => pool.query("SELECT id FROM item_skus WHERE sku_code = ?", [skuCode])));
      timings.exactBarcode.push(await timed(() => pool.query("SELECT sku_id FROM item_sku_barcodes WHERE normalized_barcode = ?", [barcode])));
      timings.stockSummary.push(await timed(() => inquiry.getStockSummary({ warehouseId: 3, skuId })));
      timings.bucketDrillDown.push(await timed(() => inquiry.listStocks({ warehouseId: 3, skuId, page: 1, pageSize: 20 })));
      timings.movementFilter.push(await timed(() => inquiry.listMovements({ warehouseId: 3, postedFrom: RECENT_MOVEMENT_FROM, page: 1, pageSize: 20 })));
    }
  }));
  const latencyMs = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, metrics(values)]));
  console.log(JSON.stringify({ stage: "latency", latencyMs }));
  for (const [name, result] of Object.entries(latencyMs)) {
    assert.ok(result.p95 < BUDGET_MS, `${name} p95 ${result.p95.toFixed(1)}ms exceeds ${BUDGET_MS}ms`);
  }

  const database = transactionalDatabase(pool);
  const sameSource = await Promise.allSettled([
    postingService(database, "1").postReceipt(receipt("same-source")),
    postingService(database, "2").postReceipt(receipt("same-source"))
  ]);
  const fulfilled = sameSource.filter(({ status }) => status === "fulfilled");
  const rejected = sameSource.filter(({ status }) => status === "rejected");
  assert.ok(fulfilled.length >= 1);
  assert.ok(rejected.every(({ reason }) => reason.code === "CONCURRENT_OPERATION"));
  if (fulfilled.length === 2) assert.deepEqual(fulfilled[0].value, fulfilled[1].value);
  const [[sameSourceCount]] = await setup.query(`SELECT COUNT(*) AS total FROM inventory_operation_requests
    WHERE source_module = 'TASK018' AND source_event_id = 'same-source'`);
  const [[sameSourceMovements]] = await setup.query(`SELECT COUNT(*) AS total FROM inventory_movements m
    JOIN inventory_operation_requests o ON o.id = m.operation_request_id
    WHERE o.source_module = 'TASK018' AND o.source_event_id = 'same-source'`);
  assert.deepEqual([Number(sameSourceCount.total), Number(sameSourceMovements.total)], [1, 1]);

  const [[targetBalance]] = await setup.query(`SELECT id, on_hand_quantity
    FROM inventory_stock_balances
    WHERE warehouse_id = 1 AND bin_id = 1 AND sku_id = 1 AND lot_scope = 0 AND stock_status = 'AVAILABLE'`);
  assert.ok(targetBalance?.id);
  const quantityBeforeTimeout = Number(targetBalance.on_hand_quantity);
  const locker = await pool.getConnection();
  const blocked = await pool.getConnection();
  try {
    await locker.beginTransaction();
    await locker.query("SELECT id FROM inventory_stock_balances WHERE id = ? FOR UPDATE", [targetBalance.id]);
    await blocked.query("SET SESSION innodb_lock_wait_timeout = 1");
    const blockedDatabase = {
      query: blocked.query.bind(blocked),
      async withTransaction(work) {
        await blocked.beginTransaction();
        try {
          const result = await work(blocked);
          await blocked.commit();
          return result;
        } catch (error) {
          await blocked.rollback();
          throw error;
        }
      }
    };
    await assert.rejects(
      () => postingService(blockedDatabase, "3").postReceipt(receipt("lock-timeout")),
      (error) => error.code === "CONCURRENT_OPERATION"
    );
  } finally {
    await locker.rollback();
    locker.release();
    blocked.release();
  }
  const [[afterTimeout]] = await setup.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE id = ?", [targetBalance.id]);
  const [[timeoutEffects]] = await setup.query(`SELECT
    (SELECT COUNT(*) FROM inventory_operation_requests WHERE source_module = 'TASK018' AND source_event_id = 'lock-timeout') AS operations,
    (SELECT COUNT(*) FROM inventory_movements m JOIN inventory_operation_requests o ON o.id = m.operation_request_id
      WHERE o.source_module = 'TASK018' AND o.source_event_id = 'lock-timeout') AS movements`);
  assert.equal(Number(afterTimeout.on_hand_quantity), quantityBeforeTimeout);
  assert.deepEqual([Number(timeoutEffects.operations), Number(timeoutEffects.movements)], [0, 0]);

  console.log(JSON.stringify({
    task: "TASK-018",
    fixtureVersion: "inventory-core-capacity-v1",
    data: { warehouses: 5, bins: 1000, skus: SKU_COUNT, buckets: BUCKET_COUNT, movements: MOVEMENT_COUNT },
    load: { concurrency: CONCURRENCY, roundsPerWorker: ROUNDS },
    environment: { node: process.version, mysql: version.version, logicalCpu: os.cpus().length, memoryBytes: os.totalmem() },
    seedMs,
    latencyMs,
    plans,
    concurrency: { sameSourceOperations: 1, sameSourceMovements: 1, timeoutPartialEffects: 0 }
  }));
});
