import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import mysql from "mysql2/promise";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerImportService } from "../../src/modules/customer/CustomerImportService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { parseAndPrecheckCustomerCsv } from "../../src/modules/customer/import/CustomerImportProcessor.js";
import { CUSTOMER_IMPORT_COLUMN_NAMES } from "../../src/modules/customer/import/customerCsvSchema.js";
import { CustomerImportStorage } from "../../src/services/customerImport/CustomerImportStorage.js";

const enabled = process.env.DB_INTEGRATION_TESTS === "1" && process.env.CUSTOMER_IMPORT_PERFORMANCE_TESTS === "1";
const performanceTest = enabled ? test : test.skip;
const ROW_COUNT = 10_000;
const IMPORT_BUDGET_MS = 10 * 60 * 1_000;
const LOOKUP_P95_BUDGET_MS = 2_000;
const HEAP_GROWTH_BUDGET_BYTES = 256 * 1024 * 1024;
const TEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MYSQL_STATUS_NAMES = [
  "Threads_connected", "Threads_running", "Innodb_row_lock_current_waits", "Innodb_row_lock_waits"
];

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function csv(marker) {
  const rows = [`\uFEFF${CUSTOMER_IMPORT_COLUMN_NAMES.join(",")}`];
  for (let index = 0; index < ROW_COUNT; index += 1) {
    const sequence = String(index).padStart(5, "0");
    rows.push(CUSTOMER_IMPORT_COLUMN_NAMES.map((name) => ({
      customerCode: `TC064-${marker}-${sequence}`,
      legalName: `TC064 Customer ${marker} ${sequence}`,
      defaultCurrencyCode: "HKD"
    })[name] ?? "").join(","));
  }
  return Buffer.from(`${rows.join("\r\n")}\r\n`);
}

function databaseFor(connection) {
  return {
    query: (...args) => connection.query(...args),
    execute: (...args) => connection.execute(...args),
    async withTransaction(work) {
      await connection.beginTransaction();
      try {
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  };
}

async function mysqlStatus(connection) {
  const [rows] = await connection.query(
    "SHOW GLOBAL STATUS WHERE Variable_name IN (?)",
    [MYSQL_STATUS_NAMES]
  );
  return Object.fromEntries(rows.map((row) => [row.Variable_name, Number(row.Value)]));
}

performanceTest("TC-064 imports 10,000 Customer rows within the release budget", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const connectionOptions = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "erp_dev"
  };
  const connection = await mysql.createConnection(connectionOptions);
  const samplerConnection = await mysql.createConnection(connectionOptions);
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "customer-import-performance-"));
  const marker = randomUUID().slice(0, 8);
  const codeKeyPrefix = `tc064-${marker}-%`;
  const nowMs = Date.now();
  const [createdUser] = await connection.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`customer-import-perf-${marker}`, "unused", "Customer Import Performance", nowMs, nowMs]
  );
  const actorId = Number(createdUser.insertId);
  const roleName = `customer-import-perf-role-${marker}`;
  const [createdRole] = await connection.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, nowMs]);
  const roleId = Number(createdRole.insertId);
  for (const permissionName of ["customer.view", "customer.mgmt"]) {
    const [[permission]] = await connection.query("SELECT id FROM permissions WHERE name = ?", [permissionName]);
    await connection.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }
  await connection.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [actorId, roleId]);
  let jobId = null;
  let application = null;
  t.after(async () => {
    await application?.shutdown("customer_import_performance_complete");
    await connection.execute("DELETE FROM customer_audit_logs WHERE actor_user_id = ?", [actorId]);
    await connection.execute("DELETE FROM customers WHERE customer_code_key LIKE ?", [codeKeyPrefix]);
    if (jobId) await connection.execute("DELETE FROM customer_import_jobs WHERE id = ?", [jobId]);
    await connection.execute("DELETE FROM customer_operation_requests WHERE actor_user_id = ?", [actorId]);
    await connection.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(actorId)]);
    await connection.execute("DELETE FROM user_roles WHERE user_id = ?", [actorId]);
    await connection.execute("DELETE FROM users WHERE id = ?", [actorId]);
    await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    await connection.execute("DELETE FROM roles WHERE id = ?", [roleId]);
    await samplerConnection.end();
    await connection.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const database = databaseFor(connection);
  const storage = new CustomerImportStorage({ config: { root: storageRoot, maxFileBytes: 20 * 1024 * 1024 } });
  const audit = new CustomerAuditLogService();
  const imports = new CustomerImportService({
    database, time: { nowMs: () => Date.now() }, storage, audit,
    authorize: async () => ({ username: `customer-import-perf-${marker}` }),
    loadPermissions: async () => ["customer.view", "customer.mgmt"]
  });
  const customers = new CustomerService({ database, time: { nowMs: () => Date.now() }, audit });
  const content = csv(marker);
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  let peakHeapBytes = baselineHeapBytes;
  const sampleHeap = () => { peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed); };
  const heapSampler = setInterval(sampleHeap, 5);
  heapSampler.unref();
  t.after(() => { clearInterval(heapSampler); });

  const uploaded = await imports.createFromUpload({
    actorId, claimedRoles: [], claimedPermissions: [], idempotencyKey: randomUUID(),
    templateVersion: "v1", mode: "create_only",
    fileSha256: createHash("sha256").update(content).digest("hex"), content,
    requestId: "tc-064", ip: "127.0.0.1"
  });
  jobId = uploaded.id;
  const precheckOwner = `tc064-precheck-${marker}`;
  await connection.execute(
    `UPDATE customer_import_jobs SET status = 'validating', lease_owner = ?, lease_until = ?, version = version + 1
      WHERE id = ? AND status = 'uploaded'`,
    [precheckOwner, Date.now() + IMPORT_BUDGET_MS, jobId]
  );
  const precheckStarted = performance.now();
  await imports.preparePrecheck({ jobId, leaseOwner: precheckOwner });
  const [[sourceMetadata]] = await connection.query(
    "SELECT source_stored_name, source_sha256 FROM customer_import_jobs WHERE id = ?",
    [jobId]
  );
  const precheckResult = await parseAndPrecheckCustomerCsv({
    source: await imports.readSource({
      sourceStoredName: sourceMetadata.source_stored_name,
      sourceSha256: Buffer.from(sourceMetadata.source_sha256)
    }),
    mode: "create_only", connection: database, maxRows: ROW_COUNT,
    maxBytes: 20 * 1024 * 1024, batchSize: 500,
    onRows: (rows) => {
      sampleHeap();
      return imports.appendPrecheckRows({
        jobId, leaseOwner: precheckOwner, leaseDurationMs: IMPORT_BUDGET_MS, rows
      });
    }
  });
  const ready = await imports.recordPrecheck({ jobId, leaseOwner: precheckOwner, ...precheckResult });
  const precheckMs = performance.now() - precheckStarted;
  sampleHeap();
  assert.deepEqual(
    [ready.status, ready.totalCount, ready.validCount, ready.invalidCount],
    ["ready", ROW_COUNT, ROW_COUNT, 0]
  );

  const confirmed = await imports.confirm({
    actorId, claimedRoles: [], claimedPermissions: [], id: jobId, version: ready.version,
    activationMode: "draft", approverUserId: null, idempotencyKey: randomUUID(),
    requestId: "tc-064", ip: "127.0.0.1"
  });
  const executionOwner = `tc064-execute-${marker}`;
  const [claimed] = await connection.execute(
    `UPDATE customer_import_jobs SET status = 'running', lease_owner = ?, lease_until = ?, version = version + 1
      WHERE id = ? AND status = 'queued' AND version = ?`,
    [executionOwner, Date.now() + 11 * 60 * 1_000, jobId, confirmed.version]
  );
  assert.equal(claimed.affectedRows, 1);

  const source = defaultConfigurationSource();
  application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
  const jwt = application.services.require("jwt");
  const tokenVersion = await application.services.require("tokenRevocation").currentVersion(String(actorId));
  const token = await jwt.issue(
    { roles: [roleName], permissions: ["customer.view", "customer.mgmt"] },
    { subject: String(actorId), version: tokenVersion, authTime: Math.floor(nowMs / 1_000) }
  );
  const { url } = await application.start();
  const mysqlBefore = await mysqlStatus(samplerConnection);
  const apiLatenciesMs = [];
  let apiErrors = 0;
  let maxThreadsConnected = mysqlBefore.Threads_connected;
  let maxThreadsRunning = mysqlBefore.Threads_running;
  let maxRowLockCurrentWaits = mysqlBefore.Innodb_row_lock_current_waits;
  const executionRowLatenciesMs = [];
  const samplingController = new AbortController();
  const sampler = (async () => {
    let sampleCount = 0;
    while (!samplingController.signal.aborted) {
      const started = performance.now();
      try {
        const response = await fetch(
          `${url}/api/v1/customers?q=${encodeURIComponent(`TC064-${marker}`)}&sortBy=code&sortDirection=asc&page=1&pageSize=20`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        await response.arrayBuffer();
        if (response.status !== 200) apiErrors += 1;
      } catch {
        apiErrors += 1;
      }
      apiLatenciesMs.push(performance.now() - started);
      sampleCount += 1;
      if (sampleCount % 10 === 0) {
        const status = await mysqlStatus(samplerConnection);
        maxThreadsConnected = Math.max(maxThreadsConnected, status.Threads_connected);
        maxThreadsRunning = Math.max(maxThreadsRunning, status.Threads_running);
        maxRowLockCurrentWaits = Math.max(maxRowLockCurrentWaits, status.Innodb_row_lock_current_waits);
      }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  })();

  const executionStarted = performance.now();
  let applied = 0;
  while (true) {
    const rowStarted = performance.now();
    const row = await imports.processNextRow({
      jobId, leaseOwner: executionOwner, leaseDurationMs: 11 * 60 * 1_000,
      applyRow: (executor, context) => customers.applyImportRowInTransaction(executor, context)
    });
    if (!row) break;
    executionRowLatenciesMs.push(performance.now() - rowStarted);
    assert.equal(row.status, "applied");
    applied += 1;
    sampleHeap();
  }
  const completed = await imports.finalizeExecution({ jobId, leaseOwner: executionOwner });
  const executionMs = performance.now() - executionStarted;
  samplingController.abort();
  await sampler;
  sampleHeap();
  clearInterval(heapSampler);

  const mysqlAfter = await mysqlStatus(samplerConnection);
  const totalMs = precheckMs + executionMs;
  const heapGrowthBytes = Math.max(0, peakHeapBytes - baselineHeapBytes);
  const api = {
    count: apiLatenciesMs.length,
    errors: apiErrors,
    p50: percentile(apiLatenciesMs, 0.5),
    p95: percentile(apiLatenciesMs, 0.95)
  };
  const mysqlLocksAndPool = {
    rowLockWaitsDelta: mysqlAfter.Innodb_row_lock_waits - mysqlBefore.Innodb_row_lock_waits,
    maxRowLockCurrentWaits,
    connectionGrowth: maxThreadsConnected - mysqlBefore.Threads_connected,
    maxThreadsConnected,
    maxThreadsRunning
  };
  const executionRows = {
    count: executionRowLatenciesMs.length,
    p50: percentile(executionRowLatenciesMs, 0.5),
    p95: percentile(executionRowLatenciesMs, 0.95)
  };
  const [[mysqlVersion]] = await connection.query("SELECT VERSION() AS version");

  assert.equal(applied, ROW_COUNT);
  assert.deepEqual(
    [completed.status, completed.successCount, completed.failedCount, completed.skippedCount],
    ["completed", ROW_COUNT, 0, 0]
  );
  assert.ok(totalMs < IMPORT_BUDGET_MS, `precheck+execution ${totalMs.toFixed(0)}ms exceeds 10 minutes`);
  assert.ok(api.count > 0, "core Customer API must be sampled during import execution");
  assert.equal(api.errors, 0, "core Customer API requests must not fail during import execution");
  assert.ok(api.p95 < LOOKUP_P95_BUDGET_MS, `core Customer API p95 ${api.p95.toFixed(1)}ms exceeds 2 seconds`);
  assert.equal(mysqlLocksAndPool.rowLockWaitsDelta, 0, "Customer import must not add an InnoDB row-lock wait");
  assert.equal(mysqlLocksAndPool.maxRowLockCurrentWaits, 0, "Customer import must not leave a row lock waiting");
  assert.ok(mysqlLocksAndPool.connectionGrowth <= source.database.connectionLimit,
    `Customer import used ${mysqlLocksAndPool.connectionGrowth} additional connections beyond the ${source.database.connectionLimit}-connection pool`);
  assert.ok(heapGrowthBytes < HEAP_GROWTH_BUDGET_BYTES, `heap growth ${heapGrowthBytes} exceeds 256 MiB`);

  console.log(JSON.stringify({
    tc: "TC-064", fixtureVersion: "customer-import-performance-v1", rows: ROW_COUNT,
    durationMs: { precheck: precheckMs, execution: executionMs, total: totalMs },
    throughputRowsPerSecond: ROW_COUNT / (executionMs / 1_000),
    latencyMs: { executionRows, coreCustomerApi: api },
    resources: { baselineHeapBytes, peakHeapBytes, heapGrowthBytes, mysql: mysqlLocksAndPool },
    environment: {
      node: process.version, mysql: mysqlVersion.version,
      logicalCpu: os.cpus().length, memoryBytes: os.totalmem()
    }
  }));
});
