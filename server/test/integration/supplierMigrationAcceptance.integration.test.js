import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

import { ADMIN, ADMIN_CONFIG, childDatabaseEnv, runRunner, scratchDatabase, SERVER } from "./supplierScratchDatabase.js";

/**
 * TASK-051 step 2b：MIG-001／002／004／005，真 MySQL、真 migration runner、真 server process。
 *
 * 每個 case 用自己一個 scratch database（supplierScratchDatabase.js）。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const DATABASE_DIRECTORY = path.join(SERVER, "database");
const FRAMEWORK_SQL_FILES = ["framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"];
const SUPPLIER_PERMISSIONS = ["supplier.approval", "supplier.bank.mgmt", "supplier.bank.view", "supplier.mgmt", "supplier.settings", "supplier.view"];

async function allMigrations() {
  const names = (await readdir(path.join(DATABASE_DIRECTORY, "migrations"))).filter((name) => /\.(js|sql)$/u.test(name)).sort();
  return [...FRAMEWORK_SQL_FILES, ...names.map((name) => `migrations/${name}`)];
}
/** Supplier 擁有嘅 migration：檔名有 supplier（0028 係 Supplier 權限 seed）。 */
const isSupplierMigration = (name) => /supplier/u.test(name);

/** 同 scripts/migrate.js 一樣嘅次序同做法（SQL 檔成個送、JS 叫 up），但唔寫 ledger：俾 MIG-002 停喺任何一支之前。 */
async function apply(connection, name) {
  if (name.endsWith(".sql")) {
    await connection.query(await readFile(path.join(DATABASE_DIRECTORY, name), "utf8"));
    return;
  }
  const module = await import(pathToFileURL(path.join(DATABASE_DIRECTORY, name)).href);
  await module.up(connection);
}

// `WITH` 唔算讀：`WITH … UPDATE` 係寫入（REV-105 M-1）。
const READ_ONLY = /^\s*(SELECT|SHOW|SET|DESCRIBE|EXPLAIN)\b/iu;
/**
 * 記低（同可以喺第 `failAt` 句寫入之前中斷）一個 migration 送出嘅寫入。DDL 喺 MySQL 會 implicit commit，
 * 所以「做咗頭 n 句就斷」就係真實嘅半套用狀態。
 */
function recording(connection, failAt = Infinity) {
  const writes = [];
  const affected = [];
  const wrap = (method) => async (sql, ...rest) => {
    const text = typeof sql === "string" ? sql : sql.sql;
    // scratch 連線開咗 multipleStatements：第二句會避過分類同表名檢查，所以一律拒絕（REV-105 M-1）。
    if (/;\s*\S/u.test(text.replace(/'(?:[^'\\]|\\.)*'/gu, "''"))) throw new Error(`a migration sent more than one statement: ${text.slice(0, 120)}`);
    if (READ_ONLY.test(text)) return connection[method](sql, ...rest);
    if (writes.length + 1 === failAt) throw new Error(`injected fault before write ${failAt}`);
    writes.push(text.replace(/\s+/gu, " ").trim());
    const result = await connection[method](sql, ...rest);
    affected.push(Number(result?.[0]?.affectedRows ?? 0));
    return result;
  };
  const proxy = new Proxy(connection, {
    get(target, property) {
      if (property === "query" || property === "execute") return wrap(property);
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { connection: proxy, writes, affected };
}

/** 重跑一支做完嘅 migration：唔可以有 DDL，DML 一行都唔可以改。 */
function assertNoOp(recorder, label) {
  const ddl = recorder.writes.filter((sql) => !/^(INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(sql));
  assert.deepEqual(ddl, [], `${label}: no DDL on a rerun`);
  assert.deepEqual(recorder.affected.filter((rows) => rows !== 0), [], `${label}: no row changed on a rerun (${recorder.writes.join(" | ")})`);
}

/**
 * 成個 database 嘅 schema 同資料。預設唔計 `*_at`：TC-002 比較兩次獨立運行，seed 用 Date.now()。
 * TC-006 比較同一批原有資料，就要連時間欄一齊比（`keepTimes`，REV-105 M-1）。
 */
async function snapshot(connection, database, { keepTimes = false } = {}) {
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name", [database]);
  const result = {};
  for (const { name } of tables) {
    const [[created]] = await connection.query(`SHOW CREATE TABLE \`${database}\`.\`${name}\``);
    const [rows] = await connection.query(`SELECT * FROM \`${database}\`.\`${name}\``);
    const data = rows.map((row) => JSON.stringify(Object.entries(row).filter(([column]) => keepTimes || !/_at$/u.test(column))))
      .sort();
    result[name] = { schema: created["Create Table"].replace(/ AUTO_INCREMENT=\d+/u, ""), data };
  }
  const [triggers] = await connection.query(
    `SELECT trigger_name AS name, event_object_table AS tableName, action_timing AS timing, event_manipulation AS event,
            action_statement AS body FROM information_schema.triggers WHERE trigger_schema = ? ORDER BY trigger_name`,
    [database]);
  result["#triggers"] = triggers;
  return result;
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
    env: { ...process.env, ...childDatabaseEnv(database), APP_HOST: "127.0.0.1", APP_PORT: String(port), ...overrides } });
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

// 測試專用嘅假 key（同 CI 嗰兩條一樣，公開、唔係 secret）。Customer 同 Supplier 嘅 Bank 要用同一組 key ring
// （設定驗證），所以兩邊一齊設。
const KEY = "R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg=";
const LOOKUP = "THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw=";
const SHORT = Buffer.alloc(16, 7).toString("base64");
const bankEnv = (values = { ACTIVE_KEY_ID: "enc-1", ENCRYPTION_KEYS: JSON.stringify({ "enc-1": KEY }),
  LOOKUP_ACTIVE_KEY_ID: "look-1", LOOKUP_KEYS: JSON.stringify({ "look-1": LOOKUP }) }) =>
  Object.fromEntries(["SUPPLIER", "CUSTOMER"].flatMap((owner) => Object.entries(values).map(([key, value]) => [`${owner}_BANK_${key}`, value])));

integrationTest("TC-001 (MIG-001): the runner deploys every migration on an empty database and skips them all on a second run, Supplier creates no Currency or Payment Term schema of its own, and the server starts with both Supplier providers ready", async (t) => {
  const { name, connection } = await scratchDatabase(t);
  const { stdout } = await runRunner(name);
  assert.match(stdout, /Migrations complete\./u);
  const all = (await allMigrations()).sort();
  const [ledger] = await connection.query("SELECT name, applied_at FROM fr_schema_migrations ORDER BY name");
  assert.deepEqual(ledger.map((row) => row.name).sort(), all, "every file applied once, in the ledger");
  // 第二次跑 runner：每個檔都 skip，ledger 唔變（MIG-002「重跑全部」）。
  const second = await runRunner(name);
  const lines = second.stdout.trim().split("\n").filter((line) => line !== "Migrations complete.");
  assert.deepEqual(lines, (await allMigrations()).map((file) => `skip   ${file} (already applied)`));
  const [ledgerAgain] = await connection.query("SELECT name, applied_at FROM fr_schema_migrations ORDER BY name");
  assert.deepEqual(ledgerAgain, ledger);

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

  // 真 server，用假 Bank key（MIG-001 前提）。SupplierCoreProvider 係 eager：readiness 唔係 READY 就開唔到機。
  const server = await startServer(name, bankEnv());
  let stopped;
  try {
    assert.equal(server.listening, true, `the server must start: ${server.code} ${server.output.stderr}`);
    const health = await fetch(`http://127.0.0.1:${server.port}/api/v1/health`);
    const body = await health.json();
    assert.deepEqual([health.status, body.data.status, body.data.database], [200, "ok", "connected"]);
  } finally {
    stopped = await server.stop();
  }
  assert.equal(stopped, 0, "a clean shutdown");

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
    // Impact checker 要真係查到已部署嘅 suppliers 表（REV-102 M-2）。
    const checker = application.services.require("supplierBusinessMasterImpactChecker");
    assert.equal(checker.id, "supplier");
    for (const subject of [{ entityType: "CURRENCY", entityKey: "HKD" }, { entityType: "PAYMENT_TERM", entityKey: "1" }]) {
      const impact = await checker.check(subject);
      assert.deepEqual([impact.status, impact.activeDefaultCount, impact.openUseCount, impact.historicalCount], ["READY", 0, 0, 0],
        JSON.stringify(impact));
      assert.match(impact.watermark, new RegExp(`^${subject.entityType}:${subject.entityKey}:0:0:0:0:`, "u"));
    }
  } finally {
    await application.shutdown("test", 0);
    fs.rmSync(logRoot, { recursive: true, force: true });
  }
});

integrationTest("TC-002 (MIG-002): every Supplier migration stopped before any one of its writes converges on rerun to the same schema and data as a clean run, a rerun of a finished one changes no row and runs no DDL, and rerunning all of them over business data changes nothing", async (t) => {
  const migrations = await allMigrations();
  const supplier = migrations.filter(isSupplierMigration);
  assert.equal(supplier.length, 15, supplier.join(", "));
  let cases = 0;
  let partial = 0;
  for (const target of supplier) {
    const before = migrations.slice(0, migrations.indexOf(target));
    // 參考：喺「之前嗰啲都做咗」嘅 database 上乾淨咁跑一次。
    const reference = await scratchDatabase(t);
    for (const name of before) await apply(reference.connection, name);
    const clean = recording(reference.connection);
    await apply(clean.connection, target);
    const expected = await snapshot(reference.connection, reference.name);
    assert.ok(clean.writes.length > 0, `${target} writes something`);

    // 全部寫完但 runner 未記 ledger 就死：重跑唔寫任何嘢。
    const again = recording(reference.connection);
    await apply(again.connection, target);
    assertNoOp(again, target);
    assert.deepEqual(await snapshot(reference.connection, reference.name), expected, `${target}: a rerun changes nothing`);
    await reference.connection.query(`DROP DATABASE \`${reference.name}\``);

    for (let failAt = 1; failAt <= clean.writes.length; failAt += 1) {
      const scratch = await scratchDatabase(t);
      for (const name of before) await apply(scratch.connection, name);
      const faulted = recording(scratch.connection, failAt);
      await assert.rejects(() => apply(faulted.connection, target), /injected fault/u, `${target} reaches write ${failAt}`);
      // 程序死咗：連線斷。Supplier 嘅 DML 全部 autocommit，DDL 係 atomic，所以「做咗頭 n 句」就係斷咗之後嘅狀態。
      await scratch.connection.end();
      const resumed = await mysql.createConnection({ ...ADMIN_CONFIG(), database: scratch.name });
      try {
        await apply(resumed, target);
        assert.deepEqual(await snapshot(resumed, scratch.name), expected,
          `${target} stopped before write ${failAt} (${clean.writes[failAt - 1].slice(0, 80)}) converges`);
      } finally {
        await resumed.query(`DROP DATABASE IF EXISTS \`${scratch.name}\``).catch(() => {});
        await resumed.end();
      }
      cases += 1;
      if (failAt > 1) partial += 1;
    }
  }
  t.diagnostic(`${supplier.length} migrations, ${cases} stopped runs, ${partial} of them after at least one write`);

  // 成套 migration 做完、有業務資料之後，再跑晒 15 支 Supplier migration：schema 同資料都唔變（REV-102 M-4）。
  const full = await scratchDatabase(t);
  for (const name of migrations) await apply(full.connection, name);
  const now = Date.now();
  const [supplierRow] = await full.connection.query(
    `INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code,
       website, general_phone, general_email, notes, status, created_at, updated_at)
     VALUES ('MIG-1', 'mig-1', 'Migration Data', 'migration data', '', 'HKD', '', '', '', '', 'active', ?, ?)`, [now, now]);
  const supplierId = Number(supplierRow.insertId);
  const [addressRow] = await full.connection.query("INSERT INTO supplier_addresses (supplier_id, created_at, updated_at) VALUES (?, ?, ?)",
    [supplierId, now, now]);
  await full.connection.query(
    "INSERT INTO supplier_address_purposes (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at) VALUES (?, ?, 'billing', 1, ?, ?)",
    [addressRow.insertId, supplierId, now, now]);
  await full.connection.query(
    `INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
     VALUES (?, 'business_registration', 'HK', '12345678', '12345678', ?, ?)`, [supplierId, now, now]);
  await full.connection.query("UPDATE supplier_settings SET require_activation_approval = 1, version = version + 1 WHERE id = 1");
  const withData = await snapshot(full.connection, full.name);
  assert.equal(withData.suppliers.data.length, 1, "control: the business rows are in the snapshot");
  const rerun = recording(full.connection);
  for (const name of supplier) await apply(rerun.connection, name);
  assertNoOp(rerun, "rerunning every Supplier migration on a finished database");
  assert.deepEqual(await snapshot(full.connection, full.name), withData, "no data lost or reset");
});

integrationTest("TC-004 (MIG-004): the six Supplier permissions and their system-admin grants exist once, approval starts OFF, Supplier seeds no Currency or Payment Term, and reruns keep it that way", async (t) => {
  const { connection } = await scratchDatabase(t);
  const migrations = await allMigrations();
  const supplierWrites = [];
  for (const migration of migrations) {
    if (!isSupplierMigration(migration)) {
      await apply(connection, migration);
      continue;
    }
    if (migration === migrations.find(isSupplierMigration)) {
      // 前提：Business Master 已經提供 Active Currency（佢自己嘅 seed，唔係 Supplier 嘅）。
      const [currencies] = await connection.query("SELECT code FROM currencies WHERE status = 'ACTIVE'");
      assert.ok(currencies.some((row) => row.code === "HKD"), "Business Master provides an active currency before any Supplier migration");
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
});

integrationTest("TC-005 (MIG-005): each bad Supplier security or limit setting stops the server before it ever listens, including no Bank keys at all once the Bank table is deployed, and the error names the setting without its value", async (t) => {
  const { name } = await scratchDatabase(t);
  await runRunner(name);
  const bank = bankEnv();
  // 原始值揀啲唔會喺時間戳或者其他字入面出現嘅字串，咁先驗得到「冇洩漏」。
  const cases = [
    ["missing lookup keys", { ...bank, SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID: "", SUPPLIER_BANK_LOOKUP_KEYS: "" }, /Supplier config must provide both bankEncryption and bankLookup/u],
    ["ring without active key ID", { ...bank, SUPPLIER_BANK_ACTIVE_KEY_ID: "" }, /Supplier config "bankEncryption\.activeKeyId" is required/u],
    ["bad base64", { ...bank, SUPPLIER_BANK_ENCRYPTION_KEYS: JSON.stringify({ "enc-1": `${KEY.slice(0, 20)}!!${KEY.slice(22)}` }) },
      /Supplier config "bankEncryption\.keyRing\.enc-1" must decode to exactly 32 bytes/u],
    ["16-byte key", { ...bank, SUPPLIER_BANK_LOOKUP_KEYS: JSON.stringify({ "look-1": SHORT }) }, /Supplier config "bankLookup\.keyRing\.look-1" must decode to exactly 32 bytes/u],
    ["active ID not in ring", { ...bank, SUPPLIER_BANK_ACTIVE_KEY_ID: "enc-2" }, /Supplier config "bankEncryption\.activeKeyId" must exist in its keyRing/u],
    ["ring not JSON", { ...bank, SUPPLIER_BANK_LOOKUP_KEYS: `look-1=${LOOKUP}` }, /Supplier config "bankLookup\.keyRing" must be a valid JSON object/u],
    ["threshold below range", { ...bank, SUPPLIER_DUPLICATE_NAME_THRESHOLD: "0.3141" }, /Supplier config "duplicateNameThreshold" must be between 0\.5 and 1/u, "0.3141"],
    ["import rows above limit", { ...bank, SUPPLIER_IMPORT_MAX_ROWS: "50017" }, /Supplier config "import\.maxRows" must be a positive integer/u, "50017"],
    ["import bytes not a number", { ...bank, SUPPLIER_IMPORT_MAX_FILE_BYTES: "tenbytes" }, /Supplier config "import\.maxFileBytes" must be a positive integer/u, "tenbytes"],
    ["import root relative", { ...bank, SUPPLIER_IMPORT_ROOT: "relimportroot" }, /Supplier config "import\.root" must be an absolute path/u, "relimportroot"]
  ];
  // 設計 §1700：Bank table 已部署，兩組 key ring 就係無條件嘅開機要求；兩邊都冇設都要拒絕。
  cases.push(["no Bank keys for either owner", bankEnv({ ACTIVE_KEY_ID: "", ENCRYPTION_KEYS: "", LOOKUP_ACTIVE_KEY_ID: "", LOOKUP_KEYS: "" }),
    /SupplierBankCrypto requires both the bankEncryption and bankLookup key rings/u]);
  // 對照：同一組正確設定起得到。
  const control = await startServer(name, bank);
  try {
    assert.equal(control.listening, true, `control: the good settings start: ${control.output.stderr}`);
  } finally {
    await control.stop();
  }
  for (const [label, env, message, raw] of cases) {
    const server = await startServer(name, env);
    await server.stop();
    // stderr 係一行 JSON：message 入面嘅 `"` 變咗 `\"`。
    const output = `${server.output.stdout}\n${server.output.stderr}`.replaceAll('\\"', '"');
    assert.equal(server.listening, false, `${label}: must not start`);
    assert.equal(server.code, 1, `${label}: exit code`);
    // 起咗再死都唔得：從來冇印過「listening」（REV-102 M-1）。
    assert.equal(server.output.stdout.includes("API listening on"), false, `${label}: never listened`);
    assert.match(output, message, label);
    for (const secret of [KEY, LOOKUP, SHORT, KEY.slice(0, 20), LOOKUP.slice(0, 20), ...(raw ? [raw] : [])]) {
      assert.equal(output.includes(secret), false, `${label}: leaks ${secret === raw ? "the raw value" : "key material"}`);
    }
  }
});

integrationTest("TC-006 (MIG-006): adding Supplier to an existing deployment changes no existing table or row, writes only Supplier tables and its permission seed, drops nothing it does not own, and the server starts on the upgraded schema", async (t) => {
  const { name, connection } = await scratchDatabase(t);
  const migrations = await allMigrations();
  // 未有 Supplier 嘅部署：其他模組嘅 migration 全部做咗，再加啲核心資料（用戶、角色、用戶 audit）。
  for (const migration of migrations.filter((file) => !isSupplierMigration(file))) await apply(connection, migration);
  const [user] = await connection.query(
    "INSERT INTO users (username, password_hash, created_at, updated_at) VALUES ('mig006-operator', 'not-a-real-hash', 1, 1)");
  const [[role]] = await connection.query("SELECT id FROM roles WHERE name = 'system-admin'");
  await connection.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [user.insertId, role.id]);
  await connection.query(
    `INSERT INTO user_audit_logs (action, actor_username, occurred_at, target_label, target_type)
     VALUES ('user.create', 'mig006-operator', 1, 'mig006-operator', 'user')`);
  const before = await snapshot(connection, name, { keepTimes: true });
  assert.ok(before.users.data.length > 0 && before.user_audit_logs.data.length > 0, "control: the existing data is in the snapshot");
  assert.ok(before.users.data.some((row) => row.includes('"created_at",1')), "control: time columns are compared too");

  const supplierMigrations = migrations.filter(isSupplierMigration);
  assert.deepEqual(supplierMigrations.map((file) => file.slice("migrations/".length, "migrations/0000".length)),
    ["0028", "0029", "0030", "0031", "0032", "0033", "0034", "0035", "0036", "0037", "0061", "0062", "0080", "0081", "0087"]);
  const recorder = recording(connection);
  for (const migration of supplierMigrations) await apply(recorder.connection, migration);
  const after = await snapshot(connection, name, { keepTimes: true });

  // 1. 原有嘅表：schema 唔變；資料唔變，除咗權限 seed 加嘅行（只可以加，唔可以改或者刪）。
  const supplierTable = (table) => table === "suppliers" || table.startsWith("supplier_");
  for (const [table, previous] of Object.entries(before)) {
    if (table === "#triggers") {
      assert.deepEqual(after[table], previous, "triggers unchanged");
      continue;
    }
    assert.equal(after[table]?.schema, previous.schema, `${table}: schema unchanged`);
    if (table === "permissions" || table === "role_permissions") {
      const kept = new Set(after[table].data);
      assert.deepEqual(previous.data.filter((row) => !kept.has(row)), [], `${table}: every existing row kept as it was`);
      continue;
    }
    assert.deepEqual(after[table].data, previous.data, `${table}: rows unchanged`);
  }
  const [added] = await connection.query(
    `SELECT p.name AS name FROM permissions p WHERE p.name LIKE 'supplier.%' ORDER BY p.name`);
  assert.deepEqual(added.map((row) => row.name), SUPPLIER_PERMISSIONS);
  assert.equal(after.permissions.data.length - before.permissions.data.length, SUPPLIER_PERMISSIONS.length, "only the six Supplier permissions are new");
  assert.equal(after.role_permissions.data.length - before.role_permissions.data.length, SUPPLIER_PERMISSIONS.length,
    "only their six system-admin grants are new");
  const [grantees] = await connection.query(
    `SELECT DISTINCT r.name AS name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name LIKE 'supplier.%'`);
  assert.deepEqual(grantees.map((row) => row.name), ["system-admin"]);
  const newTables = Object.keys(after).filter((table) => !(table in before));
  assert.ok(newTables.length > 0 && newTables.every(supplierTable), `only Supplier tables are new: ${newTables.join(", ")}`);

  // 2. 寫入：Supplier 自己嘅表，加權限 seed 嘅 INSERT；冇 drop table、冇 drop column、冇 TRUNCATE；
  //    唯一嘅 DROP INDEX 係 0087 重排自己嘅 index（HD-114 A）。
  const target = (sql) => /^(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE|INSERT(?: IGNORE)? INTO|UPDATE|DELETE FROM|REPLACE INTO|DROP TABLE(?: IF EXISTS)?|TRUNCATE(?: TABLE)?)\s+`?(\w+)`?/iu.exec(sql)?.[1];
  const outside = recorder.writes.filter((sql) => {
    const table = target(sql);
    if (supplierTable(table ?? "")) return false;
    return !(/^INSERT INTO (permissions|role_permissions)\b/iu.test(sql));
  });
  assert.deepEqual(outside, [], "no Supplier migration writes another module's table, except inserting its permission seed");
  assert.ok(recorder.writes.every((sql) => target(sql)), `every write names its table: ${recorder.writes.filter((sql) => !target(sql)).join(" | ")}`);
  // 任何 DROP（table、column、key、constraint、check、primary key）同 TRUNCATE：只准 0087 重排自己嘅 index（REV-105 L-3）。
  const drops = recorder.writes.filter((sql) => /\b(DROP|TRUNCATE)\b/iu.test(sql));
  assert.ok(drops.length > 0, "control: 0087's own drop is recorded");
  assert.deepEqual(drops.filter((sql) => !(target(sql) === "supplier_sku_refs" && /^ALTER TABLE `?supplier_sku_refs`? (DROP INDEX idx_supplier_sku_refs_sku_status_supplied|ADD INDEX idx_supplier_sku_refs_sku \(sku_id\), DROP INDEX)/iu.test(sql))),
    [], "nothing dropped or truncated except 0087's index reorder");

  // 3. 新 schema 讀得：真 server 用升級咗嘅 database 起得到（SupplierCoreProvider 係 eager，唔 READY 就起唔到）。
  const server = await startServer(name, bankEnv());
  let stopped;
  try {
    assert.equal(server.listening, true, `the server must start on the upgraded schema: ${server.code} ${server.output.stderr}`);
    const health = await fetch(`http://127.0.0.1:${server.port}/api/v1/health`);
    assert.equal(health.status, 200);
  } finally {
    stopped = await server.stop();
  }
  assert.equal(stopped, 0, "a clean shutdown");
});
