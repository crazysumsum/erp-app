import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import databaseConfig from "../../config/database.js";
import { normalizeDatabaseConfig } from "../../src/framework/configuration/normalizeDatabaseConfig.js";
import { CustomerPartyService } from "../../src/modules/customer/CustomerPartyService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { RequestContextService } from "../../src/services/context/RequestContextService.js";
import { createMySqlDatabasePool } from "../../src/services/mysqldatabase/connection.js";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("TC-081 / local TC-083 real Customer least privilege and default contention", { timeout: 60_000 }, async (t) => {
  assert.ok(process.env.DB_ADMIN_USER, "DB_ADMIN_USER must identify the isolated fixture administrator");
  assert.notEqual(process.env.DB_ADMIN_PASSWORD, undefined, "DB_ADMIN_PASSWORD must be explicitly configured");
  const config = normalizeDatabaseConfig(databaseConfig);
  const admin = createMySqlDatabasePool({ ...config, user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const sqlUser = `cm_guard_${suffix}`;
  const canary = `cm_guard_${suffix}`;
  const deniedCanary = `${canary}_denied`;
  const roleName = `customer-guard-${suffix}`;
  const permissions = ["customer.mgmt", "customer.view"];
  let db = null;
  let actorId = null;
  let roleId = null;
  let customerId;

  t.after(async () => {
    try {
      await db?.shutdown();
      if (actorId) {
        await admin.execute("DELETE FROM customer_audit_logs WHERE actor_user_id = ?", [actorId]);
        await admin.execute("DELETE FROM customer_operation_requests WHERE actor_user_id = ?", [actorId]);
        await admin.execute("DELETE FROM customers WHERE created_by = ?", [actorId]);
        await admin.execute("DELETE FROM users WHERE id = ?", [actorId]);
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
    "customer_identifiers", "customer_credit_profiles"
  ];
  const expectedPrivileges = readTables.map((table) => `${config.database}.${table}:SELECT:NO`);
  for (const table of readTables) {
    await admin.query("GRANT SELECT ON ??.?? TO ?@'%'", [config.database, table, sqlUser]);
  }
  for (const table of ["customers", "customer_operation_requests", "customer_addresses"]) {
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
  const [seededPermissions] = await admin.execute("SELECT id FROM permissions WHERE name IN (?, ?)", permissions);
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
});
