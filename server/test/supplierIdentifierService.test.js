import assert from "node:assert/strict";
import test from "node:test";

import { SupplierIdentifierService } from "../src/modules/supplier/SupplierIdentifierService.js";

function identifierRow(overrides = {}) {
  return {
    id: 31, supplier_id: 7, identifier_type: "business_registration", issuer_country_code: "HK",
    identifier_value: "AB-123", identifier_value_key: "AB123", notes: "", version: 1,
    created_at: 100, updated_at: 100, ...overrides
  };
}

function harness({ identifier = identifierRow(), referenceCount = 0, duplicateOnWrite = false } = {}) {
  const events = [];
  let current = identifier;
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM suppliers") && sql.includes("FOR UPDATE")) return [[{ id: 7, supplier_code: "SUP-007" }]];
      if (sql.includes("FROM supplier_identifiers") && sql.includes("FOR UPDATE")) return [[current].filter(Boolean)];
      if (sql.includes("FROM supplier_identifiers") && sql.includes("WHERE i.id")) return [[current].filter(Boolean)];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (duplicateOnWrite && (sql.includes("INSERT INTO supplier_identifiers") || sql.includes("UPDATE supplier_identifiers"))) {
        throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      }
      if (sql.includes("INSERT INTO supplier_identifiers")) {
        current = { ...current, identifier_type: params[1], issuer_country_code: params[2], identifier_value: params[3], identifier_value_key: params[4], notes: params[5] };
        return [{ insertId: 31, affectedRows: 1 }];
      }
      if (sql.includes("UPDATE supplier_identifiers")) {
        current = { ...current, identifier_type: params[0], issuer_country_code: params[1], identifier_value: params[2], identifier_value_key: params[3], notes: params[4], version: current.version + 1, updated_at: 200 };
      }
      if (sql.includes("DELETE FROM supplier_identifiers")) current = null;
      return [{ affectedRows: 1 }];
    }
  };
  const service = new SupplierIdentifierService({
    database: { async withTransaction(work) { return work(connection); }, query: (...args) => connection.query(...args) },
    logger: { warn() {} }, time: { nowMs: () => 200 }, authorize: async () => ({ username: "sam" }),
    audit: { async record(_connection, entry) { events.push(["audit", entry]); } },
    countReferences: async () => referenceCount
  });
  return { service, events };
}

const actor = { actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], requestId: "req-1" };

test("create normalizes identifier type, country and separator-insensitive key before auditing", async () => {
  const { service, events } = harness();
  const result = await service.create({
    ...actor, supplierId: 7, identifierType: "BUSINESS_REGISTRATION", issuerCountryCode: "hk",
    identifierValue: " AB-123 ", notes: "registry"
  });
  assert.equal(result.identifierType, "business_registration");
  assert.equal(result.issuerCountryCode, "HK");
  assert.equal(result.identifierValue, "AB-123");
  const insert = events.find(([, sql]) => sql?.includes("INSERT INTO supplier_identifiers"));
  assert.equal(insert[2][4], "AB123");
  assert.equal(events.at(-1)[0], "audit");
});

test("create and update map database races to a non-disclosing public conflict", async () => {
  const { service } = harness({ duplicateOnWrite: true });
  await assert.rejects(
    () => service.create({ ...actor, supplierId: 7, identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1" }),
    (error) => error.statusCode === 409 && error.publicCode === "SUPPLIER_IDENTIFIER_TAKEN" && !error.details?.supplierId
  );
  await assert.rejects(
    () => service.update({
      ...actor, supplierId: 7, identifierId: 31, version: 1, identifierType: "tax",
      issuerCountryCode: "HK", identifierValue: "T-2", reason: "correction"
    }),
    (error) => error.statusCode === 409 && error.publicCode === "SUPPLIER_IDENTIFIER_TAKEN" && !error.details?.supplierId
  );
});

test("create rejects oversized notes at the domain boundary", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.create({
      ...actor, supplierId: 7, identifierType: "tax", issuerCountryCode: "HK",
      identifierValue: "T-1", notes: "x".repeat(501)
    }),
    (error) => error.publicCode === "IDENTIFIER_INVALID" && error.details?.field === "notes"
  );
});

test("update requires reason and enforces child ownership and version", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.update({ ...actor, supplierId: 7, identifierId: 31, version: 1, identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1", reason: "" }),
    (error) => error.publicCode === "SUPPLIER_IDENTIFIER_REASON_REQUIRED"
  );
  const missing = harness({ identifier: null }).service;
  await assert.rejects(
    () => missing.update({ ...actor, supplierId: 8, identifierId: 31, version: 1, identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1", reason: "correct" }),
    (error) => error.statusCode === 404 && error.publicCode === "SUPPLIER_IDENTIFIER_NOT_FOUND"
  );
});

test("delete rejects referenced identifiers and audits an allowed versioned deletion", async () => {
  const blocked = harness({ referenceCount: 1 }).service;
  await assert.rejects(
    () => blocked.delete({ ...actor, supplierId: 7, identifierId: 31, version: 1, reason: "obsolete" }),
    (error) => error.statusCode === 409 && error.publicCode === "SUPPLIER_IDENTIFIER_REFERENCED"
  );

  const { service, events } = harness();
  const result = await service.delete({ ...actor, supplierId: 7, identifierId: 31, version: 1, reason: "entered in error" });
  assert.deepEqual(result, { id: 31, deleted: true });
  assert.ok(events.some(([, sql]) => sql?.includes("DELETE FROM supplier_identifiers")));
  assert.equal(events.at(-1)[0], "audit");
});
