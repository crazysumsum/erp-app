import assert from "node:assert/strict";
import test from "node:test";

import { CustomerPartyService } from "../src/modules/customer/CustomerPartyService.js";

function service(connection, audits = []) {
  return new CustomerPartyService({
    database: { withTransaction: (work) => work(connection) },
    time: { nowMs: () => 1_757_808_000_000 },
    actorVerifier: async () => ({ username: "sam" }),
    audit: { record: async (_connection, input) => audits.push(input) }
  });
}

test("TC-006/021 identifier create applies approved type separators and keeps sensitive values out of audit detail", async () => {
  const calls = [];
  const audits = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      return [[]];
    },
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ insertId: 7, affectedRows: 1 }];
    }
  };
  const result = await service(connection, audits).createIdentifier({
    customerId: 4, actorId: 2, identifierType: "tax", issuerCountryCode: "HK",
    identifierValue: " hk 123-45 ", validFrom: 100, expiresAt: 200,
    notes: "private-note", claimedRoles: [], claimedPermissions: []
  });
  assert.deepEqual(result, {
    id: 7, customerId: 4, identifierType: "tax", issuerCountryCode: "HK",
    identifierValue: "hk 123-45", validFrom: 100, expiresAt: 200,
    notes: "private-note", status: "active", version: 1
  });
  const insert = calls.find((call) => /INSERT INTO customer_identifiers/.test(call.sql));
  assert.equal(insert.params[4], "HK12345");
  assert.equal(audits[0].action, "customer.identifier.create");
  assert.equal(audits[0].detail.after.identifierValue, undefined);
  assert.equal(audits[0].detail.after.notes, undefined);
});

test("TC-021 identifier update scopes owner, uses CAS and maps the database race to a generic conflict", async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_identifiers")) return [[{ id: 7, customer_id: 4, identifier_type: "tax", issuer_country_code: "HK", identifier_value: "OLD", valid_from: null, expires_at: null, notes: "", status: "active", version: 2 }]];
      return [[]];
    },
    async execute(sql) {
      if (/UPDATE customer_identifiers/.test(String(sql))) {
        const error = new Error("Duplicate entry for key 'uq_customer_identifiers_global'");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      return [{ affectedRows: 1 }];
    }
  };
  await assert.rejects(
    () => service(connection).updateIdentifier({ customerId: 4, identifierId: 7, actorId: 2, version: 2, reason: "replace id", identifierType: "tax", issuerCountryCode: "HK", identifierValue: "TAKEN", validFrom: null, expiresAt: null, notes: "" }),
    (error) => error.code === "IDENTIFIER_TAKEN" && error.statusCode === 409 && !JSON.stringify(error).includes("CUS-")
  );
});

test("TC-018/021 identifier update returns not found for a child owned by another Customer", async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_identifiers")) return [[]];
      return [[]];
    },
    async execute() { throw new Error("must not write"); }
  };
  await assert.rejects(
    () => service(connection).updateIdentifier({ customerId: 4, identifierId: 99, actorId: 2, version: 1, reason: "replace id", identifierType: "other", issuerCountryCode: "HK", identifierValue: "A", validFrom: null, expiresAt: null, notes: "" }),
    (error) => error.code === "CUSTOMER_PARTY_NOT_FOUND" && error.statusCode === 404
  );
});

test("TC-021 identifier update succeeds with owner CAS and redacted before/after audit", async () => {
  const calls = [];
  const audits = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4, customer_code: "CUS-004" }]];
      if (String(sql).includes("FROM customer_identifiers")) return [[{ id: 7, customer_id: 4, identifier_type: "other", issuer_country_code: "HK", identifier_value: "OLD", valid_from: null, expires_at: null, notes: "old-private", status: "active", version: 2 }]];
      return [[]];
    },
    async execute(sql, params) { calls.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; }
  };
  const updated = await service(connection, audits).updateIdentifier({ customerId: 4, identifierId: 7, actorId: 2, version: 2, reason: "replace identifier", identifierType: "tax", issuerCountryCode: "HK", identifierValue: "NEW-12 34", validFrom: 100, expiresAt: 200, notes: "new-private" });
  assert.equal(updated.version, 3);
  assert.equal(updated.identifierValue, "NEW-12 34");
  const write = calls.find((call) => /UPDATE customer_identifiers/.test(call.sql));
  assert.match(write.sql, /WHERE id = \? AND customer_id = \? AND version = \?/);
  assert.equal(audits[0].detail.before.identifierValue, undefined);
  assert.equal(audits[0].detail.after.identifierValue, undefined);
});

test("TC-021 identifier validation rejects unknown types and invalid expiry before a transaction", async () => {
  const customerParty = new CustomerPartyService({ database: { withTransaction() { throw new Error("must not transact"); } }, time: { nowMs: () => 1 } });
  await assert.rejects(() => customerParty.createIdentifier({ identifierType: "passport", issuerCountryCode: "HK", identifierValue: "A" }), /identifierType/);
  await assert.rejects(() => customerParty.createIdentifier({ identifierType: "other", issuerCountryCode: "HK", identifierValue: "A", validFrom: 200, expiresAt: 100 }), /expiresAt/);
  await assert.rejects(() => customerParty.updateIdentifier({ identifierType: "other", issuerCountryCode: "HK", identifierValue: "A", validFrom: null, expiresAt: null, notes: "", reason: "" }), /reason/);
});
