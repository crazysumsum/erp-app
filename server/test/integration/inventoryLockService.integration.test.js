import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { InventoryLockService } from "../../src/modules/inventory/InventoryLockService.js";

const integrationTest = process.env.INVENTORY_LOCK_SMOKE_TESTS === "1" ? test : test.skip;

function config() {
  if (!process.env.DB_NAME?.startsWith("erp_inventory_task007_")) {
    throw new Error("Inventory lock smoke test requires a dedicated TASK-007 database");
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

integrationTest("TASK-007 maps contention between two real MySQL connections", async (t) => {
  const setup = await mysql.createConnection(config());
  const holder = await mysql.createConnection(config());
  const waiter = await mysql.createConnection(config());
  t.after(async () => Promise.all([setup.end(), holder.end(), waiter.end()]));

  await setup.query(`
    CREATE TABLE inventory_warehouses (
      id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(20) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);
  await setup.execute("INSERT INTO inventory_warehouses (id, status) VALUES (?, ?)", [1, "ACTIVE"]);

  const service = new InventoryLockService();
  await holder.beginTransaction();
  await waiter.beginTransaction();
  await waiter.query("SET SESSION innodb_lock_wait_timeout = 1");
  await service.lockForCommand(holder, { warehouseIds: [1] });

  try {
    await assert.rejects(
      () => service.lockForCommand(waiter, { warehouseIds: [1] }),
      (error) => error.code === "CONCURRENT_OPERATION"
    );
  } finally {
    await Promise.all([holder.rollback(), waiter.rollback()]);
  }
});
