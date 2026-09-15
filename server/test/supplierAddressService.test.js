import assert from "node:assert/strict";
import test from "node:test";

import { SupplierAddressService } from "../src/modules/supplier/SupplierAddressService.js";

function addressRow(overrides = {}) {
  return {
    id: 12, supplier_id: 7, label: "總部", address_line1: "1 Main Street", address_line2: "", address_line3: "",
    city: "Hong Kong", state_region: "", postal_code: "", country_code: "HK", phone: "", notes: "",
    status: "active", version: 1, created_at: 100, updated_at: 100, ...overrides
  };
}

function harness({ address = addressRow() } = {}) {
  const events = [];
  let current = address;
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM suppliers") && sql.includes("FOR UPDATE")) return [[{ id: 7, supplier_code: "SUP-007" }]];
      if (sql.includes("FROM supplier_addresses") && sql.includes("FOR UPDATE")) return [[current].filter(Boolean)];
      if (sql.includes("FROM supplier_addresses") && sql.includes("WHERE a.id")) return [[current].filter(Boolean)];
      if (sql.includes("FROM supplier_address_purposes")) return [[{ purpose_code: "ordering", is_primary: 1 }]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO supplier_addresses")) return [{ insertId: 12, affectedRows: 1 }];
      if (sql.includes("UPDATE supplier_addresses")) current = { ...current, status: sql.includes("status = 'inactive'") ? "inactive" : current.status, version: current.version + 1, updated_at: 200 };
      return [{ affectedRows: 1 }];
    }
  };
  const service = new SupplierAddressService({
    database: { async withTransaction(work) { return work(connection); }, query: (...args) => connection.query(...args) },
    logger: { warn() {} }, time: { nowMs: () => 200 },
    authorize: async () => events.push(["authorize"]),
    audit: { async record() { events.push(["audit"]); } }
  });
  return { service, events };
}

const actor = { actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], requestId: "req-1" };

test("create switches each requested primary and writes address, purposes and audit in one transaction", async () => {
  const { service, events } = harness();
  const result = await service.create({
    ...actor, supplierId: 7, label: "總部", addressLine1: "1 Main Street", countryCode: "hk",
    purposes: [{ purposeCode: "ordering", isPrimary: true }]
  });
  assert.equal(result.countryCode, "HK");
  assert.ok(events.some(([, sql]) => sql?.includes("SET is_primary = 0")));
  assert.ok(events.some(([, sql]) => sql?.includes("INSERT INTO supplier_address_purposes")));
  assert.equal(events.at(-1)[0], "audit");
});

test("update rejects a child id that does not belong to the route Supplier", async () => {
  const { service } = harness({ address: null });
  await assert.rejects(
    () => service.update({ ...actor, supplierId: 8, addressId: 12, version: 1, label: "Other", purposes: [] }),
    (error) => error.statusCode === 404 && error.publicCode === "SUPPLIER_ADDRESS_NOT_FOUND"
  );
});

test("deactivate clears primary flags and preserves purpose mappings", async () => {
  const { service, events } = harness();
  const result = await service.deactivate({ ...actor, supplierId: 7, addressId: 12, version: 1 });
  assert.equal(result.status, "inactive");
  assert.ok(events.some(([, sql]) => sql?.includes("SET is_primary = 0") && sql?.includes("address_id = ?")));
  assert.equal(events.some(([, sql]) => sql?.includes("DELETE FROM supplier_address_purposes")), false);
});
