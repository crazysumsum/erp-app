import assert from "node:assert/strict";
import test from "node:test";

import { SupplierContactService } from "../src/modules/supplier/SupplierContactService.js";

function contactRow(overrides = {}) {
  return {
    id: 21, supplier_id: 7, name: "Amy Chan", job_title: "Buyer", department: "Purchasing",
    email: "amy@example.com", phone: "+852 2123 4567", mobile: "", preferred_language: "zh-HK",
    notes: "", status: "active", version: 1, created_at: 100, updated_at: 100, ...overrides
  };
}

function harness({ contact = contactRow() } = {}) {
  const events = [];
  let current = contact;
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM suppliers") && sql.includes("FOR UPDATE")) return [[{ id: 7, supplier_code: "SUP-007" }]];
      if (sql.includes("FROM supplier_contacts") && sql.includes("FOR UPDATE")) return [[current].filter(Boolean)];
      if (sql.includes("FROM supplier_contacts") && sql.includes("WHERE c.id")) return [[current].filter(Boolean)];
      if (sql.includes("FROM supplier_contact_purposes")) return [[{ purpose_code: "orders", is_primary: 1 }]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO supplier_contacts")) {
        current = {
          ...current,
          name: params[1],
          job_title: params[2],
          department: params[3],
          email: params[4],
          phone: params[5],
          mobile: params[6],
          preferred_language: params[7],
          notes: params[8]
        };
        return [{ insertId: 21, affectedRows: 1 }];
      }
      if (sql.includes("UPDATE supplier_contacts")) {
        current = {
          ...current,
          status: sql.includes("status = 'inactive'") ? "inactive" : current.status,
          version: current.version + 1,
          updated_at: 200
        };
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new SupplierContactService({
    database: { async withTransaction(work) { return work(connection); }, query: (...args) => connection.query(...args) },
    logger: { warn() {} }, time: { nowMs: () => 200 },
    authorize: async () => events.push(["authorize"]),
    audit: { async record() { events.push(["audit"]); } }
  });
  return { service, events };
}

const actor = { actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], requestId: "req-1" };

test("create normalizes contact fields, switches the requested primary and audits atomically", async () => {
  const { service, events } = harness();
  const result = await service.create({
    ...actor, supplierId: 7, name: " Amy Chan ", jobTitle: "Buyer", department: "Purchasing",
    email: " Amy@Example.COM ", phone: "+852 2123 4567", preferredLanguage: "zh-HK",
    purposes: [{ purposeCode: "orders", isPrimary: true }]
  });
  assert.equal(result.name, "Amy Chan");
  assert.equal(result.email, "Amy@Example.COM");
  assert.deepEqual(result.purposes, [{ purposeCode: "orders", isPrimary: true }]);
  assert.ok(events.some(([, sql]) => sql?.includes("SET is_primary = 0")));
  assert.ok(events.some(([, sql]) => sql?.includes("INSERT INTO supplier_contact_purposes")));
  assert.equal(events.at(-1)[0], "audit");
});

test("create rejects malformed optional email and phone values", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.create({ ...actor, supplierId: 7, name: "Amy", email: "not-an-email", purposes: [] }),
    (error) => error.publicCode === "EMAIL_INVALID"
  );
  await assert.rejects(
    () => service.create({ ...actor, supplierId: 7, name: "Amy", phone: "call me", purposes: [] }),
    (error) => error.publicCode === "PHONE_INVALID"
  );
});

test("update rejects a child id that does not belong to the route Supplier", async () => {
  const { service } = harness({ contact: null });
  await assert.rejects(
    () => service.update({ ...actor, supplierId: 8, contactId: 21, version: 1, name: "Amy", purposes: [] }),
    (error) => error.statusCode === 404 && error.publicCode === "SUPPLIER_CONTACT_NOT_FOUND"
  );
});

test("deactivate clears primary flags and preserves purpose mappings", async () => {
  const { service, events } = harness();
  const result = await service.deactivate({ ...actor, supplierId: 7, contactId: 21, version: 1 });
  assert.equal(result.status, "inactive");
  assert.ok(events.some(([, sql]) => sql?.includes("SET is_primary = 0") && sql?.includes("contact_id = ?")));
  assert.equal(events.some(([, sql]) => sql?.includes("DELETE FROM supplier_contact_purposes")), false);
});
