import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import databaseConfig from "../../config/database.js";
import { normalizeDatabaseConfig } from "../../src/framework/configuration/normalizeDatabaseConfig.js";
import { CustomerApprovalService } from "../../src/modules/customer/CustomerApprovalService.js";
import { CustomerBankCrypto } from "../../src/modules/customer/CustomerBankCrypto.js";
import { CustomerBankService } from "../../src/modules/customer/CustomerBankService.js";
import { CustomerPartyService } from "../../src/modules/customer/CustomerPartyService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { normalizeCustomerConfig } from "../../src/modules/customer/normalizeCustomerConfig.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Local TC-080/081/083 real Customer security and contention", { timeout: 60_000 }, async (t) => {
  assert.ok(process.env.DB_ADMIN_USER, "DB_ADMIN_USER must identify the isolated fixture administrator");
  assert.notEqual(process.env.DB_ADMIN_PASSWORD, undefined, "DB_ADMIN_PASSWORD must be explicitly configured");
  const config = normalizeDatabaseConfig(databaseConfig);
  const admin = createMySqlDatabasePool({ ...config, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const sqlUser = `cm_guard_${suffix}`;
  const canary = `cm_guard_${suffix}`;
  const deniedCanary = `${canary}_denied`;
  const roleName = `customer-guard-${suffix}`;
  const permissions = ["customer.approval", "customer.bank.mgmt", "customer.bank.view", "customer.mgmt", "customer.view"];
  let db = null;
  let approvalDb = null;
  let actorId = null;
  let roleId = null;
  let approverId = null;
  let customerId;

  t.after(async () => {
    try {
      await approvalDb?.shutdown();
      await db?.shutdown();
      if (actorId) {
        await admin.execute("DELETE FROM customer_audit_logs WHERE actor_user_id IN (?, ?)", [actorId, approverId ?? 0]);
        await admin.execute("DELETE FROM customer_operation_requests WHERE actor_user_id IN (?, ?)", [actorId, approverId ?? 0]);
        await admin.execute("DELETE FROM customer_activation_requests WHERE customer_id IN (SELECT id FROM customers WHERE created_by = ?)", [actorId]);
        await admin.execute("DELETE FROM customers WHERE created_by = ?", [actorId]);
        await admin.execute("DELETE FROM users WHERE id IN (?, ?)", [actorId, approverId ?? 0]);
      }
      if (roleId) await admin.execute("DELETE FROM roles WHERE id = ?", [roleId]);
      await admin.query("DROP TABLE IF EXISTS ??, ??", [canary, deniedCanary]);
    } finally {
      try { await admin.query("DROP USER IF EXISTS ?@'%'", [sqlUser]); }
      finally { await admin.end(); }
    }
  });

  // Ephemeral fixture only: '%' also permits the CI host to reach its isolated MySQL container.
  const password = randomBytes(24).toString("hex");
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?", [sqlUser, password]);
  const readTables = [
    "users", "roles", "permissions", "user_roles", "role_permissions", "customers",
    "customer_operation_requests", "customer_addresses",
    "customer_address_purposes", "customer_contacts", "customer_contact_purposes",
    "customer_identifiers", "customer_credit_profiles", "customer_bank_accounts"
  ];
  const expectedPrivileges = readTables.map((table) => `${config.database}.${table}:SELECT:NO`);
  for (const table of readTables) {
    await admin.query("GRANT SELECT ON ??.?? TO ?@'%'", [config.database, table, sqlUser]);
  }
  for (const table of ["customers", "customer_operation_requests", "customer_addresses", "customer_bank_accounts"]) {
    await admin.query("GRANT INSERT, UPDATE ON ??.?? TO ?@'%'", [config.database, table, sqlUser]);
    expectedPrivileges.push(`${config.database}.${table}:INSERT:NO`, `${config.database}.${table}:UPDATE:NO`);
  }
  await admin.query("GRANT INSERT ON ??.customer_audit_logs TO ?@'%'", [config.database, sqlUser]);
  await admin.query("GRANT INSERT, UPDATE, DELETE ON ??.customer_address_purposes TO ?@'%'", [config.database, sqlUser]);
  expectedPrivileges.push(`${config.database}.customer_audit_logs:INSERT:NO`, ...["INSERT", "UPDATE", "DELETE"].map((privilege) => `${config.database}.customer_address_purposes:${privilege}:NO`));
  const [grants] = await admin.query("SHOW GRANTS FOR ?@'%'", [sqlUser]);
  for (const row of grants) {
    const grant = Object.values(row)[0];
    assert.doesNotMatch(grant, /ALL PRIVILEGES|WITH GRANT OPTION|ON `[^`]+`\.\*/);
    if (grant.includes(" ON *.* ")) assert.match(grant, /^GRANT USAGE ON \*\.\* TO /);
  }
  const grantee = `'${sqlUser}'@'%'`;
  const [tablePrivileges] = await admin.execute("SELECT CONCAT(TABLE_SCHEMA, '.', TABLE_NAME, ':', PRIVILEGE_TYPE, ':', IS_GRANTABLE) AS privilege FROM information_schema.table_privileges WHERE GRANTEE = ?", [grantee]);
  assert.deepEqual(tablePrivileges.map((row) => row.privilege).sort(), expectedPrivileges.sort());
  const [[columnPrivileges]] = await admin.execute("SELECT COUNT(*) AS n FROM information_schema.column_privileges WHERE GRANTEE = ?", [grantee]);
  assert.equal(Number(columnPrivileges.n), 0);

  const now = Date.now();
  const [user] = await admin.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [roleName, await hashPassword(password), "Customer guard fixture", now, now]);
  actorId = Number(user.insertId);
  const [role] = await admin.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [roleName, now]);
  roleId = Number(role.insertId);
  await admin.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [actorId, roleId]);
  const [seededPermissions] = await admin.execute("SELECT id FROM permissions WHERE name IN (?, ?, ?, ?, ?)", permissions);
  assert.equal(seededPermissions.length, permissions.length);
  for (const permission of seededPermissions) {
    await admin.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permission.id]);
  }

  const time = { nowMs: () => Date.now() };
  const context = new RequestContextService({ services: { require: () => time } });
  const runtimeConfig = { ...config, user: sqlUser, password };
  const pool = createMySqlDatabasePool(runtimeConfig);
  db = new MySqlDatabaseService({ pool, config: runtimeConfig, context });
  await db.initialize();
  const service = new CustomerService({ database: db, time });
  const actor = { actorId, claimedRoles: [roleName], claimedPermissions: permissions };
  const input = { ...actor, idempotencyKey: `create-${suffix}`, customerCode: `GUARD-${suffix}`, legalName: `Guard fixture ${suffix}`, requestId: `create-${suffix}` };
  const keyMaterial = [randomBytes(32).toString("base64"), randomBytes(32).toString("base64")];
  const bankConfig = normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "guard-enc", keyRing: { "guard-enc": keyMaterial[0] } },
    bankLookup: { activeKeyId: "guard-lookup", keyRing: { "guard-lookup": keyMaterial[1] } }
  });
  const logs = [];
  const banks = new CustomerBankService({ database: db, time,
    crypto: new CustomerBankCrypto({ encryption: bankConfig.bankEncryption, lookup: bankConfig.bankLookup }),
    logger: { warn: (...args) => logs.push(args) } });
  const accountNumber = randomBytes(16).toString("hex").toUpperCase();
  let bankId;

  await t.test("LOCAL-081-DML: real actor, idempotent create, read, update and correlated audit", async () => {
    const created = await service.create(input);
    customerId = created.customer.id;
    const replay = await service.create(input);
    assert.equal(replay.customer.id, customerId);
    assert.equal(replay.operation.operationId, created.operation.operationId);
    assert.equal((await service.get({ ...actor, id: customerId })).version, 1);
    const updated = await service.update({ ...input, id: customerId, version: 1, idempotencyKey: `update-${suffix}`, requestId: `update-${suffix}`, reason: "local least privilege proof", notes: "synthetic update" });
    assert.equal(updated.customer.version, 2);
    assert.equal((await service.get({ ...actor, id: customerId })).notes, "synthetic update");
    const [[count]] = await admin.execute("SELECT COUNT(*) AS n FROM customers WHERE customer_code = ?", [input.customerCode]);
    assert.equal(Number(count.n), 1);
    const [operations] = await admin.execute("SELECT route_key, status FROM customer_operation_requests WHERE actor_user_id = ? ORDER BY route_key", [actorId]);
    assert.deepEqual(operations.map((row) => [row.route_key, row.status]), [["customer.create", "succeeded"], ["customer.update", "succeeded"]]);
    const [audit] = await admin.execute("SELECT action, request_id, actor_user_id FROM customer_audit_logs WHERE customer_id = ? ORDER BY id", [customerId]);
    assert.deepEqual(audit.map((row) => [row.action, row.request_id, Number(row.actor_user_id)]), [["customer.create", input.requestId, actorId], ["customer.update", `update-${suffix}`, actorId]]);
  });

  await t.test("LOCAL-081-DENY: actual MySQL denies DDL, audit mutation and self-grants", async () => {
    assert.ok(customerId, "positive fixture must exist before negative checks");
    await admin.query("CREATE TABLE ?? (id INT PRIMARY KEY)", [canary]);
    const [beforeAudit] = await admin.execute("SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY id", [customerId]);
    const [beforeColumns] = await admin.query("SHOW COLUMNS FROM ??", [canary]);
    const attempts = [
      ["CREATE TABLE ?? (id INT)", [deniedCanary]],
      ["ALTER TABLE ?? ADD COLUMN tampered INT", [canary]],
      ["DROP TABLE ??", [canary]],
      ["UPDATE customer_audit_logs SET reason = 'tampered' WHERE customer_id = ?", [customerId]],
      ["DELETE FROM customer_audit_logs WHERE customer_id = ?", [customerId]],
      ["GRANT UPDATE ON ??.customer_audit_logs TO ?@'%'", [config.database, sqlUser]]
    ];
    for (const [sql, values] of attempts) {
      await assert.rejects(() => pool.query(sql, values), (error) => [1044, 1142, 1227].includes(error.errno) && error.sqlState === "42000");
    }
    const [afterAudit] = await admin.execute("SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY id", [customerId]);
    assert.deepEqual(afterAudit, beforeAudit);
    assert.deepEqual((await admin.query("SHOW COLUMNS FROM ??", [canary]))[0], beforeColumns);
    const [[deniedTable]] = await admin.execute("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?", [config.database, deniedCanary]);
    assert.equal(Number(deniedTable.n), 0);
    assert.equal((await service.get({ ...actor, id: customerId })).version, 2);
    await admin.query("ALTER TABLE ?? ADD COLUMN admin_control INT", [canary]);
    assert.equal((await admin.query("SHOW COLUMNS FROM ??", [canary]))[0].length, beforeColumns.length + 1);
    await admin.query("DROP TABLE ??", [canary]);
  });

  await t.test("LOCAL-081-BANK: real nullable-currency bank commands use only owned tables and append-only audit", async () => {
    assert.ok(customerId);
    const common = { ...actor, customerId, accountHolderName: "Synthetic guard holder", bankName: "Synthetic guard bank",
      bankCountryCode: "HK", reason: "local bank privilege proof" };
    const created = await banks.create({ ...common, accountNumber, requestId: `bank-create-${suffix}` });
    bankId = created.id;
    const masked = await banks.list({ ...actor, customerId });
    assert.equal(masked.items.length, 1);
    assert.equal(masked.items[0].accountNumber, undefined);
    assert.equal(JSON.stringify(masked).includes(accountNumber), false);
    const revealed = await banks.reveal({ ...actor, customerId, bankAccountId: bankId, reason: common.reason, requestId: `bank-reveal-${suffix}` });
    assert.equal(revealed.accountNumber, accountNumber);
    const updated = await banks.update({ ...common, bankAccountId: bankId, version: 1, bankName: "Updated synthetic bank", requestId: `bank-update-${suffix}` });
    assert.equal(updated.version, 2);
    const inactive = await banks.deactivate({ ...actor, customerId, bankAccountId: bankId, version: 2, reason: common.reason, requestId: `bank-deactivate-${suffix}` });
    assert.equal(inactive.status, "inactive");
    const [[row]] = await admin.execute("SELECT account_ciphertext, account_currency_code, status, version FROM customer_bank_accounts WHERE id=?", [bankId]);
    assert.equal(row.account_currency_code, null, "non-null Currency locking is outside this least-privilege subset");
    assert.equal(row.status, "inactive");
    assert.equal(Number(row.version), 3);
    assert.equal(row.account_ciphertext.includes(Buffer.from(accountNumber)), false);
    const [audit] = await admin.execute("SELECT action,request_id,detail FROM customer_audit_logs WHERE customer_id=? AND target_type='bank' AND target_id=? ORDER BY id", [customerId, bankId]);
    assert.deepEqual(audit.map(r => [r.action, r.request_id]), ["create", "reveal", "update", "deactivate"].map(action => [`bank.${action}`, `bank-${action}-${suffix}`]));
    for (const secret of [accountNumber, ...keyMaterial]) assert.equal(JSON.stringify(audit).includes(secret), false);
  });

  await t.test("LOCAL-081-BANK-DENY: fresh permission and audit failure deny plaintext without bank mutation", async () => {
    assert.ok(bankId, "positive bank fixture must exist");
    const request = { ...actor, customerId, bankAccountId: bankId, reason: "local denied reveal proof", requestId: `bank-denied-${suffix}` };
    const [beforeAudit] = await admin.execute("SELECT * FROM customer_audit_logs WHERE customer_id=? ORDER BY id", [customerId]);
    const [beforeBank] = await admin.execute("SELECT * FROM customer_bank_accounts WHERE id=?", [bankId]);
    const [[permission]] = await admin.execute("SELECT id FROM permissions WHERE name='customer.bank.view'");
    await admin.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?", [roleId, permission.id]);
    try {
      await assert.rejects(() => banks.reveal(request), error => error.code === "PERMISSION_STALE");
      await assert.rejects(() => banks.reveal({ ...request, claimedPermissions: permissions.filter(p => p !== "customer.bank.view") }), error => error.publicCode === "BANK_PERMISSION_LOST");
    } finally { await admin.execute("INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)", [roleId, permission.id]); }
    await admin.query("REVOKE INSERT ON ??.customer_audit_logs FROM ?@'%'", [config.database, sqlUser]);
    let returned = false;
    try {
      await assert.rejects(() => banks.reveal(request).then(value => { returned = true; return value; }), error => error.code === "DATABASE_OPERATION_FAILED" && error.cause?.errno === 1142 && error.cause?.sqlState === "42000");
    } finally { await admin.query("GRANT INSERT ON ??.customer_audit_logs TO ?@'%'", [config.database, sqlUser]); }
    assert.equal(returned, false, "audit failure must prevent a plaintext result");
    assert.deepEqual((await admin.execute("SELECT * FROM customer_audit_logs WHERE customer_id=? ORDER BY id", [customerId]))[0], beforeAudit);
    assert.deepEqual((await admin.execute("SELECT * FROM customer_bank_accounts WHERE id=?", [bankId]))[0], beforeBank);
  });

  await t.test("LOCAL-080-BANK-DB: stored integrity failure emits only a safe correlated event", async () => {
    assert.ok(bankId, "positive bank fixture must exist");
    const [[row]] = await admin.execute("SELECT account_auth_tag FROM customer_bank_accounts WHERE id=?", [bankId]);
    const changed = Buffer.from(row.account_auth_tag); changed[0] ^= 1;
    const [[before]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id=? AND action='bank.reveal'", [customerId]);
    await admin.execute("UPDATE customer_bank_accounts SET account_auth_tag=? WHERE id=?", [changed, bankId]);
    try {
      await assert.rejects(() => banks.reveal({ ...actor, customerId, bankAccountId: bankId, reason: "local corrupt bank proof", requestId: `integrity-${suffix}` }), error => error.publicCode === "BANK_ACCOUNT_UNREADABLE" && error.statusCode === 422);
      assert.deepEqual(logs, [["customer.bank.reveal.unreadable", "Customer bank account could not be read", {
        customerId, bankAccountId: bankId, requestId: `integrity-${suffix}`, reason: "BANK_INTEGRITY_FAILED"
      }]]);
      for (const secret of [accountNumber, ...keyMaterial]) assert.equal(JSON.stringify(logs).includes(secret), false);
      const [[after]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id=? AND action='bank.reveal'", [customerId]);
      assert.equal(Number(after.n), Number(before.n));
    } finally { await admin.execute("UPDATE customer_bank_accounts SET account_auth_tag=? WHERE id=?", [row.account_auth_tag, bankId]); }
    assert.equal((await banks.reveal({ ...actor, customerId, bankAccountId: bankId, reason: "local repaired fixture proof", requestId: `repaired-${suffix}` })).accountNumber, accountNumber);
    assert.equal(logs.length, 1, "successful read must not emit another unreadable event");
  });

  await t.test("LOCAL-083-DEFAULT: 100 same-version commands reconcile defaults, versions and real audit", async () => {
    assert.ok(customerId, "positive fixture must exist before contention");
    const party = new CustomerPartyService({ database: db, time });
    const common = { ...actor, type: "address", customerId, purposes: [{ code: "shipping", isDefault: false }] };
    const first = await party.create({ ...common, label: "First", addressLine1: "1 Fixture Road" });
    const second = await party.create({ ...common, label: "Second", addressLine1: "2 Fixture Road" });
    const before = await service.get({ ...actor, id: customerId });
    const [[beforeAudit]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
    const start = Promise.withResolvers();
    const commands = Array.from({ length: 100 }, (_, index) => {
      const target = index % 2 === 0 ? first : second;
      return start.promise.then(() => party.update({ ...common, partyId: target.id, version: 1, reason: "concurrent default proof", label: `Choice ${index}`, addressLine1: "Fixture Road", purposes: [{ code: "shipping", isDefault: true }], requestId: `race-${suffix}-${index}` }));
    });
    start.resolve();
    const results = await Promise.allSettled(commands);
    const winners = results.filter((result) => result.status === "fulfilled").map((result) => result.value.id).sort((a, b) => a - b);
    assert.deepEqual(winners, [first.id, second.id].sort((a, b) => a - b));
    const losers = results.filter((result) => result.status === "rejected");
    assert.equal(losers.length, 98);
    assert.ok(losers.every((result) => result.reason.code === "VERSION_CONFLICT"), "losers must be CAS conflicts, not DB or timeout failures");
    const after = await service.get({ ...actor, id: customerId });
    assert.equal(after.version, before.version + 2);
    const [addresses] = await admin.execute("SELECT id, version FROM customer_addresses WHERE customer_id = ? ORDER BY id", [customerId]);
    assert.deepEqual(addresses.map((row) => [Number(row.id), Number(row.version)]), [[first.id, 2], [second.id, 2]].sort((a, b) => a[0] - b[0]));
    const [[defaults]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_address_purposes WHERE customer_id = ? AND purpose_code = 'shipping' AND is_default = 1", [customerId]);
    assert.equal(Number(defaults.n), 1);
    const [audit] = await admin.execute("SELECT target_id, request_id FROM customer_audit_logs WHERE customer_id = ? AND action = 'customer.address.update' ORDER BY target_id", [customerId]);
    assert.deepEqual(audit.map((row) => Number(row.target_id)), winners);
    assert.equal(new Set(audit.map((row) => row.request_id)).size, 2);
    const expectedAudit = results.flatMap((result, index) => result.status === "fulfilled" ? [[result.value.id, `race-${suffix}-${index}`]] : []).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(audit.map((row) => [Number(row.target_id), row.request_id]), expectedAudit);
    const [[afterAudit]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
    assert.equal(Number(afterAudit.n), Number(beforeAudit.n) + 2);
  });

  await t.test("LOCAL-083-DECISION: 100 approve/reject contenders produce exactly one audited transition", async () => {
    assert.ok(customerId, "positive fixture must exist before decision contention");
    const [approver] = await admin.execute("INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)", [`approver-${suffix}`, await hashPassword(password), now, now]);
    approverId = Number(approver.insertId);
    await admin.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [approverId, roleId]);
    const before = await service.get({ ...actor, id: customerId });
    // Decision contention uses the existing integration runtime, not the narrower TC-081 fixture role.
    approvalDb = new MySqlDatabaseService({ pool: createMySqlDatabasePool(config), config, context });
    await approvalDb.initialize();
    const approvalCustomers = new CustomerService({ database: approvalDb, time });
    await approvalCustomers.update({ ...input, id: customerId, version: before.version, idempotencyKey: `currency-${suffix}`, defaultCurrencyCode: "HKD", reason: "local approval fixture" });
    const approvals = new CustomerApprovalService({ database: approvalDb, time });
    // Use the transaction helper's policy snapshot input; never toggle the shared settings singleton.
    const request = await approvalDb.withTransaction((connection) => approvals.submitInTransaction(connection, { ...actor, customerId, approverUserId: approverId, requestNote: "local decision contention" }, { setting: { require_activation_approval: 1, version: 1 } }));
    const pending = await service.get({ ...actor, id: customerId });
    const [[beforeAudit]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
    const start = Promise.withResolvers();
    const commands = Array.from({ length: 100 }, (_, index) => start.promise.then(() => approvals[index % 2 === 0 ? "approve" : "reject"]({ ...actor, actorId: approverId, id: request.id, version: 1, reason: "local conflicting decision", idempotencyKey: `decision-${suffix}-${index}`, requestId: `decision-${suffix}-${index}` })));
    start.resolve();
    const results = await Promise.allSettled(commands);
    const fulfilled = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 50);
    assert.equal(rejected.length, 50);
    assert.ok(rejected.every((result) => result.reason.code === "APPROVAL_REQUEST_NOT_OPEN"), "opposite decisions must conflict, not fail on DB/permissions/timeouts");
    const transitions = fulfilled.filter((result) => !result.replayed);
    assert.equal(transitions.length, 1);
    assert.ok(fulfilled.every((result) => result.status === transitions[0].status && result.version === 2));
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled" && !result.value.replayed);
    const [[terminal]] = await admin.execute("SELECT status, version, decided_by FROM customer_activation_requests WHERE id = ?", [request.id]);
    assert.equal(terminal.status, winnerIndex % 2 === 0 ? "approved" : "rejected");
    assert.equal(Number(terminal.version), 2);
    assert.equal(Number(terminal.decided_by), approverId);
    const after = await service.get({ ...actor, id: customerId });
    assert.equal(after.status, terminal.status === "approved" ? "active" : "draft");
    assert.equal(after.version, pending.version + 1);
    const [decisions] = await admin.execute("SELECT action, request_id FROM customer_audit_logs WHERE customer_id = ? AND action IN ('approval.approve', 'approval.reject', 'customer.activate', 'customer.status') ORDER BY id", [customerId]);
    assert.deepEqual(decisions.map((row) => [row.action, row.request_id]), [[terminal.status === "approved" ? "approval.approve" : "approval.reject", `decision-${suffix}-${winnerIndex}`], [terminal.status === "approved" ? "customer.activate" : "customer.status", `decision-${suffix}-${winnerIndex}`]]);
    const [[afterAudit]] = await admin.execute("SELECT COUNT(*) AS n FROM customer_audit_logs WHERE customer_id = ?", [customerId]);
    assert.equal(Number(afterAudit.n), Number(beforeAudit.n) + 2);
    const [operations] = await admin.execute("SELECT status, COUNT(*) AS n FROM customer_operation_requests WHERE actor_user_id = ? GROUP BY status", [approverId]);
    assert.deepEqual(operations.map((row) => [row.status, Number(row.n)]), [["succeeded", 50]]);
  });

  await t.test("LOCAL-081-SESSION: revoking the owned SQL account also closes its verified live sessions", async (sessionTest) => {
    const connection = await pool.getConnection();
    sessionTest.after(() => connection.destroy());
    assert.equal((await connection.query("SELECT id FROM customers WHERE id=?", [customerId]))[0].length, 1);
    const [[held]] = await connection.query("SELECT CONNECTION_ID() AS id");
    const [sessions] = await admin.execute("SELECT ID AS id, USER AS user, DB AS db FROM information_schema.PROCESSLIST WHERE USER=?", [sqlUser]);
    assert.ok(sessions.some(session => Number(session.id) === Number(held.id)));
    assert.ok(sessions.every(session => session.user === sqlUser && session.db === config.database), "never kill an unowned session");
    const disconnected = new Promise(resolve => { connection.once("error", resolve); });
    await admin.query("DROP USER ?@'%'", [sqlUser]);
    for (const session of sessions) await admin.query("KILL CONNECTION ?", [Number(session.id)]);
    assert.equal((await disconnected).code, "PROTOCOL_CONNECTION_LOST");
    await assert.rejects(() => connection.query("SELECT 1"), /closed state/u);
    await db.shutdown(); db = null;
    const denied = createMySqlDatabasePool(runtimeConfig);
    try {
      await assert.rejects(() => denied.query("SELECT 1"), error => error.errno === 1045 && error.sqlState === "28000");
    } finally { await denied.end(); }
    const [[remaining]] = await admin.execute("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER=?", [sqlUser]);
    assert.equal(Number(remaining.n), 0);
    const [[users]] = await admin.execute("SELECT COUNT(*) AS n FROM mysql.user WHERE User=? AND Host='%'", [sqlUser]);
    assert.equal(Number(users.n), 0);
  });
});
