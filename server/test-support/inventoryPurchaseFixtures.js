import { MySqlDatabaseService } from "../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../src/services/context/RequestContextService.js";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createMySqlDatabasePool } from "../src/services/mysqldatabase/connection.js";

export function purchaseReceiptCommand() {
  return {
    actor: { userId: 7, serviceName: "", claimedRoles: ["receiver"],
      claimedPermissions: ["purchasing.view", "receiving.operation"] },
    correlationId: "purchase-test-1",
    source: { documentId: "42", eventId: "11111111-1111-4111-8111-111111111111" },
    lines: [{ sourceLineId: "81", skuId: 12, baseQuantity: 3, warehouseId: 1, binId: 2,
      lotNumber: null, expiryDate: null, manufactureDate: null, stockStatus: "AVAILABLE",
      commitment: { purchaseOrderId: 5, purchaseOrderLineId: 6, confirmedVersion: 2, skuId: 12,
        inventoryTrackedSnapshot: true, trackingPolicySnapshot: "none", baseUomIdSnapshot: 4,
        baseUomCodeSnapshot: "EA", minimumReceiptLifeDaysSnapshot: null, skuExceptionReason: null },
      minimumLifeEvidence: null }]
  };
}

export function purchaseConfirmedLines(command) {
  return command.lines.map(line => {
    const { skuExceptionReason: _reason, ...snapshot } = line.commitment;
    return { sourceLineId: line.sourceLineId, status: "CONFIRMED", ...snapshot };
  });
}

// Actual framework active-transaction branding, mocked SQL transport. Native suites prove real locks/auth.
export async function withPurchaseUnitRequest(work, { isolationLevel = "REPEATABLE READ" } = {}) {
  const command = purchaseReceiptCommand(), queries = [];
  const state = { now: 1_800_000_000_000, status: "active", version: 0, permissions: [...command.actor.claimedPermissions] };
  const auth = { type: "jwt", claims: { sub: "7", roles: command.actor.claimedRoles, permissions: command.actor.claimedPermissions,
    exp: state.now / 1000 + 900, auth_time: state.now / 1000, ver: 0 } };
  const apiRoute = { path: "/api/v1/goods-receipts/:id/confirm", authType: "jwt" };
  const controller = new AbortController();
  const current = { auth, apiRoute, requestId: "request-1", signal: controller.signal, databaseTransaction: null };
  const req = { auth, apiRoute, context: current, method: "POST", input: { params: { id: "42" } },
    requestTimeout: { signal: controller.signal }, requestId: current.requestId };
  const context = { get: () => current, update: values => Object.assign(current, values) };
  const query = async (input) => {
    const sql = typeof input === "string" ? input : input.sql; queries.push(sql);
    if (sql.startsWith("SET TRANSACTION")) return [[]];
    if (sql.includes("FROM users")) return [[{ id: 7, username: "sam", status: state.status }]];
    if (sql.includes("FROM user_roles")) return [[{ role_id: 1, name: "receiver" }]];
    if (sql.includes("FROM role_permissions")) return [state.permissions.map(name => ({ name }))];
    if (sql.includes("FROM fr_token_versions")) return [[{ version: state.version }]];
    throw new Error(`Unexpected unit SQL: ${sql}`);
  };
  const pool = { query, getConnection: async () => ({ query, execute: query,
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, destroy() {} }) };
  const database = new MySqlDatabaseService({ pool, context,
    config: { queryTimeoutMs: 10000, transactionTimeoutMs: 20000, acquireTimeoutMs: 10000, abandonedConnectionAction: "destroy" } });
  const options = { database, time: { nowMs: () => state.now }, sessionMaxAgeSeconds: 86400, clockToleranceSeconds: 0 };
  return database.withTransaction(tx => work({ tx, req, command, options, state, queries, controller,
    confirmedLines: purchaseConfirmedLines(command) }), { isolationLevel });
}

export async function purchaseNativeFixture(t, { fullSchema = false } = {}) {
  if (!/^erp_inventory_purchase_[a-z0-9_]+$/u.test(process.env.DB_NAME ?? "") ||
      !process.env.DB_SOCKET_PATH?.startsWith("/private/tmp/erp-inventory-purchase-")) {
    throw new Error("Purchase native checks require the owned isolated local MySQL runtime");
  }
  const connectionOptions = { socketPath: process.env.DB_SOCKET_PATH, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = await mysql.createConnection(connectionOptions);
  const name = `erp_inventory_purchase_${randomUUID().replaceAll("-", "")}`;
  const resources = {}, beforeCleanup = [];
  t.after(async () => {
    const errors = [];
    for (const close of beforeCleanup) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    for (const close of [() => resources.pool?.end(), () => resources.db?.end()]) {
      try { await close(); } catch (error) { errors.push(error); }
    }
    try {
      const [active] = await admin.query("SELECT ID FROM information_schema.PROCESSLIST WHERE DB = ?", [name]);
      if (active.length) throw new Error("Owned purchase test schema still has active connections");
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } catch (error) { errors.push(error); }
    try { await admin.end(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Purchase native fixture cleanup failed");
  });
  const [[version]] = await admin.query("SELECT VERSION() AS version");
  if (!version.version.startsWith("26.7.0")) throw new Error(`Expected MySQL26.7.0, got ${version.version}`);
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const db = await mysql.createConnection({ ...connectionOptions, database: name });
  resources.db = db;
  if (fullSchema) await promisify(execFile)(process.execPath, ["server/scripts/migrate.js"], {
    env: { ...process.env, DB_NAME: name }, timeout: 60000, maxBuffer: 1024 * 1024
  });
  for (const migration of fullSchema ? [] : ["0003_add_auth_tables", "0011_create_item_categories", "0012_create_item_brands", "0013_create_item_uoms",
    "0014_create_items", "0015_create_item_skus", "0016_create_item_sku_uoms", "0055_seed_inventory_permissions",
    "0056_create_inventory_operations", "0057_create_inventory_audit", "0058_create_inventory_master", "0059_create_inventory_stock",
    "0060_create_inventory_movements", "0063_create_inventory_reservations", "0100_seed_purchasing_permissions"]) {
    await (await import(`../database/migrations/${migration}.js`)).up(db);
  }
  const jwtSchema = (await readFile(new URL("../database/framework/jwt.sql", import.meta.url), "utf8"))
    .split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  await db.query(jwtSchema);
  const insert = async (sql, values = []) => Number((await db.execute(sql, values))[0].insertId);
  const actorId = await insert("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES('Purchase synthetic','unused',1,1)");
  const roleId = await insert("INSERT INTO roles(name,created_at) VALUES('purchase-synthetic',1)");
  const permissions = ["purchasing.view", "receiving.operation", "receiving.expiry.override"];
  await db.execute("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)", [actorId, roleId]);
  await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN (?,?,?)", [roleId, ...permissions]);
  const categoryId = await insert("INSERT INTO item_categories(name,created_at,updated_at) VALUES('Purchase synthetic',1,1)");
  const brandId = await insert("INSERT INTO item_brands(name,created_at,updated_at) VALUES('Purchase synthetic',1,1)");
  const uomId = await insert("INSERT INTO item_uoms(code,name,created_at,updated_at) VALUES('EA','Each',1,1)");
  const itemId = await insert("INSERT INTO items(name,category_id,brand_id,product_type,status,created_at,updated_at) VALUES('Purchase synthetic',?,?,'variant','active',1,1)", [categoryId, brandId]);
  const skuId = await insert("INSERT INTO item_skus(item_id,sku_code,sku_name,status,purchasable,inventory_tracked,tracking_policy,created_at,updated_at) VALUES(?,'PURCHASE','Purchase synthetic','active',1,1,'none',1,1)", [itemId]);
  await insert("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES(?,?,1,1,1,1)", [skuId, uomId]);
  const warehouseId = await insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES('PURCHASE','purchase','Purchase synthetic',1,1)");
  const binId = await insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'A','a',1,1)", [warehouseId]);
  const time = { nowMs: () => Date.parse("2026-10-23T01:00:00Z"), fileDate: () => "2026-10-23", timestamp: () => "2026-10-23T01:00:00Z" };
  const context = new RequestContextService({ services: { require: () => time } });
  const logger = { async info() {}, async warn() {}, async error() {} };
  const config = { ...connectionOptions, database: name, connectionLimit: 4, waitForConnections: true, queueLimit: 10,
    acquireTimeoutMs: 10000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000, abandonedConnectionAction: "destroy" };
  const pool = createMySqlDatabasePool(config);
  resources.pool = pool;
  const database = new MySqlDatabaseService({ pool, config, context, logger });
  const actor = { userId: actorId, serviceName: "", claimedRoles: ["purchase-synthetic"], claimedPermissions: permissions };
  const command = () => {
    const value = purchaseReceiptCommand(); value.actor = structuredClone(actor); value.source.eventId = randomUUID();
    Object.assign(value.lines[0], { skuId, warehouseId, binId });
    Object.assign(value.lines[0].commitment, { skuId, baseUomIdSnapshot: uomId });
    return value;
  };
  // Trusted request fixture only. Separate auth integration must exercise actual middleware/JWT signatures.
  const withRequest = (input, work, { readOnly = false } = {}) => {
    const auth = { type: "jwt", claims: { sub: String(actorId), roles: actor.claimedRoles, permissions,
      exp: time.nowMs() / 1000 + 900, auth_time: time.nowMs() / 1000, ver: 0 } };
    const apiRoute = { path: "/api/v1/goods-receipts/:id/confirm", authType: "jwt" };
    const current = { auth, apiRoute, requestId: input.correlationId, databaseTransaction: null };
    const req = { auth, apiRoute, context: current, requestId: current.requestId, method: "POST", input: { params: { id: input.source.documentId } } };
    const activeDatabase = readOnly ? new MySqlDatabaseService({ config, context, logger,
      pool: { query: pool.query.bind(pool), async getConnection() {
        const connection = await pool.getConnection(), begin = connection.beginTransaction;
        connection.beginTransaction = function () {
          this.beginTransaction = begin;
          return this.query("START TRANSACTION READ ONLY");
        };
        return connection;
      } } }) : database;
    return context.storage.run(current, () => activeDatabase.withTransaction(tx => work(tx, req)));
  };
  return { db, name, database, time, logger, context, actor, roleId, skuId, uomId, itemId, warehouseId, binId, command, withRequest, insert, beforeCleanup,
    options: { database, time, sessionMaxAgeSeconds: 28800, clockToleranceSeconds: 5 } };
}
