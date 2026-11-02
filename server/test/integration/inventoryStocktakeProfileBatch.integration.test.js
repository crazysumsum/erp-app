import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import test, { before, after } from "node:test";
import mysql from "mysql2/promise";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { up as permissions } from "../../database/migrations/0055_seed_inventory_permissions.js";
import { up as operations } from "../../database/migrations/0056_create_inventory_operations.js";
import { up as auditMigration } from "../../database/migrations/0057_create_inventory_audit.js";
import { up as master } from "../../database/migrations/0058_create_inventory_master.js";
import { up as stock } from "../../database/migrations/0059_create_inventory_stock.js";
import { up as movements } from "../../database/migrations/0060_create_inventory_movements.js";
import { up as reservations } from "../../database/migrations/0063_create_inventory_reservations.js";
import { up as transfers } from "../../database/migrations/0064_create_inventory_transfers.js";
import { up as stocktakes } from "../../database/migrations/0065_create_inventory_stocktakes.js";
import { InventoryStocktakeService, toStocktakeInventoryProfile } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { InventoryOperationService, inventoryOperationHash } from "../../src/modules/inventory/InventoryOperationService.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { inventoryCommandFixture } from "../../test-support/inventoryFixtures.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_PROFILE_BATCH_TESTS === "1";
const integrationTest = (name, work) => test(name, { skip: !enabled, timeout: 120000, concurrency: false }, work);
const NOW = 1791763200000, time = { nowMs: () => NOW, fileDate: () => "2026-10-12" }, logger = { error() {} };
const counterPermissions = ["inventory.view", "inventory.operation"], postPermissions = ["inventory.view", "inventory.adjust"];
const binding = { id: 5, user_id: 8, device_id: "a".repeat(64), public_key: Buffer.from("synthetic-public-key"), status: "approved" };
const businessTables = ["inventory_warehouses", "inventory_bins", "inventory_stocktakes", "inventory_stocktake_bins", "inventory_bin_locks",
  "inventory_stocktake_lines", "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements",
  "inventory_reservations", "inventory_allocations", "inventory_transfers", "inventory_transfer_lines", "inventory_operation_requests", "inventory_audit_logs"];
let pool, database, service, sentinel, nextSku = 100;
const number = value => value === null ? null : Number(value);
const json = value => typeof value === "string" ? JSON.parse(value) : value;
const dimension = row => [number(row.warehouse_id ?? 1), number(row.bin_id), number(row.sku_id), number(row.lot_id) ?? 0, row.stock_status].join(":");

// Production deadlines remain active while SQL, hooks, and COMMIT are in flight.
// The adapter only observes the borrowed native connection; it does not implement aborts.
const databaseContext = new RequestContextService({ config: {}, services: { require: () => time } });
function reportFailures(primary, failures = []) {
  const additional = failures.filter(error => error && error !== primary);
  if (primary) {
    try { if (additional.length) primary.cleanupErrors = [...(primary.cleanupErrors ?? []), ...additional]; }
    catch { /* Preserve the original failure even if its error object cannot accept diagnostics. */ }
    throw primary;
  }
  if (additional.length) reportFailures(additional[0], additional.slice(1));
}
async function finishParticipants(primary, participants, restorations = []) {
  const outcomes = await Promise.allSettled(participants.filter(Boolean));
  const results = outcomes.map(result => result.status === "fulfilled" ? result.value : { error: result.reason });
  const failures = [];
  for (const restore of restorations) {
    try { await restore(); } catch (error) { failures.push(error); }
  }
  if (primary) reportFailures(primary, [...results.map(result => result.error), ...failures]);
  if (failures.length) reportFailures(results.find(result => result.error)?.error, failures);
  return results;
}
async function disconnectedTerminal(record, connection) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [[state]] = await pool.query({ sql: `SELECT
      (SELECT COUNT(*) FROM performance_schema.threads WHERE PROCESSLIST_ID=?) AS connections,
      (SELECT COUNT(*) FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?) AS transactions`, timeout: 1000 },
    [record.connectionId, record.connectionId]);
    record.disconnectObservation = { connections: Number(state.connections), transactions: Number(state.transactions), socketClosed: record.socketClosed === true };
    if (Number(state.connections) === 0 && Number(state.transactions) === 0 &&
        record.socketClosed === true && connection.connection.stream.destroyed === true && record.nativeCalls.every(call => call.settled)) {
      record.terminal = true; record.terminalEvidence = "NATIVE_DISCONNECT_AND_NO_TRANSACTION"; return;
    }
    await new Promise(resolve => { setTimeout(resolve, 10); });
  }
  assert.fail("Destroyed native socket, raw callbacks, connection and transaction did not all reach terminal");
}
function transactionDatabase(hooks = {}) {
  const observation = { transactions: [], calls: [], waits: [], injections: [], acquisitions: [] };
  const db = { observation, query() { throw new Error("Profile escaped the caller transaction"); },
    getConnection() { throw new Error("Profile acquired an independent connection"); },
    async withTransaction(work) {
      let connection, record, callbackTask, acquisitionTask, result, primary;
      const acquisition = { settled: false }; observation.acquisitions.push(acquisition);
      const borrowedPool = {
        query: (...args) => pool.query(...args),
        getConnection() {
          acquisitionTask = (async () => {
            connection = await pool.getConnection();
            let handedOff = false, acquireError;
            try {
              record = { connectionId: Number(connection.threadId), outcome: null, callbackSettled: false,
                terminal: false, released: false, destroyed: false, startedAt: Date.now(), nativeCalls: [] };
              observation.transactions.push(record);
              function raw(method, args) {
                const call = { method, settled: false }; record.nativeCalls.push(call);
                const pending = Promise.resolve().then(() => connection[method](...args));
                void pending.then(() => { call.settled = true; }, () => { call.settled = true; });
                return pending;
              }
              const wrapper = {
                query: (...args) => raw("query", args),
                execute: (...args) => raw("execute", args),
                async beginTransaction() {
                  try {
                    const [[identity]] = await raw("query", [{ sql: hooks.identityQuery ?? "SELECT CONNECTION_ID() AS id", timeout: 1000 }]);
                    assert.equal(Number(identity.id), record.connectionId); assert.ok(record.connectionId > 0);
                    record.nativeIdentityBeforeBegin = true;
                    await raw("beginTransaction", []); record.begun = true;
                  } catch (error) {
                    const failures = [];
                    try { wrapper.destroy(); } catch (cleanupError) { failures.push(cleanupError); }
                    reportFailures(error, failures);
                  }
                },
                async commit() {
                  record.commitAttempted = true; await raw("commit", []);
                  record.callbackSettled = true; record.outcome = "COMMITTED";
                },
                async rollback() {
                  await raw("rollback", []); record.callbackSettled = true; record.outcome = "ROLLED_BACK";
                },
                destroy() {
                  if (record.destroyed) return;
                  connection.connection.stream.once("close", () => { record.socketClosed = true; });
                  connection.destroy(); record.destroyed = true;
                },
                release() {
                  record.releaseRequested = true;
                  if (!record.begun && !record.destroyed) { connection.release(); record.released = true; }
                }
              };
              handedOff = true; return wrapper;
            } catch (error) { acquireError = error; throw error; }
            finally {
              if (!handedOff) {
                const failures = [];
                try { connection.release(); if (record) record.released = true; }
                catch (error) { failures.push(error); }
                reportFailures(acquireError, failures);
              }
            }
          })();
          void acquisitionTask.then(() => { acquisition.settled = true; }, error => { acquisition.settled = true; acquisition.error = error; });
          return acquisitionTask;
        }
      };
      const managed = new MySqlDatabaseService({ pool: borrowedPool, context: databaseContext, logger,
        config: { acquireTimeoutMs: 1000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000, abandonedConnectionAction: "destroy" } });
      try {
        result = await databaseContext.storage.run({ requestId: observation.requestId ?? null }, () => managed.withTransaction(nativeTx => {
          callbackTask = (async () => {
            const [[identity]] = await nativeTx.query("SELECT CONNECTION_ID() AS id");
            assert.equal(Number(identity.id), record.connectionId); assert.ok(record.connectionId > 0);
            const tx = { query: (sql, params = []) => dispatch("query", sql, params),
              execute: (sql, params = []) => dispatch("execute", sql, params) };
            async function dispatch(method, sql, params) {
              const call = { method, sql: String(sql), params: [...params], connectionId: record.connectionId, executed: false, settled: false };
              observation.calls.push(call);
              const context = { sql: call.sql, params, connection: nativeTx, tx, record, call, observation };
              try {
                await hooks[method === "query" ? "beforeQuery" : "beforeExecute"]?.(context);
                call.executed = true; const nativeStarted = Date.now();
                let value;
                try { value = await nativeTx[method](sql, params); }
                finally { call.nativeElapsedMs = Date.now() - nativeStarted; }
                call.affectedRows = value[0]?.affectedRows;
                return await hooks[method === "query" ? "afterQuery" : "afterExecute"]?.({ ...context, result: value }) ?? value;
              } finally { call.settled = true; }
            }
            return work(tx);
          })();
          return callbackTask;
        }));
      } catch (error) { primary = error; }
      const failures = [];
      if (acquisitionTask && !acquisition.settled) {
        let timer;
        try {
          const drained = await Promise.race([capture(acquisitionTask), new Promise(resolve => {
            timer = setTimeout(() => resolve({ unknown: true }), 1000);
          })]);
          acquisition.cleanup = drained.unknown ? "UNKNOWN" : "DRAINED";
          if (drained.unknown) failures.push(new Error("Acquisition cleanup UNKNOWN; production retains the pending late-release handler"));
          if (drained.error && drained.error !== primary) failures.push(drained.error);
        } finally { clearTimeout(timer); }
      }
      // MySqlDatabaseService can reject on abort before its callback unwinds; join that callback too.
      if (callbackTask) {
        const callback = await capture(callbackTask);
        if (callback.error && callback.error !== primary) failures.push(callback.error);
      }
      if (record && !record.released) {
        try {
          if (record.destroyed) {
            record.outcome ??= record.commitAttempted ? "INDETERMINATE" : "DISCONNECTED";
            await disconnectedTerminal(record, connection);
          } else {
            assert.equal(record.callbackSettled, true, "Native commit/rollback callback must settle before reconciliation");
            const [[identity]] = await connection.query({ sql: "SELECT CONNECTION_ID() AS id", timeout: 1000 });
            assert.equal(Number(identity.id), record.connectionId);
            const [[terminal]] = await connection.query({ sql: "SELECT COUNT(*) AS remaining FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?", timeout: 1000 }, [record.connectionId]);
            assert.equal(Number(terminal.remaining), 0, "Await native transaction terminal before row reconciliation");
            record.terminal = true; record.terminalEvidence = "SAME_CONNECTION_AFTER_NATIVE_CALLBACK";
          }
          assert.ok(observation.calls.every(call => call.settled));
          assert.ok(record.nativeCalls.every(call => call.settled), "Every raw driver promise must settle before row reconciliation");
          record.elapsedMs = Date.now() - record.startedAt;
        } catch (error) { failures.push(error); }
        try {
          if (record.terminal && !record.destroyed) connection.release();
          else if (!record.destroyed) { connection.destroy(); record.destroyed = true; await disconnectedTerminal(record, connection); }
        } catch (error) { failures.push(error); }
        record.released = true;
      }
      reportFailures(primary, failures);
      return result;
    } };
  return db;
}
function settled(db, outcome) {
  assert.equal(db.observation.transactions.length, 1, "No nested transaction, retry or partial commit");
  const record = db.observation.transactions[0];
  assert.equal(record.outcome, outcome); assert.equal(record.callbackSettled, true); assert.equal(record.terminal, true); assert.equal(record.released, true);
  assert.ok(record.elapsedMs <= 20000);
  assert.ok(db.observation.calls.every(call => call.settled));
}
before(async () => {
  if (!enabled) return;
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET ?? "", /^\/private\/tmp\/erp-inventory-task041-[a-z0-9-]+-mysql-2670\.[A-Za-z0-9_-]+\/mysql\.sock$/u);
  pool = mysql.createPool({ user: "root", database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET, connectionLimit: 4, dateStrings: true });
  const [[environment]] = await pool.query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated");
  assert.equal(environment.version, "26.7.0"); assert.equal(environment.schema_name, process.env.DB_NAME); assert.equal(Number(environment.isolated), 1);
  assert.equal((await pool.query("SHOW TABLES"))[0].length, 0, "Require a fresh owned schema; never erase an existing schema");
  // Native regression for the pre-BEGIN timeout: callback settlement alone is not SQL terminal.
  const timeoutDb = transactionDatabase({ identityQuery: "SELECT CONNECTION_ID() AS id,SLEEP(3) AS delay" });
  const timeout = await capture(timeoutDb.withTransaction(() => assert.fail("Identity timeout cannot enter business work")));
  assert.equal(timeout.error?.code, "DATABASE_TRANSACTION_FAILED");
  assert.equal(timeout.error.cause?.code, "PROTOCOL_SEQUENCE_TIMEOUT");
  assert.equal(timeout.error.cleanupErrors, undefined);
  const timedOut = timeoutDb.observation.transactions[0];
  assert.equal(timedOut.begun, undefined); assert.equal(timedOut.destroyed, true);
  assert.equal(timedOut.socketClosed, true); assert.equal(timedOut.terminal, true); assert.equal(timedOut.released, true);
  assert.ok(timedOut.nativeCalls.every(call => call.settled));
  assert.equal(timedOut.terminalEvidence, "NATIVE_DISCONNECT_AND_NO_TRANSACTION");
  console.log(JSON.stringify({ kind: "NATIVE_PRE_BEGIN_TIMEOUT_TERMINAL", record: timedOut }));
  // Minimal Item/authorization tables are the established TASK038 fixture schema.
  for (const ddl of [
    "CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY,username VARCHAR(190),status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(190)) ENGINE=InnoDB",
    "CREATE TABLE user_roles (user_id BIGINT UNSIGNED,role_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE role_permissions (role_id BIGINT UNSIGNED,permission_id BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE permissions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(190) UNIQUE,description VARCHAR(255) DEFAULT '',created_at BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE fr_token_versions (subject VARCHAR(190) PRIMARY KEY,version BIGINT UNSIGNED) ENGINE=InnoDB",
    "CREATE TABLE user_devices (id BIGINT UNSIGNED PRIMARY KEY,user_id BIGINT UNSIGNED,device_id VARCHAR(64),public_key BLOB,status VARCHAR(20)) ENGINE=InnoDB",
    "CREATE TABLE items (id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(190),product_type VARCHAR(20),status VARCHAR(20),version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_skus (id BIGINT UNSIGNED PRIMARY KEY,item_id BIGINT UNSIGNED,sku_code VARCHAR(190),sku_name VARCHAR(190),status VARCHAR(20),
      purchasable BOOLEAN DEFAULT 1,sellable BOOLEAN DEFAULT 1,inventory_tracked BOOLEAN DEFAULT 1,tracking_policy VARCHAR(20),shelf_life_days INT,
      min_receipt_life_days INT,min_sale_life_days INT,effective_from BIGINT UNSIGNED,effective_to BIGINT UNSIGNED,version INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    "CREATE TABLE item_uoms (id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(20),name VARCHAR(100),status VARCHAR(20),version INT UNSIGNED DEFAULT 1) ENGINE=InnoDB",
    `CREATE TABLE item_sku_uoms (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,sku_id BIGINT UNSIGNED,uom_id BIGINT UNSIGNED,to_base_factor INT UNSIGNED,
      is_base BOOLEAN,is_default_purchase BOOLEAN,is_default_sale BOOLEAN,version INT UNSIGNED DEFAULT 1,KEY by_sku (sku_id)) ENGINE=InnoDB`
  ]) await pool.query(ddl);
  // 0061/0062 belong to Supplier imports and are not part of the unchanged Inventory bootstrap.
  for (const migrate of [permissions, operations, auditMigration, master, stock, movements, reservations, transfers, stocktakes]) await migrate(pool);
  await pool.query("INSERT INTO users VALUES (7,'synthetic-counter','active'),(8,'synthetic-approver','active')");
  await pool.query("INSERT INTO roles VALUES (1,'warehouse-operator'),(2,'warehouse-approver')"); await pool.query("INSERT INTO user_roles VALUES (7,1),(8,2)");
  await pool.query("INSERT INTO role_permissions SELECT 1,id FROM permissions WHERE name IN ('inventory.view','inventory.operation')");
  await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.query("INSERT INTO fr_token_versions VALUES ('7',0),('8',0)");
  await pool.execute("INSERT INTO user_devices VALUES (?,?,?,?,?)", [binding.id, binding.user_id, binding.device_id, binding.public_key, binding.status]);
  await pool.query("INSERT INTO items (id,name,product_type,status) VALUES (1,'Synthetic','physical','active')"); await pool.query("INSERT INTO item_uoms (id,code,name,status) VALUES (1,'EA','Each','active'),(2,'CASE','Case','active')");
  await pool.query("INSERT INTO inventory_warehouses (id,warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES (1,'SYN-1','syn-1','Synthetic',1,1)");
  database = transactionDatabase(); service = new InventoryStocktakeService({ database, logger, time });
  sentinel = await readyFixture([{}]); // A real foreign READY document/lock/history survives every tested Post.
});
after(async () => { if (pool) await pool.end(); });
function command(action, payload, eventId = randomUUID()) {
  const high = action === "post";
  return inventoryCommandFixture({ actor: { userId: high ? 8 : 7, claimedRoles: [high ? "warehouse-approver" : "warehouse-operator"], claimedPermissions: high ? postPermissions : counterPermissions },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: high ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "synthetic-task041-profile-batch", eventId }, correlationId: eventId, payload });
}
function capsule(input, clock = time, claims = {}) {
  return issueInventoryHighRiskContext({ method: "POST", apiRoute: { path: "/api/v1/inventory/stocktakes/:id/post", authType: "jwt-device-password" },
    input: { params: { id: String(input.payload.stocktakeId) } }, get: () => String(NOW),
    auth: { type: "jwt-device-password", deviceBinding: binding, claims: { sub: "8", roles: input.actor.claimedRoles, permissions: input.actor.claimedPermissions,
      did: binding.device_id, ver: 0, exp: NOW / 1000 + 900, auth_time: NOW / 1000, ...claims } } }, input,
  { time: clock, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0 });
}
async function bin() {
  const code = randomUUID(); return Number((await pool.execute("INSERT INTO inventory_bins (warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES (1,?,?,1,1)", [code, code]))[0].insertId);
}
async function seedSku(policy = "none", name = "Synthetic") {
  const id = nextSku++;
  await pool.execute("INSERT INTO item_skus (id,item_id,sku_code,sku_name,status,tracking_policy,min_receipt_life_days,min_sale_life_days) VALUES (?,1,?,?,'active',?,90,30)", [id, `SKU-${id}`, name, policy]);
  await pool.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (?,1,1,1,1,1)", [id]);
  await pool.execute("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,created_at,updated_at) VALUES (1,?,1,1)", [id]); return id;
}
async function seedBalance(entry) {
  return Number((await pool.execute(`INSERT INTO inventory_stock_balances
    (warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES (1,?,?,?,?,?,?,1,1)`,
  [entry.bin_id, entry.sku_id, entry.lot_id, entry.stock_status, entry.quantity, entry.quantity ? "2026-01-01" : null]))[0].insertId);
}
async function rows(table, stocktakeId) { return (await pool.execute(`SELECT * FROM ${table} WHERE stocktake_id=? ORDER BY id`, [stocktakeId]))[0]; }
async function snapshot() {
  const state = {}; for (const table of businessTables) state[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`))[0]; return state;
}
function entries(size, extra = {}) { return Array.from({ length: size }, (_, i) => ({ group: i, ...extra })); }
async function readyFixture(input = entries(101), { zero = false, name } = {}) {
  const groups = new Map(), bins = new Map(), lots = new Map(), seeded = [];
  for (const [i, entry] of input.entries()) {
    const group = entry.group ?? i, binGroup = entry.binGroup ?? 0;
    if (!groups.has(group)) groups.set(group, await seedSku(entry.policy ?? (entry.lotKey ? "batch_expiry" : "none"), name));
    if (!bins.has(binGroup)) bins.set(binGroup, await bin());
    const sku_id = groups.get(group), bin_id = bins.get(binGroup); let lot_id = null;
    if (entry.lotKey) {
      const key = `${sku_id}:${entry.lotKey}`;
      if (!lots.has(key)) lots.set(key, Number((await pool.execute(`INSERT INTO inventory_lots
        (sku_id,lot_number,normalized_lot_number,first_receipt_date,manufacture_date,expiry_date,sku_code_snapshot,created_at)
        VALUES (?,?,?,'2020-01-01','2019-01-01',?,?,1)`, [sku_id, entry.lotKey, entry.lotKey, entry.expiry ?? "2027-01-01", `SKU-${sku_id}`]))[0].insertId));
      lot_id = lots.get(key);
    }
    const row = { ...entry, bin_id, sku_id, lot_id, stock_status: entry.status ?? "AVAILABLE", quantity: entry.quantity ?? 4 };
    if (!entry.absent) row.balanceId = await seedBalance(row);
    seeded.push(row);
  }
  const draft = await service.create(command("create", { warehouseId: 1, binIds: [...bins.values()] }));
  let header = await service.start(command("start", { stocktakeId: draft.id, expectedVersion: draft.version }));
  for (const row of seeded.filter(row => row.absent)) await service.addLine(command("add_line", { stocktakeId: header.id, binId: row.bin_id,
    skuId: row.sku_id, lotId: row.lot_id, stockStatus: row.stock_status }));
  let lines = await rows("inventory_stocktake_lines", header.id);
  const byDimension = new Map(seeded.map(row => [dimension(row), row]));
  for (let offset = 0; offset < lines.length; offset += 100) await service.saveCounts(command("count", { stocktakeId: header.id,
    lines: lines.slice(offset, offset + 100).map(row => { const entry = byDimension.get(dimension(row)); assert.ok(entry);
      return { lineId: Number(row.id), expectedVersion: Number(row.version), countedQuantity: zero ? Number(row.snapshot_quantity) : entry.actual ?? 7 }; }) }));
  header = await service.ready(command("ready", { stocktakeId: header.id, expectedVersion: header.version }));
  lines = await rows("inventory_stocktake_lines", header.id); return { header, lines, seeded, groups, bins: [...bins.values()], skuName: name ?? "Synthetic" };
}
function postCommand(f, reason = "synthetic physical reconciliation") {
  return command("post", { stocktakeId: f.header.id, expectedVersion: f.header.version, reason });
}
async function post(f, { db = transactionDatabase(), clock = time, input = postCommand(f), proof = capsule(input, clock) } = {}) {
  db.observation.requestId = input.correlationId;
  const result = await new InventoryStocktakeService({ database: db, logger, time: clock }).post(input, proof); return { result, db, input };
}
async function unchanged(f, db, expected, options = {}) {
  const before = await snapshot(); await assert.rejects(post(f, { ...options, db }), expected);
  settled(db, "ROLLED_BACK"); const after = await snapshot();
  assert.deepEqual(rowHashes(after), rowHashes(before));
  assert.deepEqual(after, before, "Native rollback must restore all 16 business tables and foreign owners");
  const [[header]] = await pool.execute("SELECT status,version FROM inventory_stocktakes WHERE id=?", [f.header.id]);
  assert.equal(header.status, "READY_TO_POST"); assert.equal(Number(header.version), f.header.version);
  assert.ok((await rows("inventory_bin_locks", f.header.id)).every(row => row.released_at === null));
}
function calls(db, pattern) { return db.observation.calls.filter(call => pattern.test(call.sql)); }
function budgets(db) {
  // HD208 bounds apply to mutation batches; Control upsert retains its own 1000-key/4000-bind contract.
  for (const call of calls(db, /(?:INSERT INTO inventory_(?:stock_balances|movements|audit_logs)\b|UPDATE inventory_(?:stock_balances|stocktake_lines)\b)/iu)) {
    assert.ok(call.params.length <= 3200); assert.ok(call.params.filter(value => typeof value === "string").reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0) <= 1048576);
    if (/INSERT INTO inventory_(?:stock_balances|movements|audit_logs)\b/iu.test(call.sql)) assert.ok(Number(call.affectedRows) <= 100);
  }
}
async function succeeds(f, options = {}) {
  const before = await snapshot(), posted = await post(f, options), { result, db, input } = posted;
  settled(db, "COMMITTED"); budgets(db); const after = await snapshot();
  const changed = f.lines.filter(row => Number(row.variance_quantity) !== 0), movementRows = after.inventory_movements.filter(row => Number(row.operation_request_id) === result.operationId);
  const auditRows = after.inventory_audit_logs.filter(row => Number(row.operation_request_id) === result.operationId);
  assert.deepEqual(result, { id: f.header.id, operationId: result.operationId, status: "POSTED", version: f.header.version + 1,
    rowCount: changed.length, movementGroupId: changed.length ? result.movementGroupId : null });
  assert.equal(movementRows.length, changed.length); assert.equal(new Set(movementRows.map(row => Number(row.id))).size, changed.length);
  assert.equal(auditRows.length, changed.length + 1);
  for (const original of f.lines) {
    const row = after.inventory_stocktake_lines.find(row => Number(row.id) === Number(original.id));
    assert.equal(row.stock_balance_id, original.stock_balance_id, "Original snapshot FK remains unchanged, including NULL");
    if (Number(original.variance_quantity) === 0) { assert.deepEqual(row, original); continue; }
    const movement = movementRows.find(movement => Number(movement.id) === Number(row.movement_id)); assert.ok(movement);
    assert.deepEqual([Number(movement.stocktake_id), Number(movement.stocktake_line_id), Number(movement.operation_request_id), movement.movement_group_id,
      Number(movement.warehouse_id), Number(movement.bin_id), Number(movement.sku_id), number(movement.lot_id), movement.stock_status],
    [f.header.id, Number(original.id), result.operationId, result.movementGroupId, 1, Number(original.bin_id), Number(original.sku_id), number(original.lot_id), original.stock_status]);
    const version = Number(original.snapshot_balance_version) || 1;
    assert.deepEqual([movement.movement_type, movement.location_kind, movement.direction, Number(movement.quantity), Number(movement.balance_before),
      Number(movement.balance_after), Number(movement.balance_version_after), movement.reason_text, Number(movement.posted_at), Number(movement.posted_by), movement.posted_by_label],
    ["STOCKTAKE_VARIANCE", "BIN", Number(original.variance_quantity) > 0 ? "IN" : "OUT", Math.abs(Number(original.variance_quantity)), Number(original.snapshot_quantity),
      Number(original.counted_quantity), version + 1, input.payload.reason, NOW, 8, "synthetic-approver"]);
    assert.deepEqual(row, { ...original, movement_id: movement.id, version: Number(original.version) + 1 }, "Only the movement link and line version may change");
    const balance = after.inventory_stock_balances.find(balance => dimension(balance) === dimension(original)); assert.ok(balance);
    assert.equal(Number(balance.on_hand_quantity), Number(original.counted_quantity)); assert.equal(Number(balance.version), version + 1);
    const oldBalance = before.inventory_stock_balances.find(balance => Number(balance.id) === number(original.stock_balance_id));
    assert.equal(Number(balance.allocated_quantity), Number(oldBalance?.allocated_quantity ?? 0));
    const anchor = Number(original.counted_quantity) === 0 ? null : original.lot_id !== null ? oldBalance?.fifo_anchor_date ?? null : Number(original.snapshot_quantity) === 0 ? "2026-10-12" : oldBalance.fifo_anchor_date;
    assert.equal(balance.fifo_anchor_date, anchor);
    if (oldBalance) assert.deepEqual(balance, { ...oldBalance, on_hand_quantity: Number(original.counted_quantity), fifo_anchor_date: anchor, version: version + 1, updated_at: NOW });
    else assert.deepEqual(balance, { id: balance.id, warehouse_id: 1, bin_id: Number(original.bin_id), sku_id: Number(original.sku_id),
      lot_id: number(original.lot_id), lot_scope: number(original.lot_id) ?? 0, stock_status: original.stock_status,
      on_hand_quantity: Number(original.counted_quantity), allocated_quantity: 0, fifo_anchor_date: anchor, version: version + 1,
      created_at: NOW, updated_at: NOW });
    const lot = before.inventory_lots.find(row => Number(row.id) === number(original.lot_id));
    const bin = before.inventory_bins.find(row => Number(row.id) === Number(original.bin_id));
    assert.deepEqual([movement.sku_code_snapshot, movement.sku_name_snapshot, movement.warehouse_code_snapshot, movement.bin_code_snapshot, movement.lot_number_snapshot, movement.expiry_date_snapshot],
      [`SKU-${original.sku_id}`, f.skuNames?.get(Number(original.sku_id)) ?? f.skuName, "SYN-1", bin.bin_code, lot?.lot_number ?? "", lot?.expiry_date ?? null]);
    assert.deepEqual(movement, {
      id: movement.id, movement_group_id: result.movementGroupId, operation_request_id: result.operationId,
      movement_type: "STOCKTAKE_VARIANCE", location_kind: "BIN", warehouse_id: 1,
      bin_id: Number(original.bin_id), sku_id: Number(original.sku_id), lot_id: number(original.lot_id),
      stock_status: original.stock_status, direction: Number(original.variance_quantity) > 0 ? "IN" : "OUT",
      quantity: Math.abs(Number(original.variance_quantity)), balance_before: Number(original.snapshot_quantity),
      balance_after: Number(original.counted_quantity), balance_version_after: version + 1,
      reservation_id: null, allocation_id: null, transfer_id: null, transfer_line_id: null,
      stocktake_id: f.header.id, stocktake_line_id: Number(original.id), reversal_of_movement_id: null,
      reason_category: "", reason_text: input.payload.reason, sku_code_snapshot: `SKU-${original.sku_id}`,
      sku_name_snapshot: f.skuNames?.get(Number(original.sku_id)) ?? f.skuName,
      warehouse_code_snapshot: "SYN-1", bin_code_snapshot: bin.bin_code,
      lot_number_snapshot: lot?.lot_number ?? "", expiry_date_snapshot: lot?.expiry_date ?? null,
      posted_at: NOW, posted_by: 8, posted_by_label: "synthetic-approver"
    });
    const audit = auditRows.find(audit => Number(json(audit.after_summary)?.id) === Number(original.id)); assert.ok(audit);
    assert.deepEqual(json(audit.before_summary), { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.snapshot_quantity), version, status: original.stock_status, movementId: null });
    assert.deepEqual(json(audit.after_summary), { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.counted_quantity), version: version + 1, status: original.stock_status, movementId: Number(movement.id) });
    assert.deepEqual([audit.action, audit.target_type, Number(audit.target_id), audit.outcome, Number(audit.actor_user_id), audit.actor_label, audit.request_id, audit.correlation_id],
      ["stocktake.post", "stocktake", f.header.id, "SUCCEEDED", 8, "synthetic-approver", input.correlationId, input.correlationId]);
    assert.deepEqual([audit.target_label, Number(audit.occurred_at), audit.reason_category, audit.reason_text, audit.ip],
      [before.inventory_stocktakes.find(row => Number(row.id) === f.header.id).stocktake_number, NOW, "", "", ""]);
  }
  const headerAudit = auditRows.find(row => json(row.after_summary)?.status === "POSTED"); assert.ok(headerAudit);
  assert.deepEqual(json(headerAudit.before_summary), { stocktakeId: f.header.id, status: "READY_TO_POST", version: f.header.version });
  assert.deepEqual(json(headerAudit.after_summary), { stocktakeId: f.header.id, status: "POSTED", version: f.header.version + 1, rowCount: changed.length });
  for (const audit of auditRows) {
    const original = f.lines.find(row => Number(row.id) === Number(json(audit.after_summary)?.id));
    const version = Number(original?.snapshot_balance_version) || 1;
    const summaries = original ? {
      before_summary: { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.snapshot_quantity), version, status: original.stock_status, movementId: null },
      after_summary: { id: Number(original.id), stocktakeId: f.header.id, quantity: Number(original.counted_quantity), version: version + 1,
        status: original.stock_status, movementId: Number(after.inventory_stocktake_lines.find(row => Number(row.id) === Number(original.id)).movement_id) }
    } : {
      before_summary: { stocktakeId: f.header.id, status: "READY_TO_POST", version: f.header.version },
      after_summary: { stocktakeId: f.header.id, status: "POSTED", version: f.header.version + 1, rowCount: changed.length }
    };
    assert.deepEqual({ ...audit, before_summary: json(audit.before_summary), after_summary: json(audit.after_summary) }, {
      id: audit.id, occurred_at: NOW, actor_user_id: 8, actor_label: "synthetic-approver", action: "stocktake.post",
      target_type: "stocktake", target_id: f.header.id,
      target_label: before.inventory_stocktakes.find(row => Number(row.id) === f.header.id).stocktake_number,
      outcome: "SUCCEEDED", reason_category: "", reason_text: "", ...summaries, operation_request_id: result.operationId,
      request_id: input.correlationId, correlation_id: input.correlationId, ip: ""
    });
  }
  const operation = after.inventory_operation_requests.find(row => Number(row.id) === result.operationId);
  assert.equal(Number(operation.actor_user_id), 8); assert.equal(Number(operation.completed_at), NOW); assert.deepEqual(json(operation.result_summary), result);
  assert.deepEqual([operation.command_type, operation.result_type, operation.result_id, operation.actor_label, operation.request_id, operation.correlation_id],
    ["STOCKTAKE_POST", "STOCKTAKE", String(f.header.id), "synthetic-approver", input.correlationId, input.correlationId]);
  assert.deepEqual({ ...operation, result_summary: json(operation.result_summary) }, {
    id: result.operationId, command_type: "STOCKTAKE_POST", source_module: input.source.module,
    source_document_type: input.source.documentType, source_document_id: input.source.documentId,
    source_line_id: input.source.lineId, source_event_id: input.source.eventId,
    request_hash: inventoryOperationHash({ commandType: "STOCKTAKE_POST", payload: input.payload }),
    result_type: "STOCKTAKE", result_id: String(f.header.id), result_summary: result, completed_at: NOW,
    actor_user_id: 8, actor_label: "synthetic-approver", request_id: input.correlationId,
    correlation_id: input.correlationId, created_at: NOW
  });
  const header = after.inventory_stocktakes.find(row => Number(row.id) === f.header.id);
  assert.deepEqual([header.status, Number(header.version), Number(header.post_operation_id)], ["POSTED", f.header.version + 1, result.operationId]);
  assert.deepEqual(header, { ...before.inventory_stocktakes.find(row => Number(row.id) === f.header.id), status: "POSTED", reason: input.payload.reason,
    post_operation_id: result.operationId, posted_at: NOW, posted_by: 8, updated_at: NOW, updated_by: 8, version: f.header.version + 1 });
  for (const row of before.inventory_bin_locks) {
    const actual = after.inventory_bin_locks.find(value => Number(value.id) === Number(row.id));
    if (Number(row.stocktake_id) === f.header.id) assert.deepEqual(actual, { ...row, released_at: NOW, released_by: 8, release_reason: "POSTED", active_scope: null });
    else assert.deepEqual(actual, row, "Foreign active and historical locks are untouched");
  }
  const balanceIds = new Set(changed.map(row => number(row.stock_balance_id)));
  for (const row of before.inventory_stock_balances.filter(row => !balanceIds.has(Number(row.id)))) assert.deepEqual(after.inventory_stock_balances.find(actual => Number(actual.id) === Number(row.id)), row);
  for (const table of ["inventory_stocktakes", "inventory_stocktake_lines"]) for (const row of before[table].filter(row => Number(table === "inventory_stocktakes" ? row.id : row.stocktake_id) !== f.header.id)) assert.deepEqual(after[table].find(actual => Number(actual.id) === Number(row.id)), row);
  for (const table of ["inventory_movements", "inventory_audit_logs", "inventory_operation_requests"]) for (const row of before[table]) assert.deepEqual(after[table].find(actual => Number(actual.id) === Number(row.id)), row);
  const added = {
    inventory_stock_balances: changed.filter(row => row.stock_balance_id === null).map(row => Number(after.inventory_stock_balances.find(balance => dimension(balance) === dimension(row)).id)),
    inventory_movements: movementRows.map(row => Number(row.id)), inventory_audit_logs: auditRows.map(row => Number(row.id)),
    inventory_operation_requests: [result.operationId]
  };
  for (const table of businessTables) {
    const expectedIds = [...before[table].map(row => Number(row.id)), ...(added[table] ?? [])].sort((a, b) => a - b);
    assert.deepEqual(after[table].map(row => Number(row.id)).sort((a, b) => a - b), expectedIds,
      `${table}: reject every unexpected added or missing row, including foreign owners`);
  }
  for (const table of ["inventory_warehouses", "inventory_bins", "inventory_stocktake_bins", "inventory_stock_controls", "inventory_lots", "inventory_reservations", "inventory_allocations", "inventory_transfers", "inventory_transfer_lines"]) assert.deepEqual(after[table], before[table]);
  assert.ok((await rows("inventory_bin_locks", sentinel.header.id)).every(row => row.released_at === null));
  return { ...posted, before, after, movementRows, auditRows };
}

// Deliberate anomalous Item fixture: Inventory FKs keep the SKU, but the consumed JOIN has no parent.
// No FK checks or database settings are disabled to create a missing lookup projection.
async function missingProfile(sku) { await pool.execute("UPDATE item_skus SET item_id=0 WHERE id=?", [sku]); }
function rowHashes(state) {
  return Object.fromEntries(Object.entries(state).map(([table, rows]) => [table, createHash("sha256").update(JSON.stringify(rows)).digest("hex")]));
}
const skuRead = /FROM item_skus s\s+JOIN items i/iu;
const uomRead = /FROM item_sku_uoms su\s+JOIN item_uoms u/iu;
const profileKeys = ["skuId", "skuCode", "skuName", "skuStatus", "itemStatus", "inventoryTracked", "trackingPolicy",
  "shelfLifeDays", "minimumReceiptLifeDays", "minimumSaleLifeDays", "baseUom", "usable", "reasons"].sort();
function profileCalls(db, kind = skuRead) { return calls(db, kind); }
function profileBudget(db, f, bulk = true) {
  const ids = [...new Set(f.lines.map(row => Number(row.sku_id)))].sort((a, b) => a - b);
  if (!bulk) {
    const profile = calls(db, /FROM (?:item_skus|item_uoms|items|item_sku_uoms)\b/iu);
    assert.equal(profile.length, ids.length * 5);
    for (const [index, skuId] of ids.entries()) {
      const group = profile.slice(index * 5, index * 5 + 5);
      const patterns = [/s\.id AS sku_id/u, /FROM item_uoms /u, /FROM items /u,
        /s\.status AS sku_status, s\.version AS sku_version/u, /FROM item_sku_uoms WHERE/u];
      assert.deepEqual(group.map(call => call.params.map(Number)), [[skuId], [1], [1], [skuId], [skuId]]);
      for (const [part, call] of group.entries()) {
        assert.match(call.sql, patterns[part]);
        assert.equal((call.sql.match(/FOR SHARE/gu) ?? []).length, part === 0 ? 0 : 1);
        assert.equal(call.connectionId, db.observation.transactions[0].connectionId);
        assert.equal(call.executed, true); assert.equal(call.settled, true);
      }
    }
    assert.ok(db.observation.requestId, "Native scalar profiles remain tied to the actual Post request");
    return;
  }
  const sku = profileCalls(db), uom = profileCalls(db, uomRead), size = 100;
  const expected = Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));
  assert.deepEqual(sku.map(call => call.params.map(Number)), expected);
  assert.deepEqual(uom.map(call => call.params.map(Number).sort((a, b) => a - b)), expected);
  assert.equal(sku.length + uom.length, expected.length * 2);
  const profile = db.observation.calls.filter(call => skuRead.test(call.sql) || uomRead.test(call.sql));
  assert.deepEqual(profile.map(call => skuRead.test(call.sql) ? "SKU" : "UOM"), expected.flatMap(() => ["SKU", "UOM"]));
  for (const call of profile) {
    assert.match(call.sql, / FOR SHARE\s*$/iu);
    assert.ok(call.params.length <= size);
    assert.equal(call.connectionId, db.observation.transactions[0].connectionId);
    assert.equal(call.executed, true); assert.equal(call.settled, true);
  }
  assert.ok(db.observation.requestId, "Native transaction is tied to the actual Post request");
}
function latch() {
  let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve };
}
const capture = promise => promise.then(value => ({ value }), error => ({ error }));
function valueOf(result) { if (result.error) throw result.error; return result.value; }
async function waitForNativeWait(waitingDb, blockerDb, table, pending) {
  const deadline = Date.now() + 5000;
  let ended = false; void pending.then(() => { ended = true; });
  while (!waitingDb.observation.transactions[0]?.connectionId && Date.now() < deadline) {
    if (ended) break;
    await setImmediate();
  }
  const requester = waitingDb.observation.transactions[0]?.connectionId;
  const blocker = blockerDb.observation.transactions[0]?.connectionId;
  assert.ok(requester > 0 && blocker > 0 && requester !== blocker);
  for (let attempt = 0; attempt < 1000 && Date.now() < deadline; attempt++) {
    const [waits] = await pool.query({ sql: `SELECT rt.PROCESSLIST_ID AS requester,bt.PROCESSLIST_ID AS blocker,
      l.OBJECT_SCHEMA AS schema_name,l.OBJECT_NAME AS table_name,l.LOCK_MODE AS lock_mode,l.LOCK_STATUS AS lock_status,
      w.REQUESTING_ENGINE_TRANSACTION_ID AS requesting_transaction,w.BLOCKING_ENGINE_TRANSACTION_ID AS blocking_transaction
      FROM performance_schema.data_lock_waits w
      JOIN performance_schema.threads rt ON rt.THREAD_ID=w.REQUESTING_THREAD_ID
      JOIN performance_schema.threads bt ON bt.THREAD_ID=w.BLOCKING_THREAD_ID
      JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      WHERE rt.PROCESSLIST_ID=? AND bt.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=? AND l.OBJECT_NAME=?`, timeout: 1000 },
    [requester, blocker, process.env.DB_NAME, table]);
    if (waits.length) {
      assert.ok(waits.every(row => Number(row.requester) === requester && Number(row.blocker) === blocker &&
        row.schema_name === process.env.DB_NAME && row.table_name === table && row.lock_status === "WAITING" &&
        row.requesting_transaction != null && row.blocking_transaction != null));
      waitingDb.observation.waits.push(...waits);
      return waits;
    }
    assert.equal(ended, false, "Request ended without the required native lock wait");
    await setImmediate();
  }
  assert.fail(`Native wait on ${table} was not observable; missing instrumentation is a failure`);
}
async function blockedPost(f, { sql, params, table, whileWaiting = async () => {}, options = {}, succeeds: shouldSucceed = false, expected }) {
  const blockerDb = transactionDatabase(), acquired = latch(), release = latch(), db = transactionDatabase();
  const blocker = capture(blockerDb.withTransaction(async tx => { await tx.execute(sql, params); acquired.resolve(); await release.promise; }));
  let posting, primary, results;
  try {
    await Promise.race([acquired.promise, blocker.then(result => { valueOf(result); throw new Error("Blocker ended before acquisition"); })]);
    posting = capture(shouldSucceed ? succeeds(f, { ...options, db }) : unchanged(f, db, expected, options));
    await waitForNativeWait(db, blockerDb, table, posting);
    await whileWaiting(db);
  } catch (error) { primary = error; }
  finally {
    release.resolve(); acquired.resolve();
    results = await finishParticipants(primary, [blocker, posting]);
  }
  reportFailures(null, results.map(result => result.error));
  settled(blockerDb, "COMMITTED");
  assert.ok(db.observation.waits.length > 0);
  settled(db, shouldSucceed ? "COMMITTED" : "ROLLED_BACK");
  return db;
}
async function oracleProfiles(ids) {
  const db = transactionDatabase();
  const result = await db.withTransaction(async tx => {
    const share = { query: (sql, params) => tx.query(sql + " FOR SHARE", params) };
    const lookup = new ItemLookupService({ database: share, logger, time });
    const projections = await lookup.findManyByIds(ids, { purpose: "inventory" }), result = new Map();
    for (const id of ids) {
      const expected = await lookup.getInventoryProfileInTransaction(tx, id);
      if (expected === null) { assert.equal(projections.has(id), false); continue; }
      const actual = toStocktakeInventoryProfile(projections.get(id));
      assert.deepEqual(Object.keys(actual).sort(), profileKeys);
      assert.deepEqual(Object.keys(actual.baseUom).sort(), ["uomCode", "uomId"]);
      assert.deepEqual(actual, expected, "Compare against the real pre-existing Item method on this transaction");
      result.set(id, expected);
    }
    return result;
  });
  settled(db, "COMMITTED");
  return result;
}
async function restoreAuth() {
  await pool.query("DELETE FROM role_permissions WHERE role_id=2");
  await pool.query("INSERT INTO role_permissions SELECT 2,id FROM permissions WHERE name IN ('inventory.view','inventory.adjust')");
  await pool.query("UPDATE fr_token_versions SET version=0 WHERE subject='8'");
  await pool.query("UPDATE user_devices SET status='approved' WHERE id=5");
}
async function nativeFault(f, pattern, nth = 1, { method = "afterExecute" } = {}) {
  let hits = 0, reached = false;
  const db = transactionDatabase({ [method]: async ({ sql, connection, observation }) => {
    if (pattern.test(sql) && ++hits === nth) {
      reached = true; observation.injections.push({ kind: "AWAITED_NATIVE_SQL_FAULT", sql });
      await connection.query("SELECT * FROM inventory_task041_profile_intended_missing_table");
    }
  } });
  await unchanged(f, db, error => error.code === "DATABASE_OPERATION_FAILED" && error.cause?.code === "ER_NO_SUCH_TABLE");
  assert.equal(reached, true, "Intended actual SQL checkpoint must be reached");
  return db;
}

integrationTest("PBD01 100-SKU single reads and 101-SKU bulk Post retain complete native effects", async () => {
  for (const count of [100, 101]) {
    const input = entries(count).map((row, i) => ({ ...row, absent: count > 100 && i % 2 === 0,
      status: ["AVAILABLE", "DAMAGED", "QUARANTINED"][i % 3] }));
    const f = await readyFixture(input), { db } = await succeeds(f);
    profileBudget(db, f, count > 100);
  }
});
integrationTest("PBD02 201 and 1001 unique SKUs deduplicate and sort bounded chunks on one native connection", async () => {
  for (const count of [201, 1001]) {
    const input = [...entries(count), ...entries(3).map(row => ({ ...row, binGroup: 1, status: "DAMAGED" }))];
    const f = await readyFixture(input), { db } = await succeeds(f);
    profileBudget(db, f); assert.equal(profileCalls(db).length, Math.ceil(count / 100));
  }
});
integrationTest("PBD03 actual generic projection and original 13-key profiles agree for policies NULLs and multi-UOM", async () => {
  const input = entries(101).map((row, i) => ({ ...row, ...(i === 1 ? { policy: "batch", lotKey: "batch" } :
    i === 2 ? { policy: "batch_expiry", lotKey: "expiry" } : {}) }));
  const f = await readyFixture(input), ids = [...f.groups.values()];
  await pool.execute("UPDATE item_skus SET shelf_life_days=NULL,min_receipt_life_days=NULL,min_sale_life_days=NULL,effective_from=?,effective_to=?,sellable=0,purchasable=0 WHERE id=?", [Date.parse("2099-01-01T00:00:00Z"), Date.parse("2099-01-02T00:00:00Z"), ids[0]]);
  for (const sku of ids.slice(0, 3)) await pool.execute("INSERT INTO item_sku_uoms (sku_id,uom_id,to_base_factor,is_base,is_default_purchase,is_default_sale) VALUES (?,2,3,0,0,0)", [sku]);
  const expected = await oracleProfiles(ids.slice(0, 3));
  assert.deepEqual([...expected.values()].map(row => row.trackingPolicy), ["none", "batch", "batch_expiry"]);
  assert.equal(expected.get(ids[0]).shelfLifeDays, null); assert.equal(expected.get(ids[0]).minimumSaleLifeDays, null);
  assert.equal(expected.get(ids[0]).inventoryTracked, true); assert.equal(expected.get(ids[0]).usable, true);
  const { db } = await succeeds(f); profileBudget(db, f);
});
integrationTest("PBD04 native Item statuses tracking and serial flags preserve existing error priority", async () => {
  for (const [skuStatus, itemStatus, tracked, policy] of [
    ["active", "active", 1, "none"], ["inactive", "active", 1, "none"],
    ["discontinued", "discontinued", 1, "none"], ["archived", "active", 1, "none"],
    ["active", "inactive", 1, "none"], ["active", "archived", 1, "none"],
    ["archived", "archived", 0, "serial"], ["archived", "archived", 1, "serial"]
  ]) {
    const f = await readyFixture(), sku = f.groups.get(0);
    await pool.execute("INSERT INTO items (id,name,product_type,status) VALUES (?, 'Status oracle', 'physical', ?)", [sku, itemStatus]);
    await pool.execute("UPDATE item_skus SET item_id=?,status=?,inventory_tracked=?,tracking_policy=? WHERE id=?", [sku, skuStatus, tracked, policy, sku]);
    const original = (await oracleProfiles([sku])).get(sku);
    if (skuStatus === "active" && itemStatus !== "archived" && tracked && policy !== "serial") {
      assert.equal(original.usable, true); await succeeds(f);
    } else {
      const code = !original.inventoryTracked ? "SKU_NOT_INVENTORY_TRACKED" :
        original.trackingPolicy === "serial" ? "SERIAL_TRACKING_UNSUPPORTED" : "INVENTORY_INPUT_INVALID";
      await unchanged(f, transactionDatabase(), { code });
    }
  }
});
integrationTest("PBD05 explicitly anomalous Base rows retain first-SKU UOM errors within and across chunks", async () => {
  for (const [position, anomaly, later] of [[0, "missing", "missing"], [0, "factor", "serial"], [99, "missing", "serial"], [100, "factor", "missing"]]) {
    const f = await readyFixture(entries(201)), ids = [...f.groups.values()];
    if (anomaly === "missing") await pool.execute("DELETE FROM item_sku_uoms WHERE sku_id=?", [ids[position]]);
    else await pool.execute("UPDATE item_sku_uoms SET to_base_factor=2 WHERE sku_id=?", [ids[position]]);
    if (later === "missing") await missingProfile(ids[position + 1]);
    else await pool.execute("UPDATE item_skus SET tracking_policy='serial' WHERE id=?", [ids[position + 1]]);
    const db = transactionDatabase();
    await unchanged(f, db, error => error.code === "UOM_CONVERSION_INVALID" &&
      error.message === "UOM conversion is invalid: Inventory profile requires exactly one Base UOM with factor 1");
    assert.equal(profileCalls(db).length, position < 100 ? 1 : 2, "Do not read later chunks before validating the current chunk");
  }
});
integrationTest("PBD06 first and second chunk missing SKU reject with no committed prior effects", async () => {
  for (const position of [0, 100]) {
    const f = await readyFixture(entries(201)), ids = [...f.groups.values()];
    await missingProfile(ids[position]);
    const db = transactionDatabase(); await unchanged(f, db, { code: "INVENTORY_RESOURCE_NOT_FOUND" });
    assert.deepEqual(profileCalls(db).map(call => call.params.map(Number)),
      position === 0 ? [ids.slice(0, 100)] : [ids.slice(0, 100), ids.slice(100, 200)]);
    assert.equal(calls(db, /UPDATE inventory_stock_balances|INSERT INTO inventory_movements/iu).length, 0);
  }
});
integrationTest("PBD07 native SKU update wait resolves to newly inactive current read and full rollback", async () => {
  const f = await readyFixture(), sku = f.groups.get(0);
  const db = await blockedPost(f, { sql: "UPDATE item_skus SET status='inactive' WHERE id=?", params: [sku],
    table: "item_skus", expected: { code: "INVENTORY_INPUT_INVALID" } });
  assert.match(profileCalls(db)[0].sql, /FOR SHARE/iu);
  assert.equal((await pool.execute("SELECT status FROM item_skus WHERE id=?", [sku]))[0][0].status, "inactive");
});
integrationTest("PBD08 native Item update wait reads committed archived Item and retains every owned lock", async () => {
  const f = await readyFixture(), sku = f.groups.get(0);
  await pool.execute("INSERT INTO items (id,name,product_type,status) VALUES (?, 'Archive race', 'physical', 'active')", [sku]);
  await pool.execute("UPDATE item_skus SET item_id=? WHERE id=?", [sku, sku]);
  await blockedPost(f, { sql: "UPDATE items SET status='archived' WHERE id=?", params: [sku],
    table: "items", expected: { code: "INVENTORY_INPUT_INVALID" } });
  assert.ok((await rows("inventory_bin_locks", f.header.id)).every(row => row.released_at === null));
});
integrationTest("PBD09 second share query waits for native UOM mapping factor and Base removal updates", async () => {
  for (const assignment of ["to_base_factor=2", "is_base=0"]) {
    const f = await readyFixture(), sku = f.groups.get(0);
    const db = await blockedPost(f, { sql: `UPDATE item_sku_uoms SET ${assignment} WHERE sku_id=?`, params: [sku],
      table: "item_sku_uoms", expected: { code: "UOM_CONVERSION_INVALID" } });
    assert.equal(profileCalls(db).length, 1); assert.equal(profileCalls(db, uomRead).length, 1);
    assert.match(profileCalls(db, uomRead)[0].sql, /FOR SHARE/iu);
  }
});
integrationTest("PBD10 UOM master current read preserves inactive policy and acquired shares block a real writer until terminal", async () => {
  const f = await readyFixture(); let primary;
  try {
    await blockedPost(f, { sql: "UPDATE item_uoms SET status='inactive' WHERE id=1", params: [], table: "item_uoms", succeeds: true });
  } catch (error) { primary = error; }
  finally { await finishParticipants(primary, [], [() => pool.query("UPDATE item_uoms SET status='active' WHERE id=1")]); }
  const g = await readyFixture(), acquired = latch(), release = latch(); let held = false;
  const db = transactionDatabase({ afterQuery: async ({ sql }) => {
    if (!held && uomRead.test(sql)) { held = true; acquired.resolve(); await release.promise; }
  } });
  const posting = capture(succeeds(g, { db })); let writer, writerDb, results;
  primary = undefined;
  try {
    await Promise.race([acquired.promise, posting.then(result => { valueOf(result); throw new Error("Post ended before UOM share barrier"); })]);
    writerDb = transactionDatabase();
    writer = capture(writerDb.withTransaction(tx => tx.execute("UPDATE item_uoms SET name='Writer after Post' WHERE id=1")));
    await waitForNativeWait(writerDb, db, "item_uoms", writer);
    assert.equal(db.observation.transactions[0].outcome, null);
  } catch (error) { primary = error; }
  finally {
    release.resolve(); acquired.resolve();
    results = await finishParticipants(primary, [posting, writer], [() => pool.query("UPDATE item_uoms SET name='Each' WHERE id=1")]);
  }
  reportFailures(null, results.map(result => result.error));
  if (writer) settled(writerDb, "COMMITTED");
  settled(db, "COMMITTED"); profileBudget(db, g);
});
integrationTest("PBD11 second native SKU and UOM SQL faults await rollback terminal and restore every business row", async () => {
  for (const pattern of [skuRead, uomRead]) {
    const f = await readyFixture(entries(201)), db = await nativeFault(f, pattern, 2, { method: "beforeQuery" });
    assert.equal(profileCalls(db, pattern).length, 2); assert.equal(db.observation.injections.length, 1);
    assert.equal(profileCalls(db, pattern)[0].executed, true);
    assert.equal(profileCalls(db, pattern)[1].executed, false, "Native fault is injected immediately before the second batch SQL");
    assert.equal(calls(db, /INSERT INTO inventory_movements/iu).length, 0);
  }
});
integrationTest("PBD12 real auth revocations and explicit proof clock expiry during native profile waits reject including replay", async () => {
  for (const [kind, code] of [["role", "PERMISSION_STALE"], ["jwt", "JWT_INVALID"], ["device", "DEVICE_REVOKED"], ["proof", "DEVICE_SIGNATURE_STALE"]]) {
    const f = await readyFixture(); let now = NOW;
    const clock = { nowMs: () => now, fileDate: time.fileDate }, input = postCommand(f), proof = capsule(input, clock);
    try {
      await blockedPost(f, { sql: "UPDATE item_skus SET sku_name=sku_name WHERE id=?", params: [f.groups.get(0)], table: "item_skus",
        expected: { code }, options: { clock, input, proof }, whileWaiting: async db => {
          if (kind === "role") await pool.query("DELETE FROM role_permissions WHERE role_id=2");
          if (kind === "jwt") await pool.query("UPDATE fr_token_versions SET version=1 WHERE subject='8'");
          if (kind === "device") await pool.query("UPDATE user_devices SET status='revoked' WHERE id=5");
          if (kind === "proof") { now += 60001; db.observation.injections.push({ kind: "CONTROLLED_CLOCK", label: "Original proof expires during real SQL wait" }); }
        } });
    } finally { await restoreAuth(); }
    const posted = await succeeds(f, { input });
    const replayProof = capsule(input), before = await snapshot(), replayDb = transactionDatabase();
    if (kind === "role") await pool.query("DELETE FROM role_permissions WHERE role_id=2");
    if (kind === "jwt") await pool.query("UPDATE fr_token_versions SET version=1 WHERE subject='8'");
    if (kind === "device") await pool.query("UPDATE user_devices SET status='revoked' WHERE id=5");
    try {
      if (kind === "proof") {
        let replayNow = NOW; const replayClock = { nowMs: () => replayNow, fileDate: time.fileDate };
        const expired = capsule(input, replayClock); replayNow += 60001;
        await assert.rejects(post(f, { input, db: replayDb, clock: replayClock, proof: expired }), { code });
      } else await assert.rejects(post(f, { input, db: replayDb, proof: replayProof }), { code });
      settled(replayDb, "ROLLED_BACK"); assert.deepEqual(await snapshot(), before);
      assert.equal(profileCalls(replayDb).length + profileCalls(replayDb, uomRead).length, 0);
    } finally { await restoreAuth(); }
    assert.equal(posted.result.status, "POSTED");
  }
  const anomalous = await readyFixture(); let now = NOW;
  const clock = { nowMs: () => now, fileDate: time.fileDate }, input = postCommand(anomalous), proof = capsule(input, clock);
  await blockedPost(anomalous, { sql: "UPDATE item_sku_uoms SET to_base_factor=2 WHERE sku_id=?",
    params: [anomalous.groups.get(0)], table: "item_sku_uoms", expected: { code: "UOM_CONVERSION_INVALID" },
    options: { clock, input, proof }, whileWaiting: async db => {
      now += 60001; db.observation.injections.push({ kind: "CONTROLLED_CLOCK", label: "Original UOM failure still precedes expired proof after native SQL wait" });
    } });
});
integrationTest("PBD13 native allocated floor whole-document Reserved and short-life eligibility retain original rollback codes", async () => {
  const allocated = await readyFixture(entries(102).map((row, i) => ({ ...row, group: i === 1 ? 0 : i,
    binGroup: i === 1 ? 1 : 0, actual: i === 0 ? 1 : i === 1 ? 20 : 7 })));
  const line = allocated.lines.find(row => Number(row.sku_id) === allocated.groups.get(0)), op = new InventoryOperationService();
  await database.withTransaction(async tx => {
    const input = command("create", {});
    const claim = await op.claim(tx, { commandType: "RESERVATION_CREATE", payload: { quantity: 2 },
      source: { ...input.source, documentType: "RESERVATION" }, actorUserId: 7, actorLabel: "synthetic-counter", createdAt: NOW });
    const [reservation] = await tx.execute("INSERT INTO inventory_reservations (create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES (?,1,?,2,2,'SALE','ACTIVE',?,?)", [claim.operationId, line.sku_id, NOW, NOW]);
    await tx.execute("INSERT INTO inventory_allocations (create_operation_id,reservation_id,stock_balance_id,allocated_quantity,outstanding_quantity,selection_strategy,status,created_at,updated_at) VALUES (?,?,?,2,2,'FIFO','ACTIVE',?,?)", [claim.operationId, reservation.insertId, line.stock_balance_id, NOW, NOW]);
    await tx.execute("UPDATE inventory_stock_balances SET allocated_quantity=2 WHERE id=?", [line.stock_balance_id]);
    await tx.execute("UPDATE inventory_stock_controls SET reserved_quantity=2 WHERE warehouse_id=1 AND sku_id=?", [line.sku_id]);
    await op.complete(tx, { operationId: claim.operationId, resultType: "RESERVATION", resultId: String(reservation.insertId),
      resultSummary: { id: Number(reservation.insertId), quantity: 2, status: "ACTIVE" }, completedAt: NOW });
  });
  await unchanged(allocated, transactionDatabase(), { code: "INSUFFICIENT_STOCK" });
  for (const sameSku of [true, false]) {
    const f = await readyFixture(entries(102).map((row, i) => ({ ...row, group: i === 1 && sameSku ? 0 : i,
      binGroup: i === 1 ? 1 : 0, actual: i === 0 ? 1 : 7 }))), sku = f.groups.get(0);
    await seedBalance({ bin_id: await bin(), sku_id: sku, lot_id: null, stock_status: "AVAILABLE", quantity: 3 });
    await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=? WHERE warehouse_id=1 AND sku_id=?", [sameSku ? 11 : 7, sku]);
    if (sameSku) await succeeds(f); else await unchanged(f, transactionDatabase(), { code: "INSUFFICIENT_ATP" });
  }
  const short = await readyFixture([...Array.from({ length: 101 }, (_, i) => ({ group: 0, binGroup: i,
    lotKey: i ? "short" : "eligible", expiry: i ? "2026-10-13" : "2027-01-01", actual: i ? 7 : 1 })),
  ...entries(100).map(row => ({ ...row, group: row.group + 1 }))]);
  await pool.execute("UPDATE inventory_stock_controls SET reserved_quantity=4 WHERE warehouse_id=1 AND sku_id=?", [short.groups.get(0)]);
  await unchanged(short, transactionDatabase(), { code: "INSUFFICIENT_ATP" });
});
integrationTest("PBD14 all-zero 101+ unique SKU Post still validates profiles and strong auth and replays without effects", async () => {
  const invalid = await readyFixture(entries(101), { zero: true });
  await pool.execute("UPDATE item_skus SET tracking_policy='serial' WHERE id=?", [invalid.groups.get(100)]);
  const invalidDb = transactionDatabase();
  await unchanged(invalid, invalidDb, { code: "SERIAL_TRACKING_UNSUPPORTED" });
  assert.equal(profileCalls(invalidDb).length, 2);
  const f = await readyFixture(entries(201), { zero: true }), input = postCommand(f);
  await unchanged(f, transactionDatabase(), { code: "PERMISSION_STALE" }, { input, proof: {} });
  const { result, db } = await succeeds(f, { input }); profileBudget(db, f);
  assert.equal(result.rowCount, 0); assert.equal(result.movementGroupId, null);
  assert.equal(calls(db, /UPDATE inventory_stock_balances|INSERT INTO inventory_movements|UPDATE inventory_stocktake_lines/iu).length, 0);
  const before = await snapshot(), replayDb = transactionDatabase();
  assert.deepEqual((await post(f, { input, db: replayDb })).result, result); settled(replayDb, "COMMITTED");
  assert.deepEqual(await snapshot(), before);
  assert.equal(profileCalls(replayDb).length + profileCalls(replayDb, uomRead).length, 0);
  assert.equal(calls(replayDb, /INSERT INTO inventory_(?:stock_balances|movements|audit_logs)|UPDATE inventory_(?:stock_balances|stocktake_lines|stocktakes|bin_locks)/iu).length, 0);
});
integrationTest("PBD15 later Movement Audit final header and own-unlock SQL faults rollback all prior chunks and foreign owners", async () => {
  const f = await readyFixture(entries(201).map((row, i) => ({ ...row, binGroup: i % 2 })));
  for (const [pattern, nth] of [[/INSERT INTO inventory_movements/iu, 2], [/INSERT INTO inventory_audit_logs/iu, 2],
    [/UPDATE inventory_stocktakes SET status\s*=\s*'POSTED'/iu, 1], [/UPDATE inventory_bin_locks/iu, 1]]) {
    const db = await nativeFault(f, pattern, nth);
    profileBudget(db, f); assert.ok(calls(db, /INSERT INTO inventory_movements/iu).length >= 2);
  }
});
integrationTest("PBD16 bounded real Item editor and Post races and native deadlock retain complete outcomes", async () => {
  for (const order of ["edit-first", "post-first", "deadlock-cycle"]) {
    const f = await readyFixture(entries(order === "deadlock-cycle" ? 201 : 101));
    const sku = f.groups.get(0), editedName = "Concurrent complete snapshot";
    if (order === "edit-first") {
      f.skuNames = new Map([[sku, editedName]]);
      const db = await blockedPost(f, { sql: "UPDATE item_skus SET sku_name=? WHERE id=?", params: [editedName, sku],
        table: "item_skus", succeeds: true });
      const [movements] = await pool.execute("SELECT sku_name_snapshot FROM inventory_movements WHERE stocktake_id=? AND sku_id=?", [f.header.id, sku]);
      assert.equal(movements.length, 1); assert.equal(movements[0].sku_name_snapshot, editedName);
      profileBudget(db, f);
      continue;
    }
    const acquired = latch(), release = latch(), editorHasUom = latch(), continueEditor = latch(); let held = false;
    const db = transactionDatabase({ afterQuery: async ({ sql }) => {
      if (order !== "deadlock-cycle" && !held && uomRead.test(sql)) { held = true; acquired.resolve(); await release.promise; }
    } });
    const before = await snapshot();
    let posting, writer, editorDb, postResult, editorResult, primary;
    try {
      editorDb = transactionDatabase();
      if (order === "deadlock-cycle") {
        // Do not assume a later SKU is unlocked: physical range/join lock footprints may be broader.
        // Editor owns UOM; Post owns SKU and demonstrably waits on UOM; editor then requests that SKU.
        writer = capture(editorDb.withTransaction(async tx => {
          await tx.execute("UPDATE item_uoms SET name='Cycle editor' WHERE id=1");
          editorHasUom.resolve(); await continueEditor.promise;
          await tx.execute("UPDATE item_skus SET sku_name=? WHERE id=?", [editedName, sku]);
        }));
        await Promise.race([editorHasUom.promise, writer.then(result => {
          valueOf(result); throw new Error("Editor ended before native UOM lock");
        })]);
        posting = capture(succeeds(f, { db }));
        await waitForNativeWait(db, editorDb, "item_uoms", posting);
        continueEditor.resolve();
      } else {
        posting = capture(succeeds(f, { db }));
        await Promise.race([acquired.promise, posting.then(result => { valueOf(result); throw new Error("Post ended before share barrier"); })]);
        writer = capture(editorDb.withTransaction(tx => tx.execute("UPDATE item_skus SET sku_name=? WHERE id=?", [editedName, sku])));
        await waitForNativeWait(editorDb, db, "item_skus", writer);
      }
    } catch (error) { primary = error; }
    finally {
      release.resolve(); acquired.resolve(); editorHasUom.resolve(); continueEditor.resolve();
      [postResult, editorResult] = await finishParticipants(primary, [posting, writer], [() => pool.query("UPDATE item_uoms SET name='Each' WHERE id=1")]);
    }
    if (postResult.error) {
      assert.equal(order, "deadlock-cycle");
      assert.equal(postResult.error.code, "CONCURRENT_OPERATION", "The service maps real native deadlock/timeout rejection");
      settled(db, "ROLLED_BACK");
      const after = await snapshot(); assert.deepEqual(rowHashes(after), rowHashes(before)); assert.deepEqual(after, before);
      assert.equal(editorResult?.error, undefined); settled(editorDb, "COMMITTED");
      assert.equal(calls(db, /INSERT INTO inventory_movements/iu).length, 0);
    } else {
      valueOf(postResult); settled(db, "COMMITTED"); profileBudget(db, f);
      if (order === "deadlock-cycle") {
        assert.equal(editorResult.error?.code, "DATABASE_OPERATION_FAILED");
        assert.equal(editorResult.error?.cause?.code, "ER_LOCK_DEADLOCK", "The actual cycle must abort exactly one participant");
        settled(editorDb, "ROLLED_BACK");
      } else { valueOf(editorResult); settled(editorDb, "COMMITTED"); }
      const [movements] = await pool.execute("SELECT sku_name_snapshot FROM inventory_movements WHERE stocktake_id=? AND sku_id=?", [f.header.id, sku]);
      assert.equal(movements.length, 1); assert.equal(movements[0].sku_name_snapshot, f.skuName);
    }
    // A mapped contention rejection proves rollback; it is never recorded as successful capacity.
  }
});

