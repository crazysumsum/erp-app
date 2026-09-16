import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { SupplierAddressService } from "../../src/modules/supplier/SupplierAddressService.js";
import { SupplierContactService } from "../../src/modules/supplier/SupplierContactService.js";
import { SupplierIdentifierService } from "../../src/modules/supplier/SupplierIdentifierService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

function database(pool) {
  return {
    query: (...args) => pool.query(...args),
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

async function seedActor(pool) {
  const username = `supplier-party-it-${randomUUID()}`;
  const now = Date.now();
  const [result] = await pool.execute(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [username, "not-used-by-this-test", "Supplier Party Integration Actor", now, now]
  );
  return { id: Number(result.insertId), username };
}

async function cleanupActor(pool, actorId) {
  if (actorId === null) return;
  await pool.query("DELETE FROM supplier_audit_logs WHERE actor_user_id = ?", [actorId]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ?", [actorId]);
  await pool.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(actorId)]);
  await pool.query("DELETE FROM users WHERE id = ?", [actorId]);
}

integrationTest("Address ownership, primary switching, concurrency and deactivation are enforced by service and MySQL", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 6 });
  const suffix = String(Date.now());
  const supplierIds = [];
  let actorId = null;
  t.after(async () => {
    if (supplierIds.length) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
    }
    await cleanupActor(pool, actorId);
    await pool.end();
  });

  const actor = await seedActor(pool);
  actorId = actor.id;
  const now = Date.now();
  for (const code of [`ADDR-${suffix}-A`, `ADDR-${suffix}-B`]) {
    const [result] = await pool.execute(
      `INSERT INTO suppliers
        (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
         status, version, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'HKD', 'active', 1, ?, ?, ?, ?)`,
      [code, code.toLowerCase(), code, code.toLowerCase(), now, now, actor.id, actor.id]
    );
    supplierIds.push(Number(result.insertId));
  }

  const service = new SupplierAddressService({
    database: database(pool), logger: { warn() {} }, time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: Number(actor.id), username: actor.username })
  });
  const base = { actorId: Number(actor.id), claimedRoles: [], claimedPermissions: [], supplierId: supplierIds[0], addressLine1: "1 Test Road", purposes: [{ purposeCode: "ordering", isPrimary: true }] };
  const first = await service.create({ ...base, label: "A" });
  const second = await service.create({ ...base, label: "B" });
  const [[primaryCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_address_purposes WHERE supplier_id = ? AND purpose_code = 'ordering' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(primaryCount.total), 1);

  await assert.rejects(
    () => service.update({ ...base, supplierId: supplierIds[1], addressId: first.id, version: first.version, label: "Wrong owner" }),
    (error) => error.publicCode === "SUPPLIER_ADDRESS_NOT_FOUND" && error.statusCode === 404
  );

  const deactivated = await service.deactivate({ ...base, addressId: second.id, version: second.version });
  assert.equal(deactivated.status, "inactive");
  const [[mapping]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(is_primary) AS primary_total FROM supplier_address_purposes WHERE address_id = ?",
    [second.id]
  );
  assert.equal(Number(mapping.total), 1);
  assert.equal(Number(mapping.primary_total), 0);

  const concurrent = await Promise.all([
    service.create({ ...base, label: "C" }),
    service.create({ ...base, label: "D" })
  ]);
  assert.equal(concurrent.length, 2);
  const [[afterConcurrent]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_address_purposes WHERE supplier_id = ? AND purpose_code = 'ordering' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(afterConcurrent.total), 1);
});

integrationTest("Contact ownership, primary switching, concurrency and deactivation are enforced by service and MySQL", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 6 });
  const suffix = String(Date.now());
  const supplierIds = [];
  let actorId = null;
  t.after(async () => {
    if (supplierIds.length) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
    }
    await cleanupActor(pool, actorId);
    await pool.end();
  });

  const actor = await seedActor(pool);
  actorId = actor.id;
  const now = Date.now();
  for (const code of [`CONT-${suffix}-A`, `CONT-${suffix}-B`]) {
    const [result] = await pool.execute(
      `INSERT INTO suppliers
        (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
         status, version, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'HKD', 'active', 1, ?, ?, ?, ?)`,
      [code, code.toLowerCase(), code, code.toLowerCase(), now, now, actor.id, actor.id]
    );
    supplierIds.push(Number(result.insertId));
  }

  const service = new SupplierContactService({
    database: database(pool), logger: { warn() {} }, time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: Number(actor.id), username: actor.username })
  });
  const base = {
    actorId: Number(actor.id), claimedRoles: [], claimedPermissions: [], supplierId: supplierIds[0],
    email: "buyer@example.com", purposes: [{ purposeCode: "orders", isPrimary: true }]
  };
  const first = await service.create({ ...base, name: "Buyer A" });
  const second = await service.create({ ...base, name: "Buyer B" });
  const [[primaryCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_contact_purposes WHERE supplier_id = ? AND purpose_code = 'orders' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(primaryCount.total), 1);

  await assert.rejects(
    () => service.update({ ...base, supplierId: supplierIds[1], contactId: first.id, version: first.version, name: "Wrong owner" }),
    (error) => error.publicCode === "SUPPLIER_CONTACT_NOT_FOUND" && error.statusCode === 404
  );

  const deactivated = await service.deactivate({ ...base, contactId: second.id, version: second.version });
  assert.equal(deactivated.status, "inactive");
  const [[mapping]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(is_primary) AS primary_total FROM supplier_contact_purposes WHERE contact_id = ?",
    [second.id]
  );
  assert.equal(Number(mapping.total), 1);
  assert.equal(Number(mapping.primary_total), 0);

  const concurrent = await Promise.all([
    service.create({ ...base, name: "Buyer C" }),
    service.create({ ...base, name: "Buyer D" })
  ]);
  assert.equal(concurrent.length, 2);
  const [[afterConcurrent]] = await pool.query(
    "SELECT COUNT(*) AS total FROM supplier_contact_purposes WHERE supplier_id = ? AND purpose_code = 'orders' AND is_primary = 1",
    [supplierIds[0]]
  );
  assert.equal(Number(afterConcurrent.total), 1);
});

integrationTest("Identifier normalization, global uniqueness, ownership and deletion are enforced by service and MySQL", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 6 });
  const suffix = String(Date.now());
  const supplierIds = [];
  let actorId = null;
  t.after(async () => {
    if (supplierIds.length) {
      await pool.query(`DELETE FROM supplier_audit_logs WHERE supplier_id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
      await pool.query(`DELETE FROM suppliers WHERE id IN (${supplierIds.map(() => "?").join(",")})`, supplierIds);
    }
    await cleanupActor(pool, actorId);
    await pool.end();
  });

  const actor = await seedActor(pool);
  actorId = actor.id;
  const now = Date.now();
  for (const code of [`IDENT-${suffix}-A`, `IDENT-${suffix}-B`]) {
    const [result] = await pool.execute(
      `INSERT INTO suppliers
        (supplier_code, supplier_code_key, supplier_name, supplier_name_key, default_currency_code,
         status, version, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'HKD', 'active', 1, ?, ?, ?, ?)`,
      [code, code.toLowerCase(), code, code.toLowerCase(), now, now, actor.id, actor.id]
    );
    supplierIds.push(Number(result.insertId));
  }

  const service = new SupplierIdentifierService({
    database: database(pool), logger: { warn() {} }, time: { nowMs: () => Date.now() },
    authorize: async () => ({ id: Number(actor.id), username: actor.username })
  });
  const base = {
    actorId: Number(actor.id), claimedRoles: [], claimedPermissions: [], identifierType: "business_registration",
    issuerCountryCode: "HK", notes: ""
  };
  const results = await Promise.allSettled([
    service.create({ ...base, supplierId: supplierIds[0], identifierValue: `${suffix}-AB 123` }),
    service.create({ ...base, supplierId: supplierIds[1], identifierValue: `${suffix}-ab-123` })
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.publicCode, "SUPPLIER_IDENTIFIER_TAKEN");
  const created = results.find((result) => result.status === "fulfilled").value;

  const otherCountry = await service.create({
    ...base, supplierId: supplierIds[1], issuerCountryCode: "SG", identifierValue: `${suffix}-AB-123`
  });
  assert.equal(otherCountry.issuerCountryCode, "SG");
  await assert.rejects(
    () => service.update({
      ...base, supplierId: created.supplierId === supplierIds[0] ? supplierIds[1] : supplierIds[0],
      identifierId: created.id, identifierValue: "wrong owner", version: created.version, reason: "test"
    }),
    (error) => error.publicCode === "SUPPLIER_IDENTIFIER_NOT_FOUND" && error.statusCode === 404
  );

  const deleted = await service.delete({
    ...base, supplierId: otherCountry.supplierId, identifierId: otherCountry.id, version: otherCountry.version, reason: "test cleanup"
  });
  assert.deepEqual(deleted, { id: otherCountry.id, deleted: true });
});
