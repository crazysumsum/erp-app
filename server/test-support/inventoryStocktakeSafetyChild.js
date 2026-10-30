import assert from "node:assert/strict";
import path from "node:path";
import mysql from "mysql2/promise";

import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryTransferService } from "../src/modules/inventory/InventoryTransferService.js";
import { issueInventoryHighRiskContext } from "../src/modules/inventory/inventoryHighRiskContext.js";
import { issueInventoryStocktakeCancelContext } from "../src/modules/inventory/inventoryStocktakeCancelContext.js";

const time = { nowMs: () => Date.now(), fileDate: () => new Date().toISOString().slice(0, 10) };
const logger = { error() {} };
let pool, activeConnection, releaseCheckpoint, runStarted = false, disconnected = false;

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected) { reject(new Error("Parent disconnected")); return; }
    process.send(message, error => error ? reject(error) : resolve());
  });
}

async function cleanup() {
  releaseCheckpoint?.reject(new Error("Parent disconnected"));
  activeConnection?.destroy();
  if (pool) { const closing = pool; pool = null; await closing.end(); }
}

function validateInput(input) {
  assert.ok(input && typeof input === "object" && !Array.isArray(input));
  assert.ok(Object.keys(input).every(key => ["actor", "authorization", "source", "correlationId", "payload"].includes(key)));
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!/password|jwt|proof|token|signature|private.?key|public.?key/iu.test(key));
      inspect(nested);
    }
  }
  inspect(input);
}

// Native trusted fixture boundary: no HTTP, password or signature verification is claimed.
async function trustedContext(input, operation) {
  operation = operation.replace(/InTransaction$/u, "");
  const high = ["stocktake:post", "writer:postAdjustment", "writer:postStatusTransfer", "writer:reverseMovement"].includes(operation);
  if (!high && operation !== "stocktake:cancel") return undefined;
  const routes = {
    "stocktake:post": "/api/v1/inventory/stocktakes/:id/post",
    "stocktake:cancel": "/api/v1/inventory/stocktakes/:id/cancel",
    "writer:postAdjustment": "/api/v1/inventory/adjustments",
    "writer:postStatusTransfer": "/api/v1/inventory/status-transfers",
    "writer:reverseMovement": "/api/v1/inventory/movements/:id/reverse"
  };
  const now = time.nowMs(), authType = high ? "jwt-device-password" : "jwt-password";
  const claims = { sub: String(input.actor.userId), roles: input.actor.claimedRoles,
    permissions: input.actor.claimedPermissions, ver: 0, exp: Math.floor(now / 1000) + 900,
    auth_time: Math.floor(now / 1000) };
  let binding;
  if (high) {
    const [rows] = await pool.execute("SELECT id,user_id,device_id,public_key,status FROM user_devices WHERE user_id=? ORDER BY id", [input.actor.userId]);
    binding = rows.find(row => row.status === "approved");
    assert.ok(binding, "Owned fixture requires an approved device");
    claims.did = binding.device_id;
  }
  const resourceId = operation === "writer:reverseMovement" ? input.payload.movementId : input.payload.stocktakeId;
  const req = Object.seal({ method: "POST", apiRoute: { path: routes[operation], authType },
    input: { params: { id: String(resourceId) } }, get: () => String(now),
    auth: { type: authType, claims, ...(high ? { deviceBinding: binding } : {}) } });
  return (high ? issueInventoryHighRiskContext : issueInventoryStocktakeCancelContext)(req, input, {
    time, signatureMaxSkewSeconds: 60, sessionMaxAgeSeconds: 3600, clockToleranceSeconds: 0
  });
}

function transactionDatabase(checkpoint) {
  let hits = 0, reached = false;
  const pattern = checkpoint ? new RegExp(checkpoint.pattern, "u") : null;
  async function barrier(stage, sql, threadId) {
    if (!checkpoint || reached || stage !== checkpoint.stage || !pattern.test(sql) || ++hits !== checkpoint.nth) return;
    reached = true;
    let resolve, reject;
    const released = new Promise((done, fail) => { resolve = done; reject = fail; });
    releaseCheckpoint = { resolve, reject };
    try { await send({ type: "checkpoint", stage, threadId, pid: process.pid }); await released; }
    finally { releaseCheckpoint = null; }
  }
  return {
    query: (...args) => pool.query(...args),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      activeConnection = connection;
      const threadId = connection.threadId;
      let committed = false;
      try {
        await connection.query("SET SESSION innodb_lock_wait_timeout=15");
        await connection.beginTransaction();
        await send({ type: "transaction", threadId });
        const tx = { threadId };
        for (const method of ["query", "execute"]) tx[method] = async (sql, params) => {
          if (/SELECT[\s\S]*FROM\s+inventory_warehouses\b[\s\S]*FOR UPDATE/iu.test(sql)) {
            await send({ type: "warehouseAttempt", threadId });
          }
          const result = await connection[method](sql, params);
          await barrier(method === "query" ? "afterQuery" : "afterExecute", sql, threadId);
          return result;
        };
        const result = await work(tx);
        await barrier("beforeCommit", "COMMIT", threadId);
        await connection.commit();
        committed = true;
        await barrier("afterCommit", "COMMIT", threadId);
        return result;
      } catch (error) {
        if (!committed && !disconnected) await connection.rollback();
        throw error;
      } finally {
        activeConnection = null;
        if (!disconnected) connection.release();
      }
    }
  };
}

async function run(message) {
  validateInput(message.input);
  if (message.checkpoint) {
    assert.ok(["afterQuery", "afterExecute", "beforeCommit", "afterCommit"].includes(message.checkpoint.stage));
    assert.equal(typeof message.checkpoint.pattern, "string");
    assert.ok(Number.isSafeInteger(message.checkpoint.nth) && message.checkpoint.nth > 0);
  }
  const stocktakeMethods = { create: "create", update: "update", cancelDraft: "cancelDraft",
    start: "start", saveCounts: "saveCounts", ready: "ready", post: "post", cancel: "cancel" };
  const writerMethods = ["postReceipt", "postReceiptInTransaction", "postIssue", "postIssueInTransaction",
    "postReceivingReceiptInTransaction", "postCustomerReturnReceiptInTransaction", "postFulfillmentIssueInTransaction",
    "postBinMove", "postBinMoveInTransaction", "postAdjustment", "postAdjustmentInTransaction", "postStatusTransfer", "postStatusTransferInTransaction", "reverseMovement", "reverseMovementInTransaction"];
  const [kind, action, extra] = String(message.operation).split(":");
  assert.equal(extra, undefined);
  assert.ok(kind === "stocktake" ? Object.hasOwn(stocktakeMethods, action)
    : kind === "writer" ? writerMethods.includes(action) : kind === "transfer" && ["create", "dispatch", "receive"].includes(action));
  const database = transactionDatabase(message.checkpoint), options = { database, time, logger };
  const service = kind === "stocktake" ? new InventoryStocktakeService(options)
    : kind === "writer" ? new InventoryPostingService(options) : new InventoryTransferService(options);
  const method = kind === "stocktake" ? stocktakeMethods[action] : action;
  const context = await trustedContext(message.input, message.operation);
  return method.endsWith("InTransaction")
    ? database.withTransaction(tx => service[method](tx, message.input, context))
    : service[method](message.input, context);
}

process.on("disconnect", () => { disconnected = true; void cleanup().finally(() => process.exit(0)); });
process.on("message", message => {
  if (message?.type === "release") { releaseCheckpoint?.resolve(); return; }
  if (message?.type !== "run" || runStarted) return;
  runStarted = true;
  void (async () => {
    try { await send({ type: "result", ok: true, result: await run(message) }); }
    catch (error) {
      const code = /^[A-Z][A-Z0-9_]*$/u.test(error?.code ?? "") ? error.code : "FIXTURE_ERROR";
      if (process.connected) await send({ type: "result", ok: false, error: { code, message: "Owned Inventory fixture operation failed" } });
    } finally {
      await cleanup();
      if (process.connected && message.keepAlive === true) await send({ type: "idle", pid: process.pid });
      else if (process.connected) process.disconnect();
    }
  })();
});

try {
  assert.equal(process.env.DB_INTEGRATION_TESTS, "1");
  assert.equal(process.env.INVENTORY_STOCKTAKE_SAFETY_TESTS, "1");
  assert.match(process.env.DB_NAME ?? "", /^erp_inventory_task041_[a-z0-9_]+$/u);
  assert.match(process.env.DB_SOCKET_PATH ?? "", /^\/private\/tmp\/erp-inventory-task041-mysql-2670\.[A-Za-z0-9]+\/mysql\.sock$/u);
  assert.equal(process.env.DB_USER, "root");
  assert.equal(process.env.DB_PASSWORD, "");
  assert.ok(process.connected);
  pool = mysql.createPool({ socketPath: process.env.DB_SOCKET_PATH, user: "root", password: "",
    database: process.env.DB_NAME, connectionLimit: 1 });
  const [[environment]] = await pool.query("SELECT VERSION() AS version,DATABASE() AS schema_name,@@skip_networking AS isolated,@@datadir AS datadir,CONNECTION_ID() AS threadId");
  assert.equal(environment.version, "26.7.0");
  assert.equal(environment.schema_name, process.env.DB_NAME);
  assert.equal(Number(environment.isolated), 1);
  const ownedRoot = path.dirname(process.env.DB_SOCKET_PATH);
  assert.equal(path.resolve(environment.datadir), path.join(ownedRoot, "data"));
  await send({ type: "ready", pid: process.pid, threadId: Number(environment.threadId) });
} catch {
  if (process.connected) await send({ type: "result", ok: false, error: { code: "FIXTURE_ENVIRONMENT_INVALID", message: "Owned MySQL fixture identity check failed" } });
  await cleanup();
  if (process.connected) process.disconnect();
  process.exitCode = 1;
}
