import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerAuditLogService } from "../../src/modules/customer/CustomerAuditLogService.js";
import { CustomerBankCrypto } from "../../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankService } from "../../src/modules/customer/CustomerBankService.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";
import { normalizeCustomerConfig } from "../../src/modules/customer/normalizeCustomerConfig.js";
import { CustomerAttachmentStorage } from "../../src/services/customerFile/CustomerAttachmentStorage.js";
import { CustomerImportStorage } from "../../src/services/customerImport/CustomerImportStorage.js";
import { FileTypeService } from "../../src/services/filetype/FileTypeService.js";

const enabled = process.env.CUSTOMER_LOCAL_RESTORE_TESTS === "1";
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("Customer restore safety guard rejects an ordinary DB name before connecting", () => {
  const env = { ...process.env, CUSTOMER_LOCAL_RESTORE_TESTS: "1", DB_NAME: "erp_dev" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=^LOCAL-035", import.meta.filename], {
    env, encoding: "utf8", timeout: 10_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /erp_customer_local_dr_source/u);
  assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|Access denied/u);
});

test("Customer restore safety guard rejects a non-task MySQL port before connecting", () => {
  const env = { ...process.env, CUSTOMER_LOCAL_RESTORE_TESTS: "1", DB_NAME: "erp_customer_local_dr_source_guard",
    CUSTOMER_RESTORE_DB_NAME: "erp_customer_local_dr_restore_guard", DB_HOST: "127.0.0.1", DB_PORT: "13370" };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=^LOCAL-035", import.meta.filename], {
    env, encoding: "utf8", timeout: 10_000
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /13370 !== 13369/u);
  assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|Access denied/u);
});

async function snapshot(connection) {
  const [tables] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND (table_name = 'customers' OR table_name LIKE 'customer\\_%') ORDER BY table_name"
  );
  const result = {};
  for (const { name } of tables) {
    const [rows] = await connection.query("SELECT * FROM ??", [name]);
    result[name] = { count: rows.length, sha256: hash(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())) };
  }
  assert.ok(Object.keys(result).length >= 10);
  return result;
}

function attachmentStorage(root, keys) {
  const config = normalizeCustomerConfig({ ...keys, attachment: {
    generalRoot: path.join(root, "general"), bankSensitiveRoot: path.join(root, "sensitive"), tempRoot: path.join(root, "temp"),
    malwareScanner: { mode: "clamd", host: "127.0.0.1", port: 3310, timeoutMs: 1000 }
  } });
  return new CustomerAttachmentStorage({ config: config.attachment, encryption: config.bankEncryption,
    scanner: { async scan() { return { status: "clean" }; } }, fileTypes: new FileTypeService() });
}

function bankCrypto(keys) {
  const config = normalizeCustomerConfig(keys);
  return new CustomerBankCrypto({ encryption: config.bankEncryption, lookup: config.bankLookup });
}

test("LOCAL-035 TC-085/086/087 isolated logical restore reconciles Customer DB, keys, files and audit", {
  skip: enabled ? false : "requires explicit task-owned MySQL instance and empty restore schema",
  timeout: 10 * 60_000
}, async (t) => {
  const sourceName = process.env.DB_NAME;
  const restoreName = process.env.CUSTOMER_RESTORE_DB_NAME;
  assert.match(sourceName ?? "", /^erp_customer_local_dr_source_[a-z0-9_]+$/u);
  assert.match(restoreName ?? "", /^erp_customer_local_dr_restore_[a-z0-9_]+$/u);
  assert.equal(process.env.DB_HOST, "127.0.0.1");
  assert.equal(Number(process.env.DB_PORT), 13369);
  const runtime = await realpath(process.env.CUSTOMER_LOCAL_RUNTIME_ROOT);
  assert.match(runtime, /^\/private\/tmp\/erp-customer-local-runtime\.[A-Za-z0-9]+$/u);
  const options = { host: "127.0.0.1", port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "" };
  const source = await mysql.createConnection({ ...options, database: sourceName });
  t.after(() => source.end());
  const destination = await mysql.createConnection({ ...options, database: restoreName });
  t.after(() => destination.end());
  const [[server]] = await source.query("SELECT @@datadir AS datadir, VERSION() AS version");
  assert.equal(await realpath(server.datadir), await realpath(path.join(runtime, "mysql")));
  const [[count]] = await source.query("SELECT COUNT(*) AS total FROM customers");
  assert.equal(Number(count.total), 0, "source must be an unused synthetic schema");
  assert.equal((await destination.query("SHOW TABLES"))[0].length, 0, "never overwrite an existing restore schema");
  const root = await mkdtemp(path.join(runtime, "restore-case-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = {
    bankEncryption: { activeKeyId: "local-enc", keyRing: { "local-enc": randomBytes(32).toString("base64") } },
    bankLookup: { activeKeyId: "local-lookup", keyRing: { "local-lookup": randomBytes(32).toString("base64") } }
  };
  const now = Date.now();
  const [user] = await source.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`restore-${randomUUID()}`, "unused-test-hash", "Synthetic restore actor", now, now]
  );
  const actorId = Number(user.insertId);
  const [customer] = await source.execute(
    "INSERT INTO customers (customer_code,customer_code_key,legal_name,legal_name_key,default_currency_code,created_at,updated_at) VALUES ('LOCAL-RESTORE','local-restore','Local Restore','local restore','HKD',?,?)", [now, now]
  );
  const customerId = Number(customer.insertId);
  const database = { query: source.query.bind(source), async withTransaction(work) {
    await source.beginTransaction();
    try { const value = await work(source); await source.commit(); return value; }
    catch (error) { await source.rollback(); throw error; }
  } };
  const account = `88${randomBytes(10).toString("hex").toUpperCase()}`;
  const audit = new CustomerAuditLogService();
  const bank = await new CustomerBankService({ database, crypto: bankCrypto(keys), time: { nowMs: () => Date.now() },
    authorize: async () => ({ username: "restore-test", permissions: ["customer.view", "customer.bank.view", "customer.bank.mgmt"] })
  }).create({ actorId, customerId, accountNumber: account, accountHolderName: "Synthetic Restore", bankName: "Synthetic Bank",
    bankCountryCode: "HK", purposeCode: "general", reason: "local isolated restore fixture", requestId: "local-restore-bank" });

  async function operation(route) {
    const id = randomUUID();
    await source.execute(
      "INSERT INTO customer_operation_requests (id,actor_user_id,route_key,idempotency_key,payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,'succeeded',?,?)",
      [id, actorId, route, randomUUID(), randomBytes(32), now, now]
    );
    return id;
  }
  const filesRoot = path.join(root, "source-files");
  const storage = attachmentStorage(filesRoot, keys);
  const attachments = [];
  for (const sensitivity of ["general", "bank_sensitive"]) {
    const content = Buffer.from(`%PDF-1.7\nSynthetic local ${sensitivity} restore sample\n%%EOF\n`);
    const operationId = await operation("customer.attachment.upload");
    const metadata = await storage.stage({ operationId, customerId, sensitivity, content,
      mimeType: "application/pdf", originalFilename: "synthetic.pdf" });
    await storage.finalize(metadata);
    const [created] = await source.query("INSERT INTO customer_attachments SET ?", {
      customer_id: customerId, display_name: "Synthetic restore sample", document_type: "contract", sensitivity,
      original_filename: "synthetic.pdf", operation_id: operationId, stored_name: metadata.storedName,
      mime_type: metadata.mimeType, extension: metadata.extension, size_bytes: metadata.sizeBytes,
      sha256: metadata.sha256, storage_class: metadata.storageClass, scan_status: "clean", status: "active",
      created_at: now, updated_at: now, created_by: actorId
    });
    await source.execute("UPDATE customer_operation_requests SET resource_type='customer_attachment',resource_id=? WHERE id=?", [created.insertId, operationId]);
    await audit.record(source, { occurredAt: now, actorUserId: actorId, actorUsername: "restore-test", action: "attachment.upload",
      targetType: "attachment", targetId: Number(created.insertId), customerId, reason: "local restore fixture",
      detail: { after: { sensitivity } }, requestId: `local-restore-${sensitivity}` });
    attachments.push({ metadata, contentHash: hash(content), objectHash: hash(await readFile(path.join(filesRoot, sensitivity === "general" ? "general" : "sensitive", metadata.storedName))) });
  }
  const importRoot = path.join(filesRoot, "imports");
  const imports = new CustomerImportStorage({ config: { root: importRoot, maxFileBytes: 1024 * 1024 } });
  const importOperation = await operation("customer.import.upload");
  const importSource = await imports.stageSource({ operationId: importOperation, content: Buffer.from("customerCode,legalName\r\nLOCAL-RESTORE,Local Restore\r\n") });
  await imports.finalizeSource(importSource);
  const importResult = await imports.stageResult({ operationId: importOperation, source: [Buffer.from("row,status\r\n1,applied\r\n")] });
  await imports.finalizeResult(importResult);
  const [job] = await source.query("INSERT INTO customer_import_jobs SET ?", {
    idempotency_key: randomUUID(), template_version: "v1", operation_id: importOperation,
    source_stored_name: importSource.storedName, source_sha256: importSource.sha256, source_storage_status: "active",
    result_stored_name: importResult.storedName, result_sha256: importResult.sha256, result_storage_status: "active",
    mode: "upsert", activation_mode: "draft", status: "completed", total_count: 1, valid_count: 1, success_count: 1,
    created_by: actorId, confirmed_by: actorId, created_at: now, updated_at: now, completed_at: now
  });
  await source.query("INSERT INTO customer_import_rows SET ?", {
    job_id: job.insertId, row_number: 1, operation: "update", normalized_payload: JSON.stringify({ root: { customerCode: "LOCAL-RESTORE" } }),
    status: "applied", applied_customer_id: customerId, errors: "[]", warnings: "[]"
  });
  await audit.record(source, { occurredAt: now, actorUserId: actorId, actorUsername: "restore-test", action: "import.complete",
    targetType: "import", targetId: Number(job.insertId), reason: "local restore fixture", detail: { after: { successCount: 1 } }, requestId: "local-restore-import" });
  const latestRecoveredWrite = Date.now();
  const expected = await snapshot(source);
  assert.equal(expected.customer_bank_accounts.count, 1);
  assert.equal(expected.customer_attachments.count, 2);
  assert.ok(expected.customer_audit_logs.count >= 4);
  const backupPoint = Date.now();
  const dumpFile = path.join(root, "backup.sql");
  const clientArgs = ["--no-defaults", "--host=127.0.0.1", `--port=${options.port}`, `--user=${options.user}`];
  const clientEnv = { ...process.env, MYSQL_PWD: options.password };
  const dumpFd = openSync(dumpFile, "wx", 0o600);
  try {
    const dumped = spawnSync(process.env.CUSTOMER_MYSQLDUMP_BIN || "mysqldump", [...clientArgs,
      "--single-transaction", "--skip-lock-tables", "--no-tablespaces", "--set-gtid-purged=OFF", "--hex-blob", sourceName],
    { env: clientEnv, stdio: ["ignore", dumpFd, "pipe"], timeout: 120_000 });
    assert.equal(dumped.status, 0, "actual mysqldump must succeed");
  } finally { closeSync(dumpFd); }
  await cp(filesRoot, path.join(root, "backup-files"), { recursive: true });
  await writeFile(path.join(root, "backup-keys.json"), JSON.stringify(keys), { mode: 0o600, flag: "wx" });
  const dumpSha256 = hash(await readFile(dumpFile));
  await source.execute("INSERT INTO customers (customer_code,customer_code_key,legal_name,legal_name_key,created_at,updated_at) VALUES ('LOSS-MARKER','loss-marker','Loss Marker','loss marker',?,?)", [Date.now(), Date.now()]);
  const lastConfirmedWrite = Date.now();
  const incidentAt = Date.now();
  const restoreStarted = performance.now();
  const dumpInput = openSync(dumpFile, "r");
  try {
    const restored = spawnSync(process.env.CUSTOMER_MYSQL_BIN || "mysql", [...clientArgs, restoreName],
      { env: clientEnv, stdio: [dumpInput, "ignore", "pipe"], timeout: 120_000 });
    assert.equal(restored.status, 0, "actual mysql restore must succeed");
  } finally { closeSync(dumpInput); }
  const restoredRoot = path.join(root, "restored-files");
  await cp(path.join(root, "backup-files"), restoredRoot, { recursive: true });
  const restoredKeys = JSON.parse(await readFile(path.join(root, "backup-keys.json"), "utf8"));
  assert.deepEqual(await snapshot(destination), expected);
  const [[loss]] = await destination.query("SELECT COUNT(*) AS total FROM customers WHERE customer_code_key='loss-marker'");
  assert.equal(Number(loss.total), 0);
  const restoredStorage = attachmentStorage(restoredRoot, restoredKeys);
  for (const { metadata, contentHash, objectHash } of attachments) {
    assert.equal(hash(await restoredStorage.read(metadata)), contentHash);
    assert.equal(hash(await readFile(path.join(restoredRoot, metadata.sensitivity === "general" ? "general" : "sensitive", metadata.storedName))), objectHash);
  }
  const restoredImports = new CustomerImportStorage({ config: { root: path.join(restoredRoot, "imports"), maxFileBytes: 1024 * 1024 } });
  assert.equal(hash(await restoredImports.readSource(importSource)), importSource.sha256.toString("hex"));
  assert.equal(hash(await restoredImports.readResult(importResult)), importResult.sha256.toString("hex"));
  const [[bankRow]] = await destination.query("SELECT * FROM customer_bank_accounts WHERE id=?", [bank.id]);
  const sealed = { customerId: bankRow.customer_id, cryptoContext: bankRow.crypto_context, ciphertext: bankRow.account_ciphertext,
    iv: bankRow.account_iv, authTag: bankRow.account_auth_tag, encryptionKeyId: bankRow.encryption_key_id };
  assert.equal(bankCrypto(restoredKeys).decrypt(sealed), account);
  assert.equal((await new CustomerLookupService({ database: destination }).findByCode("LOCAL-RESTORE", { purpose: "history" })).customerId, customerId);
  let keyFailures = 0;
  for (const [keyId, keyValue] of [["missing-id", randomBytes(32).toString("base64")], ["local-enc", randomBytes(32).toString("base64")]]) {
    const badKeys = { ...restoredKeys, bankEncryption: { activeKeyId: keyId, keyRing: { [keyId]: keyValue } } };
    assert.throws(() => bankCrypto(badKeys).decrypt(sealed));
    for (const { metadata } of attachments) await assert.rejects(() => attachmentStorage(restoredRoot, badKeys).read(metadata));
    keyFailures += 3;
  }
  const recoveryMs = performance.now() - restoreStarted;
  const localLossWindowMs = lastConfirmedWrite - latestRecoveredWrite;
  assert.ok(localLossWindowMs <= 15 * 60_000);
  assert.ok(recoveryMs <= 4 * 60 * 60_000);
  const summary = { case: "LOCAL-035", mysql: server.version, sourceName, restoreName,
    backupPoint, latestRecoveredWrite, lastConfirmedWrite, incidentAt, localLossWindowMs, localRecoveryMs: recoveryMs,
    dumpSha256, tables: expected, attachmentObjects: attachments.length, importObjects: 2,
    failClosedChecks: keyFailures, downstreamIntegration: "BLOCKED", productionRtoRpo: "NOT_PROVEN" };
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(account), false);
  for (const ring of [keys.bankEncryption.keyRing, keys.bankLookup.keyRing]) {
    for (const value of Object.values(ring)) assert.equal(serialized.includes(value), false);
  }
  console.log(serialized);
});
