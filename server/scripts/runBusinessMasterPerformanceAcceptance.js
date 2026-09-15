import { createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";

import idempotencyConfig from "../config/idempotency.js";
import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";

function outputPath() {
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--output is required");
  return process.argv[index + 1];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

const reportPath = outputPath();
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 25
});

const createdStoreKeys = [];
let application;
let roleId;
let userId;
let report;

try {
  await pool.query("DELETE FROM payment_terms WHERE code_key LIKE 'PERF-BM-%'");
  const nowMs = Date.now();
  for (let start = 0; start < 10_000; start += 500) {
    const rows = [];
    const placeholders = [];
    for (let offset = 0; offset < 500; offset += 1) {
      const index = start + offset;
      const sequence = String(index).padStart(5, "0");
      placeholders.push("(?, ?, ?, '', 'NET_DAYS', 30, ?, 1, ?, NULL, ?, NULL)");
      rows.push(`PERF-BM-${sequence}`, `PERF-BM-${sequence}`, `Performance ${sequence}`, index % 2 === 0 ? "ACTIVE" : "INACTIVE", nowMs, nowMs);
    }
    await pool.query(
      `INSERT INTO payment_terms
         (code, code_key, name, description, calculation_type, due_days, status, version,
          created_at, created_by, updated_at, updated_by)
       VALUES ${placeholders.join(",")}`,
      rows
    );
  }

  const suffix = randomUUID().slice(0, 8);
  const [roleResult] = await pool.execute("INSERT INTO roles (name, description, created_at) VALUES (?, '', ?)", [`perf-bm-${suffix}`, nowMs]);
  roleId = Number(roleResult.insertId);
  const [[viewPermission]] = await pool.query("SELECT id FROM permissions WHERE name = 'business_master.view'");
  await pool.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, viewPermission.id]);
  const [userResult] = await pool.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'Business Master Performance', ?, ?)",
    [`perf-bm-${suffix}`, await hashPassword("Business-Master-Performance-1!"), nowMs, nowMs]
  );
  userId = Number(userResult.insertId);
  await pool.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);

  const source = defaultConfigurationSource();
  application = await createApplication({
    configurationSource: {
      ...source,
      application: { ...source.application, port: 0 },
      jwt: { ...source.jwt, secret: randomBytes(32).toString("hex") },
      requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 1_000 }
    },
    serviceDiscoveryOptions: {
      additionalModuleUrls: [new URL("../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href]
    }
  });
  const { url } = await application.start();
  const jwt = application.services.require("jwt");
  const version = await application.services.require("tokenRevocation").currentVersion(String(userId));
  const token = await jwt.issue(
    { roles: [`perf-bm-${suffix}`], permissions: ["business_master.view"] },
    { subject: String(userId), version, authTime: Math.floor(nowMs / 1000) }
  );
  const headers = { Authorization: `Bearer ${token}` };
  const [idRows] = await pool.query("SELECT id FROM payment_terms WHERE code_key LIKE 'PERF-BM-%' AND status = 'ACTIVE' ORDER BY id LIMIT 100");

  async function timedRequest(index, record = true) {
    const started = performance.now();
    let response;
    if (index % 3 === 0) {
      response = await fetch(`${url}/api/v1/business-master/payment-terms?q=PERF-BM&status=ACTIVE&pageSize=100&page=${(index % 50) + 1}`, { headers });
    } else if (index % 3 === 1) {
      response = await fetch(`${url}/api/v1/business-master/payment-terms/${idRows[index % idRows.length].id}`, { headers });
    } else {
      const id = idRows[index % idRows.length].id;
      const key = randomUUID();
      createdStoreKeys.push(`${idempotencyConfig.storeKeyPrefix}:${digest(`jwt:${userId}:POST:/api/v1/business-master/payment-terms/:id/calculate:${key}`)}`);
      response = await fetch(`${url}/api/v1/business-master/payment-terms/${id}/calculate`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", [idempotencyConfig.headerName]: key },
        body: JSON.stringify({ baseDate: "2026-01-31", expectedVersion: 1 })
      });
    }
    await response.arrayBuffer();
    if (response.status !== 200) throw new Error(`unexpected HTTP ${response.status}`);
    return record ? performance.now() - started : 0;
  }

  for (let index = 0; index < 15; index += 1) await timedRequest(index, false);
  const settled = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => timedRequest(index)));
  const durations = settled.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
  const errors = settled.length - durations.length;
  const failureCounts = Object.groupBy(
    settled.filter(({ status }) => status === "rejected").map(({ reason }) => String(reason?.message ?? reason)),
    (message) => message
  );
  const [[distribution]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(status='ACTIVE') AS active, SUM(status='INACTIVE') AS inactive FROM payment_terms WHERE code_key LIKE 'PERF-BM-%'"
  );
  const [queryPlan] = await pool.query(
    `EXPLAIN SELECT id, code, name, calculation_type, due_days, status, version
       FROM payment_terms
      WHERE status = 'ACTIVE' AND (code_key LIKE 'PERF-BM%' ESCAPE '!' OR name LIKE 'PERF-BM%' ESCAPE '!')
      ORDER BY code_key, id LIMIT 100`
  );
  const [[mysqlVersion]] = await pool.query("SELECT VERSION() AS version");
  const metrics = {
    environment: { node: process.version, mysql: mysqlVersion.version, logicalCpu: os.cpus().length, memoryBytes: os.totalmem() },
    data: { total: Number(distribution.total), active: Number(distribution.active), inactive: Number(distribution.inactive) },
    load: { warmupRequests: 15, concurrency: 100, arrival: "simultaneous burst", mix: { list: 34, lookup: 33, calculate: 33 } },
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99) },
    errorRate: errors / 100,
    failures: Object.fromEntries(Object.entries(failureCounts).map(([message, values]) => [message, values.length])),
    queryPlan
  };
  const passed = metrics.data.total === 10_000 && metrics.data.active === 5_000 && metrics.data.inactive === 5_000 && durations.length === 100 && metrics.latencyMs.p95 < 2_000 && metrics.latencyMs.p99 < 4_000 && metrics.errorRate < 0.01;
  console.log(JSON.stringify(metrics));
  report = { tests: [{ name: "10k balanced rows / 100 concurrent mixed HTTP operations", id: "TC-018", status: passed ? "PASS" : "FAIL" }] };
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error);
  report = { tests: [{ name: "10k balanced rows / 100 concurrent mixed HTTP operations", id: "TC-018", status: "FAIL" }] };
  process.exitCode = 1;
} finally {
  await application?.shutdown("business_master_performance_complete").catch(() => {});
  if (createdStoreKeys.length > 0) {
    await pool.query(`DELETE FROM fr_idempotency_keys WHERE store_key IN (${createdStoreKeys.map(() => "?").join(",")})`, createdStoreKeys).catch(() => {});
  }
  if (userId) {
    await pool.query("DELETE FROM user_roles WHERE user_id = ?", [userId]).catch(() => {});
    await pool.query("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
    await pool.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]).catch(() => {});
  }
  if (roleId) {
    await pool.query("DELETE FROM role_permissions WHERE role_id = ?", [roleId]).catch(() => {});
    await pool.query("DELETE FROM roles WHERE id = ?", [roleId]).catch(() => {});
  }
  await pool.query("DELETE FROM payment_terms WHERE code_key LIKE 'PERF-BM-%'").catch(() => {});
  await pool.end();
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}
