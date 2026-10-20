import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

/**
 * TASK-051 step 2b：MIG-001／002／004／005，真 MySQL、真 migration runner、真 server process。
 *
 * 每個 case 用自己一個空白 database（admin 帳號開，用完即刪），唔郁 DB_NAME。CI 上 erp_user 只有 erp_dev
 * 嘅權限，所以 runner、server 同檢查都用 admin 帳號連 scratch database（同 supplierBankRestore 一樣）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const githubActions = process.env.GITHUB_ACTIONS === "true";
const ADMIN = { user: process.env.DB_ADMIN_USER ?? (githubActions ? "root" : undefined),
  password: process.env.DB_ADMIN_PASSWORD ?? (githubActions ? "root" : undefined) };
const SERVER = fileURLToPath(new URL("../../", import.meta.url));
const DATABASE_DIRECTORY = path.join(SERVER, "database");
const FRAMEWORK_SQL_FILES = ["framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"];
const SUPPLIER_PERMISSIONS = ["supplier.approval", "supplier.bank.mgmt", "supplier.bank.view", "supplier.mgmt", "supplier.settings", "supplier.view"];

async function allMigrations() {
  const names = (await readdir(path.join(DATABASE_DIRECTORY, "migrations"))).filter((name) => /\.(js|sql)$/u.test(name)).sort();
  return [...FRAMEWORK_SQL_FILES, ...names.map((name) => `migrations/${name}`)];
}
/** Supplier 擁有嘅 migration：檔名有 supplier（0028 係 Supplier 權限 seed）。 */
const isSupplierMigration = (name) => /supplier/u.test(name);

/** 一個空白 database，test 完即刪。回傳 admin 連線（multipleStatements，已 USE 咗佢）。 */
async function scratchDatabase(t) {
  const name = `${process.env.DB_NAME}_mig_${randomUUID().slice(0, 8)}`;
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...ADMIN,
    multipleStatements: true });
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.query(`USE \`${name}\``);
  t.after(async () => {
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``).catch(() => {});
    await connection.end().catch(() => {});
  });
  return { name, connection };
}

/** 同 scripts/migrate.js 一樣嘅次序同做法（SQL 檔成個送、JS 叫 up），但唔寫 ledger：俾 MIG-002 停喺任何一支之前。 */
async function apply(connection, name) {
  if (name.endsWith(".sql")) {
    await connection.query(await readFile(path.join(DATABASE_DIRECTORY, name), "utf8"));
    return;
  }
  const module = await import(pathToFileURL(path.join(DATABASE_DIRECTORY, name)).href);
  await module.up(connection);
}

const READ_ONLY = /^\s*(SELECT|SHOW|SET|DESCRIBE|EXPLAIN|WITH)\b/iu;
/**
 * 記低（同可以喺第 `failAt` 句寫入之前中斷）一個 migration 送出嘅寫入。DDL 喺 MySQL 會 implicit commit，
 * 所以「做咗頭 n 句就斷」就係真實嘅半套用狀態。
 */
function recording(connection, failAt = Infinity) {
  const writes = [];
  const wrap = (method) => async (sql, ...rest) => {
    const text = typeof sql === "string" ? sql : sql.sql;
    if (!READ_ONLY.test(text)) {
      if (writes.length + 1 === failAt) throw new Error(`injected fault before write ${failAt}`);
      writes.push(text.replace(/\s+/gu, " ").trim());
    }
    return connection[method](sql, ...rest);
  };
  const proxy = new Proxy(connection, {
    get(target, property) {
      if (property === "query" || property === "execute") return wrap(property);
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { connection: proxy, writes };
}

/** 成個 database 嘅 schema 同資料（時間欄除外：seed 用 Date.now()）。 */
async function snapshot(connection, database) {
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name", [database]);
  const result = {};
  for (const { name } of tables) {
    const [[created]] = await connection.query(`SHOW CREATE TABLE \`${database}\`.\`${name}\``);
    const [rows] = await connection.query(`SELECT * FROM \`${database}\`.\`${name}\``);
    const data = rows.map((row) => JSON.stringify(Object.entries(row).filter(([column]) => !/_at$/u.test(column))))
      .sort();
    result[name] = { schema: created["Create Table"].replace(/ AUTO_INCREMENT=\d+/u, ""), data };
  }
  const [triggers] = await connection.query(
    "SELECT trigger_name AS name, action_statement AS body FROM information_schema.triggers WHERE trigger_schema = ? ORDER BY trigger_name",
    [database]);
  result["#triggers"] = triggers;
  return result;
}

function runRunner(database) {
  return promisify(execFile)(process.execPath, [path.join(SERVER, "scripts/migrate.js")], { cwd: SERVER,
    env: { ...process.env, DB_USER: ADMIN.user, DB_PASSWORD: ADMIN.password, DB_NAME: database } });
}

const freePort = () => new Promise((resolve) => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

/** 真 server process（`node src/index.js`）。回傳佢係咪起到、stdout、stderr 同 exit code。 */
async function startServer(database, overrides = {}) {
  const port = await freePort();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-mig-"));
  const child = spawn(process.execPath, [path.join(SERVER, "src/index.js")], { cwd,
    env: { ...process.env, DB_USER: ADMIN.user, DB_PASSWORD: ADMIN.password, DB_NAME: database, APP_PORT: String(port), ...overrides } });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => { output.stdout += chunk; });
  child.stderr.on("data", (chunk) => { output.stderr += chunk; });
  const exited = new Promise((resolve) => { child.on("exit", (code) => resolve(code)); });
  const outcome = await Promise.race([
    exited.then((code) => ({ listening: false, code })),
    new Promise((resolve) => {
      const timer = setInterval(() => {
        if (output.stdout.includes("API listening on")) { clearInterval(timer); resolve({ listening: true }); }
      }, 50);
      exited.then(() => clearInterval(timer));
    }),
    new Promise((resolve) => { setTimeout(() => resolve({ listening: false, code: "still starting after 30 s" }), 30_000).unref(); })
  ]);
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    const code = await exited;
    fs.rmSync(cwd, { recursive: true, force: true });
    return code;
  };
  return { ...outcome, port, output, stop };
}

integrationTest("TC-001 (MIG-001): the runner deploys every migration on an empty database, Supplier creates no Currency or Payment Term schema of its own, and the server starts with both Supplier providers ready", async (t) => {
  const { name, connection } = await scratchDatabase(t);
  const { stdout } = await runRunner(name);
  assert.match(stdout, /Migrations complete\./u);
  const [ledger] = await connection.query("SELECT name FROM fr_schema_migrations ORDER BY name");
  assert.deepEqual(ledger.map((row) => row.name).sort(), (await allMigrations()).sort(), "every file applied once, in the ledger");

  const [tables] = await connection.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name", [name]);
  const supplierTables = tables.map((row) => row.name).filter((table) => table.startsWith("supplier"));
  assert.deepEqual(supplierTables, ["supplier_activation_requests", "supplier_address_purposes", "supplier_addresses", "supplier_audit_logs",
    "supplier_bank_accounts", "supplier_contact_purposes", "supplier_contacts", "supplier_identifiers", "supplier_import_jobs", "supplier_import_rows",
    "supplier_name_grams", "supplier_settings", "supplier_sku_refs", "supplier_supply_events", "suppliers"]);
  assert.equal(supplierTables.some((table) => /currenc|payment_term/u.test(table)), false, "no Supplier shadow of Business Master catalogues");
  // Supplier 只用 FK 指向 Business Master 嘅表。
  const [references] = await connection.query(
    `SELECT DISTINCT table_name AS child, referenced_table_name AS parent FROM information_schema.referential_constraints
      WHERE constraint_schema = ? AND table_name LIKE 'supplier%' AND referenced_table_name IN ('currencies', 'payment_terms') ORDER BY child, parent`, [name]);
  assert.deepEqual(references.map((row) => `${row.child}>${row.parent}`), ["supplier_bank_accounts>currencies", "suppliers>currencies", "suppliers>payment_terms"]);

  const server = await startServer(name);
  try {
    assert.equal(server.listening, true, `the server must start: ${server.code} ${server.output.stderr}`);
    const health = await fetch(`http://127.0.0.1:${server.port}/api/v1/health`);
    const body = await health.json();
    assert.deepEqual([health.status, body.data.status, body.data.database], [200, "ok", "connected"]);
  } finally {
    assert.equal(await server.stop(), 0, "a clean shutdown");
  }

  // 同一個 container，直接問兩個 provider（index.js 用同一組 module）。
  const { createApplication } = await import("../../src/framework/application/createApplication.js");
  const { defaultConfigurationSource } = await import("../../src/framework/configuration/applicationConfiguration.js");
  const source = defaultConfigurationSource();
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-mig-logs-"));
  const application = await createApplication({
    configurationSource: { ...source, database: { ...source.database, ...ADMIN, database: name },
      logging: { loggers: {
        request: { ...source.logging.loggers.request, directory: path.join(logRoot, "requests") },
        system: { ...source.logging.loggers.system, directory: path.join(logRoot, "system") } } } },
    serviceDiscoveryOptions: { additionalModuleUrls: [
      new URL("../../src/modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
      new URL("../../src/modules/supplier/SupplierProviderServices.js", import.meta.url).href] }
  });
  try {
    const { SupplierLookupService } = await import("../../src/modules/supplier/SupplierLookupService.js");
    const readiness = await application.services.require("supplierCoreProvider").inspectReadiness();
    assert.deepEqual([readiness.status, readiness.schemaReady, readiness.providerContract], ["READY", true, SupplierLookupService.contract]);
    const checker = application.services.require("supplierBusinessMasterImpactChecker");
    assert.equal(checker.id, "supplier");
    assert.equal(typeof checker.check, "function");
  } finally {
    await application.shutdown("test", 0);
    fs.rmSync(logRoot, { recursive: true, force: true });
  }
});

integrationTest("TC-002 (MIG-002): every Supplier migration stopped before any one of its writes converges on rerun to the same schema and data as a clean run, and a rerun of a finished one changes nothing", async (t) => {
  const migrations = await allMigrations();
  const supplier = migrations.filter(isSupplierMigration);
  assert.equal(supplier.length, 15, supplier.join(", "));
  let cases = 0;
  for (const target of supplier) {
    const before = migrations.slice(0, migrations.indexOf(target));
    // 參考：喺「之前嗰啲都做咗」嘅 database 上乾淨咁跑一次。
    const reference = await scratchDatabase(t);
    for (const name of before) await apply(reference.connection, name);
    const clean = recording(reference.connection);
    await apply(clean.connection, target);
    const expected = await snapshot(reference.connection, reference.name);
    assert.ok(clean.writes.length > 0, `${target} writes something`);

    const again = recording(reference.connection);
    await apply(again.connection, target);
    assert.deepEqual(await snapshot(reference.connection, reference.name), expected, `${target}: a rerun changes nothing`);
    await reference.connection.query(`DROP DATABASE \`${reference.name}\``);

    for (let failAt = 1; failAt <= clean.writes.length; failAt += 1) {
      const scratch = await scratchDatabase(t);
      for (const name of before) await apply(scratch.connection, name);
      const faulted = recording(scratch.connection, failAt);
      await assert.rejects(() => apply(faulted.connection, target), /injected fault/u, `${target} reaches write ${failAt}`);
      // 程序死咗：連線斷，未 commit 嘅 DML rollback。新連線再跑成支。
      await scratch.connection.end();
      const resumed = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), ...ADMIN,
        database: scratch.name, multipleStatements: true });
      try {
        await apply(resumed, target);
        assert.deepEqual(await snapshot(resumed, scratch.name), expected,
          `${target} stopped before write ${failAt} (${clean.writes[failAt - 1].slice(0, 80)}) converges`);
        await resumed.query(`DROP DATABASE \`${scratch.name}\``);
      } finally {
        await resumed.end();
      }
      cases += 1;
    }
  }
  t.diagnostic(`${supplier.length} migrations, ${cases} half-applied states`);
});

integrationTest("TC-004 (MIG-004): the six Supplier permissions and their system-admin grants exist once, approval starts OFF, Supplier seeds no Currency or Payment Term, and reruns keep it that way", async (t) => {
  const { name, connection } = await scratchDatabase(t);
  const migrations = await allMigrations();
  const supplierWrites = [];
  for (const migration of migrations) {
    if (!isSupplierMigration(migration)) {
      await apply(connection, migration);
      continue;
    }
    const recorder = recording(connection);
    await apply(recorder.connection, migration);
    supplierWrites.push(...recorder.writes);
  }
  const counts = async () => {
    const [permissions] = await connection.query(
      `SELECT p.name AS name, COUNT(DISTINCT p.id) AS permissions, COUNT(rp.permission_id) AS adminGrants
         FROM permissions p
         LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = (SELECT id FROM roles WHERE name = 'system-admin')
        WHERE p.name LIKE 'supplier.%' GROUP BY p.name ORDER BY p.name`);
    const [settings] = await connection.query("SELECT id, require_activation_approval AS approval FROM supplier_settings");
    return { permissions: permissions.map((row) => [row.name, Number(row.permissions), Number(row.adminGrants)]),
      settings: settings.map((row) => [Number(row.id), Number(row.approval)]) };
  };
  const expected = { permissions: SUPPLIER_PERMISSIONS.map((permission) => [permission, 1, 1]), settings: [[1, 0]] };
  assert.deepEqual(await counts(), expected, "six permissions, each granted to system-admin once, no unknown extra; settings id=1 with approval OFF");
  // 日常 role 唔會自動攞到 Supplier 權限。
  const [others] = await connection.query(
    `SELECT r.name AS name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name LIKE 'supplier.%' AND r.name <> 'system-admin'`);
  assert.deepEqual(others, []);

  // Supplier 冇寫過 Business Master 嘅表，亦冇自己建 Currency／Payment Term 表。
  const touchesCatalogue = (sql) => /^(INSERT|UPDATE|DELETE|REPLACE)\b[^(]*?\b(currencies|payment_terms)\b/iu.test(sql)
    || /^CREATE TABLE (IF NOT EXISTS )?`?\w*(currenc|payment_term)/iu.test(sql);
  assert.ok(supplierWrites.length > 0, "control: the Supplier migrations were recorded");
  assert.ok(touchesCatalogue("INSERT INTO currencies (code) VALUES ('X')"), "control: the pattern matches a catalogue write");
  assert.deepEqual(supplierWrites.filter(touchesCatalogue), []);

  // 重跑兩支 seed migration：唔重複、唔重設。
  await connection.query("UPDATE supplier_settings SET require_activation_approval = 1 WHERE id = 1");
  for (const seed of ["migrations/0028_seed_supplier_management_permissions.js", "migrations/0036_create_supplier_settings.js"]) {
    await apply(connection, seed);
  }
  assert.deepEqual(await counts(), { ...expected, settings: [[1, 1]] }, "a rerun neither duplicates nor resets an operator's choice");
  assert.equal(name.startsWith(process.env.DB_NAME), true);
});

const KEY = "R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg=";
const LOOKUP = "THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw=";
const SHORT = Buffer.alloc(16, 7).toString("base64");

integrationTest("TC-005 (MIG-005): each bad Supplier security or limit setting stops the server before it serves anything, and the error names the setting without its value", async (t) => {
  const { name } = await scratchDatabase(t);
  await runRunner(name);
  // Customer 同 Supplier 嘅 Bank 要用同一組 key ring（設定驗證），所以兩邊一齊設。
  const ring = { ACTIVE_KEY_ID: "enc-1", ENCRYPTION_KEYS: JSON.stringify({ "enc-1": KEY }),
    LOOKUP_ACTIVE_KEY_ID: "look-1", LOOKUP_KEYS: JSON.stringify({ "look-1": LOOKUP }) };
  const bank = Object.fromEntries(["SUPPLIER", "CUSTOMER"].flatMap((owner) =>
    Object.entries(ring).map(([key, value]) => [`${owner}_BANK_${key}`, value])));
  const cases = [
    ["missing lookup keys", { ...bank, SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID: "", SUPPLIER_BANK_LOOKUP_KEYS: "" }, /both bankEncryption and bankLookup/u],
    ["ring without active key ID", { ...bank, SUPPLIER_BANK_ACTIVE_KEY_ID: "" }, /bankEncryption\.activeKeyId" is required/u],
    ["bad base64", { ...bank, SUPPLIER_BANK_ENCRYPTION_KEYS: JSON.stringify({ "enc-1": `${KEY.slice(0, 20)}!!${KEY.slice(22)}` }) },
      /bankEncryption\.keyRing\.enc-1" must decode to exactly 32 bytes/u],
    ["16-byte key", { ...bank, SUPPLIER_BANK_LOOKUP_KEYS: JSON.stringify({ "look-1": SHORT }) }, /bankLookup\.keyRing\.look-1" must decode to exactly 32 bytes/u],
    ["active ID not in ring", { ...bank, SUPPLIER_BANK_ACTIVE_KEY_ID: "enc-2" }, /bankEncryption\.activeKeyId" must exist in its keyRing/u],
    ["ring not JSON", { ...bank, SUPPLIER_BANK_LOOKUP_KEYS: `look-1=${LOOKUP}` }, /bankLookup\.keyRing" must be a valid JSON object/u],
    ["threshold below range", { ...bank, SUPPLIER_DUPLICATE_NAME_THRESHOLD: "0.3" }, /duplicateNameThreshold" must be between 0\.5 and 1/u],
    ["import rows above limit", { ...bank, SUPPLIER_IMPORT_MAX_ROWS: "50001" }, /import\.maxRows" must be a positive integer/u],
    ["import bytes not a number", { ...bank, SUPPLIER_IMPORT_MAX_FILE_BYTES: "ten" }, /import\.maxFileBytes" must be a positive integer/u],
    ["import root relative", { ...bank, SUPPLIER_IMPORT_ROOT: "imports" }, /import\.root" must be an absolute path/u]
  ];
  // 對照：同一組正確設定起得到。
  const control = await startServer(name, bank);
  try {
    assert.equal(control.listening, true, `control: the good settings start: ${control.output.stderr}`);
  } finally {
    await control.stop();
  }
  for (const [label, env, message] of cases) {
    const server = await startServer(name, env);
    // stderr 係一行 JSON：message 入面嘅 `"` 變咗 `\"`。
    const output = `${server.output.stdout}\n${server.output.stderr}`.replaceAll('\\"', '"');
    try {
      assert.equal(server.listening, false, `${label}: must not start`);
      assert.equal(server.code, 1, `${label}: exit code`);
      assert.match(output, message, label);
      // 唔洩漏值：key material 同錯誤嘅原始輸入都唔可以出現。
      for (const secret of [KEY, LOOKUP, SHORT, KEY.slice(0, 20), LOOKUP.slice(0, 20)]) {
        assert.equal(output.includes(secret), false, `${label}: leaks key material`);
      }
      // 起唔到即係冇 port 喺度聽。
      await assert.rejects(fetch(`http://127.0.0.1:${server.port}/api/v1/health`, { signal: AbortSignal.timeout(2000) }));
    } finally {
      await server.stop();
    }
  }
});
