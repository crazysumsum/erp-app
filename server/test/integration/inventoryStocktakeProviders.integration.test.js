import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import mysql from "mysql2/promise";
import { MySqlDatabaseService, getActiveTransactionIsolation } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { InventoryStocktakeService } from "../../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
import { issuePurchaseReceiptContext, issuePurchaseReversalContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { issueInventoryHighRiskContext } from "../../src/modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext } from "../../src/modules/inventory/inventoryStocktakeCancelContext.js";
import { purchaseReceiptCommand, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";

// Synthetic owner documents and trusted request fixtures prove provider composition, not
// production Purchasing adoption or HTTP/device-signature verification. The unchanged
// authentication suites remain required. Only these four environment keys select this lane.
const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_STOCKTAKE_PROVIDER_JOINT_TESTS === "1";
const native = (name, work) => test(name, { skip: !enabled, timeout: 60000 }, work);
const schema = process.env.DB_NAME, socketPath = process.env.DB_SOCKET;
const NOW = Date.parse("2026-10-23T01:00:00Z");
const time = { nowMs: () => NOW, fileDate: () => "2026-10-23", timestamp: () => "2026-10-23T01:00:00Z" };
const logger = { async info() {}, async warn() {}, async error() {} };
const permissions = ["inventory.view", "inventory.operation", "inventory.adjust", "inventory.fefo.override",
  "purchasing.view", "receiving.operation", "receiving.expiry.override", "sales.operation",
  "fulfillment.view", "fulfillment.operation", "fulfillment.reverse"];
const tables = ["inventory_stocktakes", "inventory_stocktake_bins", "inventory_stocktake_lines", "inventory_bin_locks",
  "inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_operation_requests",
  "inventory_movements", "inventory_audit_logs", "inventory_purchase_reversal_links", "inventory_reservations",
  "inventory_allocations", "joint_owner_documents", "joint_owner_lines"];
let observer, pool, context, actor, binding, config;
const observations = [];
const ownedPoolConnections = new Set();
const code = error => error?.publicCode ?? error?.code ?? error?.cause?.code;
const latch = () => Promise.withResolvers();
const sqlText = sql => typeof sql === "string" ? sql : sql.sql;
const warehouseLock = sql => /FROM inventory_warehouses\b/u.test(sqlText(sql)) && /FOR UPDATE/u.test(sqlText(sql));
const query = (sql, args = [], timeout = 1000) => observer.query({ sql, timeout }, args);
const insert = async (sql, args = []) => Number((await observer.execute({ sql, timeout: 1000 }, args))[0].insertId);
async function closeBounded(resource, ownedConnections) {
  if (!resource) return;
  let timer;
  try {
    await Promise.race([resource.end(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("owned SQL resource did not close within 5 seconds")), 5000);
    })]);
  } catch (error) {
    const destroyErrors = [];
    for (const connection of ownedConnections) {
      try { connection.destroy(); } catch (destroyError) { destroyErrors.push(destroyError); }
    }
    if (destroyErrors.length) error.destroyErrors = destroyErrors;
    throw error;
  } finally { clearTimeout(timer); }
}

before(async () => {
  if (!enabled) return;
  assert.match(schema ?? "", /^erp_inventory_task041_[a-z0-9_]+$/u);
  assert.match(socketPath ?? "", /^\/private\/tmp\/erp-inventory-task041-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  observer = await mysql.createConnection({ socketPath, user: "root", database: schema, connectTimeout: 5000 });
  const [[environment]] = await query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated");
  assert.equal(environment.version, "26.7.0");
  assert.equal(environment.schema_name, schema);
  assert.equal(Number(environment.isolated), 1);
  assert.equal((await query("SHOW TABLES"))[0].length, 0, "must be the coordinator's fresh owned schema; never reset shared data");
  await assertInstrumentation();
  for (const migration of ["0003_add_auth_tables", "0004_add_device_binding_tables", "0011_create_item_categories",
    "0012_create_item_brands", "0013_create_item_uoms", "0014_create_items", "0015_create_item_skus", "0016_create_item_sku_uoms",
    "0055_seed_inventory_permissions", "0056_create_inventory_operations", "0057_create_inventory_audit", "0058_create_inventory_master",
    "0059_create_inventory_stock", "0060_create_inventory_movements", "0063_create_inventory_reservations", "0065_create_inventory_stocktakes",
    "0067_seed_sales_permissions", "0091_seed_fulfillment_permissions", "0100_seed_purchasing_permissions", "0101_create_inventory_purchase_reversal_links"]) {
    await (await import(`../../database/migrations/${migration}.js`)).up({
      query: (sql, args = []) => observer.query({ sql, timeout: 10000 }, args),
      execute: (sql, args = []) => observer.execute({ sql, timeout: 10000 }, args)
    });
  }
  const jwtSql = (await readFile(new URL("../../database/framework/jwt.sql", import.meta.url), "utf8"))
    .split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");
  await query(jwtSql);
  await query(`CREATE TABLE joint_owner_documents (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(30) NOT NULL,result_summary JSON NULL,reversal_summary JSON NULL) ENGINE=InnoDB`);
  await query(`CREATE TABLE joint_owner_lines (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,document_id BIGINT UNSIGNED NOT NULL,
    source_line_id VARCHAR(30) NOT NULL,confirmed_snapshot JSON NOT NULL,inventory_result JSON NULL,
    UNIQUE KEY joint_owner_line(document_id,source_line_id)) ENGINE=InnoDB`);
  const actorId = await insert("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES('Joint synthetic','unused',1,1)");
  const role = await insert("INSERT INTO roles(name,created_at) VALUES('joint-synthetic',1)");
  await query("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)", [actorId, role]);
  await query(`INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN (${permissions.map(() => "?").join(",")})`, [role, ...permissions]);
  const [actual] = await query("SELECT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=?", [role]);
  assert.deepEqual(actual.map(row => row.name).sort(), [...permissions].sort());
  actor = { userId: actorId, serviceName: "", claimedRoles: ["joint-synthetic"], claimedPermissions: permissions };
  const publicKey = Buffer.from("trusted synthetic device fixture, not cryptographic signature evidence"), deviceId = "b".repeat(64);
  const id = await insert("INSERT INTO user_devices(user_id,device_id,public_key,status,requested_at) VALUES(?,?,?,'approved',1)", [actorId, deviceId, publicKey]);
  binding = { id, user_id: actorId, device_id: deviceId, public_key: publicKey, status: "approved" };
  config = { socketPath, user: "root", database: schema, connectionLimit: 6, waitForConnections: true, queueLimit: 10,
    acquireTimeoutMs: 5000, queryTimeoutMs: 10000, transactionTimeoutMs: 20000, abandonedConnectionAction: "destroy" };
  context = new RequestContextService({ services: { require: () => time } });
  pool = createMySqlDatabasePool(config);
  pool.on("connection", connection => ownedPoolConnections.add(connection));
}, { timeout: 60000 });

after(async t => {
  const errors = [];
  try { await closeBounded(pool, ownedPoolConnections); } catch (error) { errors.push(error); }
  if (observer) {
    try {
      const [sessions] = await query("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND ID<>CONNECTION_ID()", [schema]);
      assert.deepEqual(sessions, [], "all owned provider sessions must close before coordinator teardown");
    } catch (error) { errors.push(error); }
    try { await closeBounded(observer, [observer]); } catch (error) { errors.push(error); }
  }
  if (enabled) t.diagnostic(JSON.stringify({ lane: "stocktake-provider-joint", observations }));
  if (errors.length) throw new AggregateError(errors, "Joint provider cleanup failed");
}, { timeout: 15000 });

async function snapshot() {
  const result = {};
  // The independent observer reads committed facts, never the writer's transaction.
  for (const table of tables) result[table] = (await query(`SELECT * FROM ${table} ORDER BY id`))[0];
  return result;
}

async function observationQuery(deadline, sql, args = []) {
  const remaining = deadline - Date.now();
  assert.ok(remaining > 0, "original SQL observation deadline expired before query");
  const result = await query(sql, args, Math.min(1000, remaining));
  assert.ok(Date.now() < deadline, "original SQL observation deadline expired before result acceptance");
  return result;
}

async function assertInstrumentation(read = query) {
  const [[instrumentation]] = await read("SELECT @@performance_schema AS enabled");
  assert.equal(Number(instrumentation.enabled), 1, "missing P_S is UNKNOWN, never SQL terminal");
  const [consumers] = await read(`SELECT NAME,ENABLED FROM performance_schema.setup_consumers
    WHERE NAME IN ('events_statements_current','events_statements_history','global_instrumentation','thread_instrumentation') ORDER BY NAME`);
  assert.deepEqual(consumers.map(row => [row.NAME, row.ENABLED]), [
    ["events_statements_current", "YES"], ["events_statements_history", "YES"],
    ["global_instrumentation", "YES"], ["thread_instrumentation", "YES"]
  ], "disabled or missing P_S consumers are UNKNOWN, never zero active SQL");
  const [instruments] = await read("SELECT NAME,ENABLED FROM performance_schema.setup_instruments WHERE NAME LIKE 'statement/sql/%' OR NAME='statement/com/Execute'");
  for (const name of ["select", "insert", "update", "delete", "begin", "commit", "rollback"].map(name => `statement/sql/${name}`).concat("statement/com/Execute"))
    assert.ok(instruments.some(row => row.NAME === name && row.ENABLED === "YES"), `missing ${name} instrumentation is UNKNOWN`);
  assert.ok(instruments.every(row => row.ENABLED === "YES"), "disabled SQL instruments are UNKNOWN, never zero active SQL");
}

async function terminal(identity, outcome) {
  assert.ok(identity?.threadId && identity.performanceThreadId, "SQL terminal needs a known actual owned session");
  const deadline = Date.now() + 5000;
  const read = (sql, args) => observationQuery(deadline, sql, args);
  await assertInstrumentation(read);
  do {
    const [sessions] = await read("SELECT ID,COMMAND,STATE FROM information_schema.PROCESSLIST WHERE ID=?", [identity.threadId]);
    const [threads] = await read("SELECT THREAD_ID,PROCESSLIST_ID,INSTRUMENTED,HISTORY FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [identity.threadId]);
    if (sessions.length) {
      assert.equal(threads.length, 1);
      assert.equal(Number(threads[0].THREAD_ID), identity.performanceThreadId);
      assert.equal(threads[0].INSTRUMENTED, "YES", "uninstrumented owned session is UNKNOWN");
      assert.equal(threads[0].HISTORY, "YES", "disabled owned session history is UNKNOWN");
    }
    const [transactions] = await read("SELECT trx_id FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?", [identity.threadId]);
    const [locks] = await read("SELECT ENGINE_LOCK_ID FROM performance_schema.data_locks WHERE THREAD_ID=?", [identity.performanceThreadId]);
    const [waits] = await read("SELECT ENGINE FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID=? OR BLOCKING_THREAD_ID=?", [identity.performanceThreadId, identity.performanceThreadId]);
    const [statements] = await read("SELECT EVENT_ID,END_EVENT_ID FROM performance_schema.events_statements_current WHERE THREAD_ID=?", [identity.performanceThreadId]);
    if (sessions.length) assert.equal(statements.length, 1, "a live owned session with no current SQL event is UNKNOWN");
    const stopped = sessions.length === 0 ? threads.length === 0 : sessions.length === 1 && sessions[0].COMMAND === "Sleep";
    if (stopped && transactions.length === 0 && locks.length === 0 && waits.length === 0 && statements.every(row => row.END_EVENT_ID !== null)) {
      observations.push({ ...identity, outcome, status: "SQL_TERMINAL_CONFIRMED" });
      return;
    }
    await setImmediate();
  } while (Date.now() < deadline);
  assert.fail(`owned SQL terminal unproved: ${JSON.stringify(identity)} (${outcome})`);
}

// Observe the real executor without substituting it: MySqlDatabaseService continues
// to own BEGIN/COMMIT/ROLLBACK, request binding and the active transaction registry.
function database(hooks = {}) {
  const db = new MySqlDatabaseService({ pool, config, context, logger });
  const transaction = db.withTransaction.bind(db);
  db.withTransaction = async (work, options = {}) => {
    let identity, result, primary;
    try {
      result = await transaction(async tx => {
        const [[row]] = await tx.query("SELECT CONNECTION_ID() AS thread_id");
        const [[thread]] = await query("SELECT THREAD_ID,INSTRUMENTED,HISTORY FROM performance_schema.threads WHERE PROCESSLIST_ID=?", [row.thread_id]);
        identity = { threadId: Number(row.thread_id), performanceThreadId: Number(thread?.THREAD_ID) };
        assert.ok(identity.performanceThreadId, "native P_S session identity is mandatory");
        assert.equal(thread.INSTRUMENTED, "YES", "owned transaction instrumentation is required before work");
        assert.equal(thread.HISTORY, "YES", "owned transaction history is required before work");
        assert.equal(getActiveTransactionIsolation(tx), options.isolationLevel ?? "REPEATABLE READ");
        const originalQuery = tx.query.bind(tx);
        tx.query = async (sql, ...args) => {
          await hooks.beforeQuery?.(sql, identity);
          let value;
          try { value = await originalQuery(sql, ...args); }
          catch (error) {
            const nativeError = error.cause ?? error;
            observations.push({ status: "NATIVE_QUERY_FAILURE", ...identity, sql: sqlText(sql),
              code: nativeError.code ?? null, errno: nativeError.errno ?? null, message: nativeError.message });
            if (nativeError.code === "ER_LOCK_DEADLOCK") {
              try { observations.push({ status: "NATIVE_DEADLOCK_DIAGNOSTIC", ...identity, rows: (await query("SHOW ENGINE INNODB STATUS"))[0] }); }
              catch (diagnosticError) { observations.push({ status: "DEADLOCK_DIAGNOSTIC_FAILED", message: diagnosticError.message }); }
            }
            throw error;
          }
          await hooks.afterQuery?.(sql, identity);
          return value;
        };
        return work(tx);
      }, options);
    } catch (error) { primary = error; }
    try { await terminal(identity, primary ? "REJECTED" : "FULFILLED"); }
    catch (error) {
      if (primary) { primary.terminalError = error; throw primary; }
      throw error;
    }
    if (primary) throw primary;
    return result;
  };
  return db;
}

function request(input, action = "receipt") {
  const high = ["reversal", "post"].includes(action), authType = high ? "jwt-device-password" : action === "cancel" ? "jwt-password" : "jwt";
  const path = action === "receipt" ? "/api/v1/goods-receipts/:id/confirm" : action === "reversal"
    ? "/api/v1/goods-receipts/:id/reversals/create" : `/api/v1/inventory/stocktakes/:id/${action}`;
  const auth = { type: authType, claims: { sub: String(actor.userId), roles: actor.claimedRoles, permissions,
    exp: NOW / 1000 + 900, auth_time: NOW / 1000, ver: 0, ...(high ? { did: binding.device_id } : {}) },
  ...(high ? { deviceBinding: binding } : {}) };
  const apiRoute = { path, authType }, current = { auth, apiRoute, requestId: input.correlationId, databaseTransaction: null };
  return { auth, apiRoute, context: current, requestId: current.requestId, method: "POST", get: () => String(NOW),
    input: { params: { id: String(input.payload?.stocktakeId ?? input.source.documentId) } } };
}
const run = (input, action, work, db = database(), options = {}) => {
  const req = request(input, action);
  return context.storage.run(req.context, () => db.withTransaction(tx => work(tx, req, db), options));
};
const serviceOptions = db => ({ database: db, time, logger });
const authOptions = db => ({ database: db, time, sessionMaxAgeSeconds: 28800, clockToleranceSeconds: 0, signatureMaxSkewSeconds: 60 });
function stockCommand(action, payload) {
  const eventId = randomUUID();
  return { actor: structuredClone(actor), authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: action === "post" ? "inventory.adjust" : "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "joint-synthetic", lineId: "", eventId }, correlationId: eventId, payload };
}
function stock(action, input, db = database()) {
  return run(input, action, async (tx, req) => {
    const service = new InventoryStocktakeService(serviceOptions(db));
    const proof = action === "post" ? issueInventoryHighRiskContext(req, input, authOptions(db))
      : action === "cancel" ? issueInventoryStocktakeCancelContext(req, input, authOptions(db)) : undefined;
    return service[`${action}InTransaction`](tx, input, proof);
  }, db);
}

async function fixture({ lotTracked = false } = {}) {
  const token = randomUUID().replaceAll("-", "");
  const category = await insert("INSERT INTO item_categories(name,created_at,updated_at) VALUES(?,1,1)", [token]);
  const brand = await insert("INSERT INTO item_brands(name,created_at,updated_at) VALUES(?,1,1)", [token]);
  const uomId = await insert("INSERT INTO item_uoms(code,name,created_at,updated_at) VALUES(?, 'Each',1,1)", [token.slice(0, 15)]);
  const item = await insert("INSERT INTO items(name,category_id,brand_id,product_type,status,created_at,updated_at) VALUES(?,?,?,'variant','active',1,1)", [token, category, brand]);
  const skuId = await insert("INSERT INTO item_skus(item_id,sku_code,sku_name,status,purchasable,sellable,inventory_tracked,tracking_policy,created_at,updated_at) VALUES(?,?,?,'active',1,1,1,'none',1,1)", [item, token, token]);
  if (lotTracked) await query("UPDATE item_skus SET tracking_policy='batch' WHERE id=?", [skuId]);
  await insert("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES(?,?,1,1,1,1)", [skuId, uomId]);
  const warehouseId = await insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES(?,?,?,1,1)", [token, token, token]);
  const bins = [];
  for (const name of ["A", "B", "C"]) bins.push(await insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)", [warehouseId, name, name.toLowerCase()]));
  return { skuId, uomId, uomCode: token.slice(0, 15), warehouseId, bins, lotTracked };
}

async function receiptCommand(f, binIds = [f.bins[0]], quantity = 10) {
  const id = await insert("INSERT INTO joint_owner_documents(status) VALUES('CONFIRMED')");
  const input = purchaseReceiptCommand();
  input.actor = structuredClone(actor); input.source = { documentId: String(id), eventId: randomUUID() }; input.correlationId = randomUUID();
  input.lines = binIds.map((binId, i) => ({ ...structuredClone(input.lines[0]), sourceLineId: String(81 + i), skuId: f.skuId,
    warehouseId: f.warehouseId, binId, baseQuantity: quantity, ...(f.lotTracked ? { lotNumber: "Joint-Lot" } : {}),
    commitment: { ...input.lines[0].commitment, skuId: f.skuId, purchaseOrderId: id, purchaseOrderLineId: 6 + i,
      trackingPolicySnapshot: f.lotTracked ? "batch" : "none", baseUomIdSnapshot: f.uomId, baseUomCodeSnapshot: f.uomCode } }));
  for (const line of purchaseConfirmedLines(input)) await insert("INSERT INTO joint_owner_lines(document_id,source_line_id,confirmed_snapshot) VALUES(?,?,?)", [id, line.sourceLineId, JSON.stringify(line)]);
  return input;
}

function receipt(input, db = database()) {
  return run(input, "receipt", async (tx, req) => {
    const [owners] = await tx.query("SELECT confirmed_snapshot FROM joint_owner_lines WHERE document_id=? ORDER BY source_line_id", [input.source.documentId]);
    input.context = issuePurchaseReceiptContext(req, tx, input, owners.map(row => row.confirmed_snapshot), authOptions(db));
    const result = await new InventoryPostingService(serviceOptions(db)).postPurchaseReceiptBatchInTransaction(tx, input);
    await tx.execute("UPDATE joint_owner_documents SET result_summary=? WHERE id=? AND result_summary IS NULL", [JSON.stringify(result), input.source.documentId]);
    for (const line of result.lines) await tx.execute("UPDATE joint_owner_lines SET inventory_result=? WHERE document_id=? AND source_line_id=? AND inventory_result IS NULL", [JSON.stringify(line), input.source.documentId, line.sourceLineId]);
    return result;
  }, db);
}

function reversal(input, original, quantity = 1) {
  return { actor: structuredClone(actor), correlationId: randomUUID(), source: { documentId: input.source.documentId, eventId: randomUUID() },
    goodsReceiptId: input.source.documentId, reasonText: "Correct synthetic received quantity", lines: original.lines.map(line => ({
      sourceLineId: line.sourceLineId, originalSourceLineId: line.sourceLineId, originalMovementId: line.movementId, baseQuantity: quantity })) };
}
function reverse(input, db = database()) {
  return run(input, "reversal", async (tx, req) => {
    const [[owner]] = await tx.query("SELECT status FROM joint_owner_documents WHERE id=?", [input.goodsReceiptId]);
    const [lines] = await tx.query("SELECT source_line_id,inventory_result FROM joint_owner_lines WHERE document_id=? ORDER BY source_line_id", [input.goodsReceiptId]);
    input.context = issuePurchaseReversalContext(req, tx, input, { ...authOptions(db), ownerProof: { goodsReceiptId: input.goodsReceiptId,
      status: owner.status, details: lines.map(row => ({ sourceLineId: row.source_line_id, goodsReceiptId: input.goodsReceiptId,
        originalMovementId: row.inventory_result.movementId })) } });
    const result = await new InventoryPostingService(serviceOptions(db)).reversePurchaseReceiptBatchInTransaction(tx, input);
    await tx.execute("UPDATE joint_owner_documents SET status='PARTIALLY_REVERSED',reversal_summary=? WHERE id=?", [JSON.stringify(result), input.goodsReceiptId]);
    return result;
  }, db);
}

async function draft(f, bins = [f.bins[0]]) {
  return stock("create", stockCommand("create", { warehouseId: f.warehouseId, binIds: bins }));
}
const startInput = header => stockCommand("start", { stocktakeId: header.id, expectedVersion: header.version });
const workflow = (action, header) => stockCommand(action, { stocktakeId: header.id, expectedVersion: header.version,
  ...(action === "ready" ? {} : { reason: "Synthetic physical reconciliation" }) });
async function started(f, bins) { return stock("start", startInput(await draft(f, bins))); }
async function ready(header, quantities) {
  const [lines] = await query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY bin_id,id", [header.id]);
  assert.equal(lines.length, quantities.length);
  await stock("saveCounts", { ...stockCommand("count", { stocktakeId: header.id, lines: lines.map((line, i) => ({ lineId: Number(line.id),
    expectedVersion: Number(line.version), countedQuantity: quantities[i] })) }) });
  return stock("ready", workflow("ready", header));
}
async function unchanged(work, expected = "BIN_LOCKED_BY_STOCKTAKE") {
  const before = await snapshot();
  await assert.rejects(work, error => { assert.equal(error.terminalError, undefined); assert.equal(code(error), expected); return true; });
  assert.deepEqual(await snapshot(), before, "all persisted owner, ledger, link and stocktake rows must roll back");
}

async function waitForWarehouse(waiter, blocker) {
  const deadline = Date.now() + 5000;
  do {
    const [rows] = await observationQuery(deadline, `SELECT w.REQUESTING_THREAD_ID,w.BLOCKING_THREAD_ID FROM performance_schema.data_lock_waits w
      JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      WHERE w.REQUESTING_THREAD_ID=? AND w.BLOCKING_THREAD_ID=? AND l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='inventory_warehouses'`,
    [waiter.performanceThreadId, blocker.performanceThreadId, schema]);
    if (rows.length) { observations.push({ status: "WAREHOUSE_WAIT_CONFIRMED", waiter, blocker }); return; }
    await setImmediate();
  } while (Date.now() < deadline);
  assert.fail("actual owned waiter/blocker Warehouse lock edge was not observed");
}
async function ordered(firstWork, secondWork) {
  const acquired = latch(), entered = latch(), release = latch(); let held = false, second, primary;
  const firstDb = database({ afterQuery: async (sql, identity) => {
    if (!held && warehouseLock(sql)) { held = true; acquired.resolve(identity); await release.promise; }
  } });
  const secondDb = database({ beforeQuery: async (sql, identity) => { if (warehouseLock(sql)) entered.resolve(identity); } });
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  const first = settled(firstWork(firstDb));
  try {
    const blocker = await Promise.race([acquired.promise, first.then(outcome => { throw outcome.error ?? new Error("first operation ended before Warehouse barrier"); })]);
    second = settled(secondWork(secondDb));
    const waiter = await Promise.race([entered.promise, second.then(outcome => { throw outcome.error ?? new Error("second operation ended before Warehouse wait"); })]);
    await waitForWarehouse(waiter, blocker);
  } catch (error) { primary = error; }
  finally { release.resolve(); }
  const results = await Promise.all([first, ...(second ? [second] : [])]);
  if (primary) {
    primary.secondaryErrors = results.flatMap(outcome => outcome.error && outcome.error !== primary ? [outcome.error] : []);
    throw primary;
  }
  for (const outcome of results) if (outcome.error?.terminalError) throw outcome.error;
  assert.equal(results.length, 2); assert.equal(results[0].error, undefined);
  return results;
}

async function assertStartedSnapshot(header, f, expectedQuantities) {
  const [lines] = await query("SELECT * FROM inventory_stocktake_lines WHERE stocktake_id=? ORDER BY bin_id,id", [header.id]);
  const [balances] = await query("SELECT * FROM inventory_stock_balances WHERE warehouse_id=? ORDER BY bin_id,id", [f.warehouseId]);
  const [locks] = await query("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY bin_id,id", [header.id]);
  assert.deepEqual(lines.map(line => Number(line.snapshot_quantity)), expectedQuantities);
  assert.deepEqual(lines.map(line => [Number(line.stock_balance_id), Number(line.snapshot_quantity), Number(line.snapshot_balance_version)]),
    balances.map(balance => [Number(balance.id), Number(balance.on_hand_quantity), Number(balance.version)]));
  const [[scope]] = await query("SELECT COUNT(*) AS n FROM inventory_stocktake_bins WHERE stocktake_id=?", [header.id]);
  assert.equal(locks.length, Number(scope.n));
  assert.ok(locks.every(lock => lock.released_at === null && Number(lock.stocktake_id) === header.id));
}

native("JP01 actual started-bin lock rolls a receipt and its owner projections back", async () => {
  const f = await fixture(), input = await receiptCommand(f);
  await started(f);
  await unchanged(() => receipt(input));
});

native("JP02 actual started-bin lock preserves original receipt and cumulative partial reversal links", async () => {
  const f = await fixture({ lotTracked: true }), input = await receiptCommand(f), original = await receipt(input);
  await reverse(reversal(input, original, 2));
  await started(f);
  await unchanged(() => reverse(reversal(input, original, 1)));
  const [links] = await query("SELECT quantity FROM inventory_purchase_reversal_links WHERE original_movement_id=?", [original.lines[0].movementId]);
  assert.deepEqual(links.map(row => Number(row.quantity)), [2]);
});

native("JP03 one permitted and one locked receipt detail fail as a whole batch with retry identity preserved", async () => {
  const f = await fixture(), input = await receiptCommand(f, f.bins.slice(0, 2));
  await started(f, [f.bins[1]]);
  await unchanged(() => receipt(input));
  assert.equal((await query("SELECT id FROM inventory_operation_requests WHERE source_event_id=?", [input.source.eventId]))[0].length, 0);
});

native("JP04 one locked partial reversal detail rolls every link, movement, result and owner projection back", async () => {
  const f = await fixture(), input = await receiptCommand(f, f.bins.slice(0, 2)), original = await receipt(input);
  await started(f, [f.bins[1]]);
  await unchanged(() => reverse(reversal(input, original, 2)));
});

for (const [id, writerFirst, isReversal] of [["JP05", false, false], ["JP06", true, false], ["JP07", false, true], ["JP08", true, true]]) {
  native(`${id} actual Warehouse serialization: ${writerFirst ? "writer" : "Start"} wins against ${isReversal ? "partial reversal" : "receipt"}`, async () => {
    const f = await fixture({ lotTracked: isReversal }), input = await receiptCommand(f, f.bins.slice(0, 2)), original = isReversal ? await receipt(input) : null;
    if (id === "JP08") await reverse(reversal(input, original, 7));
    const header = await draft(f, f.bins.slice(0, 2)), start = startInput(header), reverseInput = original ? reversal(input, original, 2) : null;
    const before = await snapshot();
    const writer = db => original ? reverse(reverseInput, db) : receipt(input, db);
    const starter = db => stock("start", start, db);
    const observationStart = observations.length;
    const result = await ordered(writerFirst ? writer : starter, writerFirst ? starter : writer);
    if (id === "JP06" && code(result[1].error) === "CONCURRENT_OPERATION") {
      // The documented client policy allows one fresh-transaction retry of the
      // original business event after a fully rolled-back deadlock. No app retry.
      const attemptObservations = observations.slice(observationStart);
      const wait = attemptObservations.find(event => event.status === "WAREHOUSE_WAIT_CONFIRMED");
      const deadlock = attemptObservations.find(event => event.status === "NATIVE_QUERY_FAILURE" && event.code === "ER_LOCK_DEADLOCK");
      assert.ok(wait && deadlock && deadlock.threadId === wait.waiter.threadId);
      assert.match(deadlock.sql, /FROM inventory_warehouses.*FOR UPDATE/u);
      const rolledBack = await snapshot();
      assert.deepEqual(rolledBack.inventory_stocktakes, before.inventory_stocktakes);
      assert.deepEqual(rolledBack.inventory_stocktake_bins, before.inventory_stocktake_bins);
      assert.deepEqual(rolledBack.inventory_stocktake_lines, before.inventory_stocktake_lines);
      assert.deepEqual(rolledBack.inventory_bin_locks, before.inventory_bin_locks);
      assert.deepEqual(rolledBack.inventory_operation_requests.filter(row => row.source_event_id === start.source.eventId), []);
      assert.deepEqual(rolledBack.inventory_audit_logs.filter(row => row.request_id === start.correlationId), []);
      assert.ok(attemptObservations.some(event => event.status === "SQL_TERMINAL_CONFIRMED" && event.threadId === deadlock.threadId && event.outcome === "REJECTED"));
      observations.push({ status: "EXPLICIT_CLIENT_RETRY_AFTER_CONFIRMED_DEADLOCK_ROLLBACK", sourceEventId: start.source.eventId,
        firstOutcome: "CONCURRENT_OPERATION", firstStartPersistedEffects: 0, freshTransactionAndAuthorization: true });
      result[1] = { value: await starter(database()) };
    }
    if (writerFirst) assert.ifError(result[1].error);
    const after = await snapshot();
    for (const table of ["inventory_stocktake_bins", "inventory_lots", "inventory_reservations", "inventory_allocations"])
      assert.deepEqual(after[table], before[table], `${table}: serialization preserves unrelated facts`);
    assert.deepEqual(after.inventory_stocktakes.filter(row => Number(row.id) !== header.id), before.inventory_stocktakes.filter(row => Number(row.id) !== header.id));
    assert.deepEqual(after.inventory_operation_requests.filter(row => before.inventory_operation_requests.some(old => old.id === row.id)), before.inventory_operation_requests, "previous completed operation bytes remain unchanged");
    assert.deepEqual(after.inventory_audit_logs.filter(row => before.inventory_audit_logs.some(old => old.id === row.id)), before.inventory_audit_logs, "previous immutable Audit bytes remain unchanged");
    if (original || !writerFirst) assert.deepEqual(after.inventory_stock_controls, before.inventory_stock_controls);
    else {
      assert.deepEqual(after.inventory_stock_controls.filter(row => before.inventory_stock_controls.some(old => old.id === row.id)), before.inventory_stock_controls);
      const addedControls = after.inventory_stock_controls.filter(row => !before.inventory_stock_controls.some(old => old.id === row.id));
      assert.equal(addedControls.length, 1);
      assert.deepEqual([Number(addedControls[0].warehouse_id), Number(addedControls[0].sku_id), Number(addedControls[0].reserved_quantity), Number(addedControls[0].version)],
        [f.warehouseId, f.skuId, 0, 1]);
    }
    assert.equal(after.inventory_audit_logs.length - before.inventory_audit_logs.length, writerFirst ? 3 : 1);
    assert.equal(after.inventory_operation_requests.length - before.inventory_operation_requests.length, writerFirst ? 4 : 1);
    if (writerFirst) {
      await assertStartedSnapshot(result[1].value, f, original ? [1, 1] : [10, 10]);
      assert.deepEqual(result[0].value.lines.map(line => line.sourceLineId), input.lines.map(line => line.sourceLineId));
      const movements = after.inventory_movements.filter(row => !before.inventory_movements.some(old => old.id === row.id));
      assert.equal(movements.length, 2);
      assert.deepEqual(movements.map(row => Number(row.id)).sort((a, b) => a - b), result[0].value.lines.map(line => Number(line.movementId)).sort((a, b) => a - b));
      assert.ok(movements.every(row => row.direction === (original ? "OUT" : "IN") && Number(row.quantity) === (original ? 2 : 10)));
      assert.deepEqual(after.inventory_movements.filter(row => before.inventory_movements.some(old => old.id === row.id)), before.inventory_movements, "all previously committed movement facts remain byte-identical");
      assert.deepEqual(after.inventory_purchase_reversal_links.filter(row => before.inventory_purchase_reversal_links.some(old => old.id === row.id)), before.inventory_purchase_reversal_links);
      for (const line of result[0].value.lines) {
        const detail = input.lines.find(detail => detail.sourceLineId === line.sourceLineId);
        const movement = movements.find(row => Number(row.id) === line.movementId);
        const oldBalance = before.inventory_stock_balances.find(row => Number(row.warehouse_id) === f.warehouseId && Number(row.bin_id) === detail.binId && Number(row.sku_id) === f.skuId);
        const balance = after.inventory_stock_balances.find(row => Number(row.warehouse_id) === f.warehouseId && Number(row.bin_id) === detail.binId && Number(row.sku_id) === f.skuId);
        const originalMovement = original ? before.inventory_movements.find(row => Number(row.id) === line.originalMovementId) : null;
        assert.deepEqual([Number(movement.operation_request_id), movement.movement_group_id, movement.movement_type, movement.location_kind,
          Number(movement.warehouse_id), Number(movement.bin_id), Number(movement.sku_id), movement.lot_id, movement.stock_status],
        [line.operationId, line.movementGroupId, original ? "REVERSAL" : "RECEIPT", "BIN", f.warehouseId, detail.binId, f.skuId, originalMovement?.lot_id ?? null, detail.stockStatus]);
        assert.deepEqual([Number(movement.balance_before), Number(movement.balance_after), Number(movement.balance_version_after)],
          [Number(oldBalance?.on_hand_quantity ?? 0), Number(balance.on_hand_quantity), Number(oldBalance?.version ?? 1) + 1]);
        assert.equal(Number(balance.version), Number(movement.balance_version_after));
        assert.equal(balance.lot_id, movement.lot_id);
        assert.equal(movement.reversal_of_movement_id, null, "partial Purchasing inverses use the actual cumulative link relation");
        const operation = after.inventory_operation_requests.find(row => Number(row.id) === line.operationId);
        assert.deepEqual([operation.source_module, operation.source_document_type, operation.source_document_id, operation.source_line_id, operation.source_event_id],
          ["PURCHASING_RECEIVING", original ? "GOODS_RECEIPT_REVERSAL" : "GOODS_RECEIPT", input.source.documentId, line.sourceLineId, (reverseInput ?? input).source.eventId]);
        assert.notEqual(operation.completed_at, null);
        assert.equal(operation.result_summary.movementId, line.movementId);
        assert.equal(operation.result_summary.rootOperationId, result[0].value.operationId);
        const audit = after.inventory_audit_logs.find(row => Number(row.operation_request_id) === line.operationId);
        assert.equal(audit.after_summary.movementId, line.movementId);
        assert.equal(audit.after_summary.onHandQuantity, Number(balance.on_hand_quantity));
        assert.equal(audit.after_summary.version, Number(balance.version));
        if (original) {
          const links = after.inventory_purchase_reversal_links.filter(row => Number(row.reversal_movement_id) === line.movementId);
          assert.equal(links.length, 1);
          assert.deepEqual([Number(links[0].original_movement_id), Number(links[0].operation_request_id), Number(links[0].quantity)],
            [line.originalMovementId, line.operationId, line.baseQuantity]);
        } else {
          const ownerLine = after.joint_owner_lines.find(row => String(row.document_id) === input.source.documentId && row.source_line_id === line.sourceLineId);
          assert.deepEqual(ownerLine.inventory_result, line);
        }
      }
      if (original) assert.deepEqual(after.joint_owner_lines, before.joint_owner_lines, "reversal preserves every original owner-line result projection");
      const owner = after.joint_owner_documents.find(row => String(row.id) === input.source.documentId);
      assert.deepEqual(original ? owner.reversal_summary : owner.result_summary, result[0].value);
      const replayBefore = await snapshot();
      assert.deepEqual(await (original ? reverse(reverseInput) : receipt(input)), result[0].value);
      assert.deepEqual(await snapshot(), replayBefore, "exact source replay returns original complete result without effects");
    } else {
      assert.equal(code(result[1].error), "BIN_LOCKED_BY_STOCKTAKE");
      for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_lots", "inventory_movements", "inventory_purchase_reversal_links", "joint_owner_documents", "joint_owner_lines"])
        assert.deepEqual(after[table], before[table], `${table}: loser left no committed writer effects`);
      await assertStartedSnapshot(result[0].value, f, original ? [10, 10] : []);
      assert.equal(after.inventory_operation_requests.filter(row => row.source_event_id === (reverseInput ?? input).source.eventId).length,
        original ? before.inventory_operation_requests.filter(row => row.source_event_id === reverseInput.source.eventId).length : 0);
    }
    if (original) {
      const [totals] = await query("SELECT original_movement_id,SUM(quantity) AS quantity FROM inventory_purchase_reversal_links WHERE original_movement_id IN (?,?) GROUP BY original_movement_id ORDER BY original_movement_id", original.lines.map(line => line.movementId));
      assert.deepEqual(totals.map(row => Number(row.quantity)), writerFirst ? [9, 9] : []);
      if (writerFirst) {
        await stock("cancel", workflow("cancel", result[1].value));
        await receipt(await receiptCommand(f, f.bins.slice(0, 2), 3));
        const [physical] = await query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE warehouse_id=? ORDER BY bin_id,id", [f.warehouseId]);
        assert.deepEqual(physical.map(row => Number(row.on_hand_quantity)), [4, 4], "physical stock independently permits2; original cumulative remaining1 must still prohibit it");
        const beyondRemaining = reversal(input, original, 2);
        assert.notEqual(beyondRemaining.source.eventId, reverseInput.source.eventId);
        await unchanged(() => reverse(beyondRemaining), "REVERSAL_NOT_ALLOWED");
      }
    }
  });
}

function reservationInput(f, quantity, sales = false) {
  const eventId = randomUUID();
  return { actor: structuredClone(actor), ...(sales ? {} : { authorization: { purpose: "reservation.create", requiredCallerPermission: "inventory.operation" } }),
    source: sales ? { documentId: String(f.warehouseId), lineId: "1", eventId }
      : { module: "INVENTORY", documentType: "RESERVATION", documentId: String(f.warehouseId), lineId: "", eventId },
    correlationId: eventId, payload: { skuId: f.skuId, warehouseId: f.warehouseId, quantity, purpose: "SALE", minimumRemainingDays: 0 } };
}
function reserve(input, db = database(), sales = false) {
  return run(input, "reservation", tx => new InventoryReservationService(serviceOptions(db))[sales ? "createSalesReservationInTransaction" : "createInTransaction"](tx, input), db);
}
function allocationInput(reservation, balance, quantity) {
  const eventId = randomUUID();
  return { actor: structuredClone(actor), authorization: { purpose: "allocation.create", requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "ALLOCATION", documentId: String(reservation.id), lineId: "", eventId }, correlationId: eventId,
    payload: { reservationId: reservation.id, expectedVersion: reservation.version,
      allocations: [{ balanceId: Number(balance.id), expectedVersion: Number(balance.version), quantity }], overrideReason: "" } };
}
const allocate = (input, db = database()) => run(input, "allocation", tx => new InventoryReservationService(serviceOptions(db)).allocateInTransaction(tx, input), db);

native("JP09 real Reservation winner forces waiting Post to recheck complete final Reserved coverage", async () => {
  const f = await fixture(); await receipt(await receiptCommand(f));
  const header = await ready(await started(f), [2]), before = await snapshot();
  const result = await ordered(db => reserve(reservationInput(f, 8), db), db => stock("post", workflow("post", header), db));
  assert.equal(result[0].value.outstandingQuantity, 8); assert.equal(code(result[1].error), "INSUFFICIENT_ATP");
  const after = await snapshot();
  for (const table of tables.filter(table => !["inventory_stock_controls", "inventory_reservations", "inventory_operation_requests", "inventory_audit_logs"].includes(table))) assert.deepEqual(after[table], before[table]);
  const [[control]] = await query("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id=?", [f.warehouseId, f.skuId]);
  assert.equal(Number(control.reserved_quantity), 8);
  assert.ok(2 < Number(control.reserved_quantity), "proposed final coverage would create uncovered Reserved");
  await stock("cancel", workflow("cancel", header));
  // An explicit zero physical bucket makes the loss-before-gain ordering observable.
  await insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,allocated_quantity,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',0,0,1,1)", [f.warehouseId, f.bins[1], f.skuId]);
  const counting = await started(f, f.bins.slice(0, 2));
  await assertStartedSnapshot(counting, f, [10, 0]);
  const covered = await ready(counting, [2, 8]), postBefore = await snapshot();
  assert.ok(2 < Number(control.reserved_quantity) && 2 + 8 >= Number(control.reserved_quantity), "first loss alone fails Reserved coverage; complete final gain makes the batch valid");
  const posted = await stock("post", workflow("post", covered)), postAfter = await snapshot();
  assert.equal(posted.status, "POSTED"); assert.equal(posted.rowCount, 2);
  assert.deepEqual(postAfter.inventory_reservations, postBefore.inventory_reservations);
  assert.deepEqual(postAfter.inventory_stock_controls, postBefore.inventory_stock_controls);
  const [[final]] = await query("SELECT SUM(on_hand_quantity) AS quantity FROM inventory_stock_balances WHERE warehouse_id=? AND sku_id=? AND stock_status='AVAILABLE'", [f.warehouseId, f.skuId]);
  assert.equal(Number(final.quantity), 10, "a real successful Post uses complete final coverage across the loss and gain buckets");
  const [finalBuckets] = await query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE warehouse_id=? ORDER BY bin_id,id", [f.warehouseId]);
  assert.deepEqual(finalBuckets.map(row => Number(row.on_hand_quantity)), [2, 8]);
  assert.equal(postAfter.inventory_movements.length - postBefore.inventory_movements.length, 2);
  assert.equal(postAfter.inventory_audit_logs.length - postBefore.inventory_audit_logs.length, 3);
});

native("JP10 real Allocation/Start contention preserves per-Bucket floor independently of warehouse Reserved coverage", async () => {
  const f = await fixture(); await receipt(await receiptCommand(f, f.bins.slice(0, 2)));
  const reservation = await reserve(reservationInput(f, 8)), header = await draft(f, f.bins.slice(0, 2));
  const [[balance]] = await query("SELECT * FROM inventory_stock_balances WHERE warehouse_id=? AND bin_id=?", [f.warehouseId, f.bins[0]]);
  const result = await ordered(db => allocate(allocationInput(reservation, balance, 8), db), db => stock("start", startInput(header), db));
  assert.equal(result[1].error, undefined);
  await assertStartedSnapshot(result[1].value, f, [10, 10]);
  const readyHeader = await ready(result[1].value, [1, 19]);
  const [[control]] = await query("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id=?", [f.warehouseId, f.skuId]);
  assert.ok(1 + 19 >= Number(control.reserved_quantity), "warehouse Reserved coverage is satisfied, isolating the allocated floor");
  const [[allocated]] = await query("SELECT allocated_quantity FROM inventory_stock_balances WHERE id=?", [balance.id]);
  assert.equal(Number(allocated.allocated_quantity), 8);
  await unchanged(() => stock("post", workflow("post", readyHeader)), "INSUFFICIENT_STOCK");
});

async function fulfillment(action, input, db = database()) {
  // Existing main requires RC for Fulfillment; Purchase and stocktake remain RR.
  return run(input, "fulfillment", async tx => {
    const provider = new InventoryFulfillmentService(serviceOptions(db));
    const proof = await provider.claimFulfillmentBatchInTransaction(tx, { action, command: input });
    return provider[action === "ALLOCATE" ? "allocateForFulfillmentBatchInTransaction" : "postFulfillmentIssueBatchInTransaction"](tx, input, proof);
  }, db, { isolationLevel: "READ COMMITTED" });
}

native("JP11 actual merged Fulfillment Issue cannot bypass a real started-bin lock", async () => {
  const f = await fixture(); await receipt(await receiptCommand(f));
  const reservation = await reserve(reservationInput(f, 5, true), database(), true);
  const [[balance]] = await query("SELECT * FROM inventory_stock_balances WHERE warehouse_id=?", [f.warehouseId]);
  const fulfillmentId = String(f.warehouseId), member = { claimId: "1", inventoryReservationId: String(reservation.id), expectedVersion: reservation.version,
    baseQuantity: "5", overrideReason: "", allocations: [{ inventoryBalanceId: String(balance.id), expectedBalanceVersion: Number(balance.version), baseQuantity: "5" }] };
  const input = { actor: structuredClone(actor), source: { documentId: fulfillmentId, eventId: randomUUID() }, correlationId: "joint-fulfillment",
    payload: { fulfillmentId, lines: [{ fulfillmentLineId: "1", salesOrderLineId: "1", baseQuantity: "5", reservations: [member] }] } };
  const allocated = await fulfillment("ALLOCATE", input), allocatedMember = allocated.lines[0].reservations[0], leg = allocatedMember.allocations[0];
  const issue = { actor: structuredClone(actor), source: { documentId: fulfillmentId, eventId: randomUUID() }, correlationId: "joint-issue",
    payload: { fulfillmentId, shipmentId: fulfillmentId, lines: [{ fulfillmentLineId: "1", salesOrderLineId: "1", baseQuantity: "5", reservations: [{
      claimId: "1", inventoryReservationId: String(reservation.id), expectedVersion: allocatedMember.version, baseQuantity: "5", allocations: [{
        inventoryAllocationId: leg.inventoryAllocationId, inventoryBalanceId: String(balance.id), expectedVersion: leg.allocationVersion,
        expectedBalanceVersion: leg.balanceVersion, baseQuantity: "5" }] }] }] } };
  await started(f);
  await unchanged(() => fulfillment("ISSUE", issue));
});

native("JP12 Cancel releases only own locks and identical blocked source safely retries with fresh authorization", async () => {
  const f = await fixture(), input = await receiptCommand(f), own = await started(f), foreign = await started(f, [f.bins[1]]);
  await unchanged(() => receipt(input));
  const before = await snapshot(), foreignLocks = before.inventory_bin_locks.filter(row => Number(row.stocktake_id) === foreign.id);
  const ownLocks = before.inventory_bin_locks.filter(row => Number(row.stocktake_id) === own.id);
  assert.equal(ownLocks.length, 1); assert.equal(foreignLocks.length, 1);
  assert.equal(ownLocks[0].released_at, null); assert.equal(foreignLocks[0].released_at, null);
  const cancelled = await stock("cancel", workflow("cancel", own));
  assert.equal(cancelled.status, "CANCELLED");
  const afterCancel = await snapshot();
  assert.deepEqual(afterCancel.inventory_bin_locks.filter(row => Number(row.stocktake_id) === foreign.id), foreignLocks);
  assert.deepEqual(afterCancel.inventory_bin_locks.filter(row => Number(row.stocktake_id) === own.id), ownLocks.map(row => ({ ...row,
    released_at: NOW, released_by: actor.userId, release_reason: "CANCELLED", active_scope: null })), "preserve exact owned lock identities and immutable fields; change only release fields");
  assert.deepEqual(afterCancel.inventory_bin_locks.filter(row => Number(row.stocktake_id) !== own.id), before.inventory_bin_locks.filter(row => Number(row.stocktake_id) !== own.id));
  for (const table of tables.filter(table => !["inventory_stocktakes", "inventory_bin_locks", "inventory_operation_requests", "inventory_audit_logs"].includes(table))) assert.deepEqual(afterCancel[table], before[table]);
  const result = await receipt(input), beforeReplay = await snapshot();
  assert.equal(result.status, "POSTED"); assert.equal(result.lines[0].baseQuantity, 10);
  assert.deepEqual(await receipt(input), result);
  assert.deepEqual(await snapshot(), beforeReplay);
  assert.deepEqual((await query("SELECT * FROM inventory_bin_locks WHERE stocktake_id=? ORDER BY id", [foreign.id]))[0], foreignLocks);
});
