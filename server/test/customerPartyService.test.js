import assert from "node:assert/strict";
import test from "node:test";
import { CustomerPartyService } from "../src/modules/customer/CustomerPartyService.js";

test("TC-018 locks the Customer then clears same-purpose defaults before inserting an address mapping", async () => {
  const calls = [];
  const connection = { async query() { return [[{ id: 4 }]]; }, async execute(sql, params) { calls.push({ sql: String(sql), params }); return [{ insertId: calls.length === 1 ? 7 : 0 }]; } };
  const service = new CustomerPartyService({ database: { withTransaction: (work) => work(connection) }, time: { nowMs: () => 1 }, actorVerifier: async () => ({ username: "sam" }), audit: { record: async () => {} } });
  const result = await service.create({ type: "address", customerId: 4, actorId: 2, claimedRoles: [], claimedPermissions: [], label: "HQ", addressLine1: "1 Main", purposes: [{ code: "shipping", isDefault: true }] });
  assert.equal(result.id, 7);
  assert.equal(result.version, 1);
  assert.ok(calls.some((call) => /UPDATE customer_address_purposes SET is_default = 0/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO customer_address_purposes/.test(call.sql)));
});

test("TC-019 update scopes the child by both customer and id, replaces purposes and uses CAS", async () => {
  const calls = [];
  const audits = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4 }]];
      if (String(sql).includes("FROM customer_addresses")) return [[{ id: 7, customer_id: 4, label: "HQ", address_line1: "1 Main", country_code: null, status: "active", version: 2 }]];
      if (String(sql).includes("FROM customer_address_purposes")) return [[{ purpose_code: "shipping", is_default: 1 }]];
      return [[]];
    },
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerPartyService({ database: { withTransaction: (work) => work(connection) }, time: { nowMs: () => 2 }, actorVerifier: async () => ({ username: "sam" }), audit: { record: async (_connection, input) => audits.push(input) } });
  const result = await service.update({ type: "address", customerId: 4, partyId: 7, actorId: 2, claimedRoles: [], claimedPermissions: [], version: 2, reason: "address changed", requestId: "request-7", ip: "127.0.0.1", label: "HQ", addressLine1: "2 Main", purposes: [{ code: "billing", isDefault: true }] });
  assert.equal(result.version, 3);
  assert.match(calls[0].sql, /WHERE id = \? AND customer_id = \? AND version = \?/);
  assert.ok(calls.some((call) => /DELETE FROM customer_address_purposes/.test(call.sql)));
  assert.equal(audits[0].requestId, "request-7");
  assert.equal(audits[0].ip, "127.0.0.1");
  assert.deepEqual(audits[0].detail.before.addressLine1, "1 Main");
  assert.equal(audits[0].detail.before.countryCode, null);
  assert.deepEqual(audits[0].detail.before.purposes, [{ code: "shipping", isDefault: true }]);
  assert.equal(audits[0].detail.after.countryCode, null);
});

test("TC-020 deactivate clears defaults and rejects a child owned by another Customer as not found", async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4 }]];
      if (String(sql).includes("FROM customer_contacts")) return [[]];
      return [[]];
    },
    async execute() { throw new Error("must not write"); }
  };
  const service = new CustomerPartyService({ database: { withTransaction: (work) => work(connection) }, time: { nowMs: () => 2 }, actorVerifier: async () => ({ username: "sam" }) });
  await assert.rejects(
    () => service.deactivate({ type: "contact", customerId: 4, partyId: 8, actorId: 2, claimedRoles: [], claimedPermissions: [], version: 1, reason: "left company" }),
    (error) => error.code === "CUSTOMER_PARTY_NOT_FOUND" && error.statusCode === 404
  );
});

test("TC-020 rejects duplicate and unknown purposes before opening a transaction", async () => {
  const service = new CustomerPartyService({ database: { withTransaction: () => { throw new Error("must not transact"); } }, time: { nowMs: () => 2 } });
  await assert.rejects(() => service.create({ type: "contact", customerId: 4, actorId: 2, name: "Sam", purposes: [{ code: "shipping", isDefault: false }, { code: "shipping", isDefault: true }] }), /purpose is invalid or duplicated/);
  await assert.rejects(() => service.create({ type: "address", customerId: 4, actorId: 2, label: "HQ", addressLine1: "1 Main", purposes: [{ code: "custom", isDefault: false }] }), /purpose is invalid or duplicated/);
});

test("TC-020 validates party field limits and formats before opening a transaction", async () => {
  const service = new CustomerPartyService({ database: { withTransaction: () => { throw new Error("must not transact"); } }, time: { nowMs: () => 2 } });
  await assert.rejects(() => service.create({ type: "address", customerId: 4, actorId: 2, label: "x".repeat(101), addressLine1: "1 Main", purposes: [] }), /label is invalid/);
  await assert.rejects(() => service.create({ type: "address", customerId: 4, actorId: 2, label: "HQ", addressLine1: "1 Main", countryCode: "hk", purposes: [] }), /countryCode is invalid/);
  await assert.rejects(() => service.create({ type: "contact", customerId: 4, actorId: 2, name: "Sam", email: "not-email", purposes: [] }), /email is invalid/);
  await assert.rejects(() => service.create({ type: "contact", customerId: 4, actorId: 2, name: "Sam", preferredLanguage: "not_a_language", purposes: [] }), /preferredLanguage is invalid/);
});

test("TC-020 rejects repeated deactivation without changing version or audit", async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM customers")) return [[{ id: 4 }]];
      if (String(sql).includes("FROM customer_contacts")) return [[{ id: 8, customer_id: 4, status: "inactive", version: 2 }]];
      return [[]];
    },
    async execute() { throw new Error("must not write"); }
  };
  const service = new CustomerPartyService({ database: { withTransaction: (work) => work(connection) }, time: { nowMs: () => 2 }, actorVerifier: async () => ({ username: "sam" }) });
  await assert.rejects(
    () => service.deactivate({ type: "contact", customerId: 4, partyId: 8, actorId: 2, version: 2, reason: "still inactive" }),
    (error) => error.code === "CUSTOMER_PARTY_INACTIVE"
  );
});
