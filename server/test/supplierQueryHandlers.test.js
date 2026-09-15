import assert from "node:assert/strict";
import test from "node:test";

import {
  CheckSupplierDuplicatesHandler,
  GetSupplierCompletenessHandler,
  GetSupplierHandler,
  ListSuppliersHandler
} from "../src/handlers/suppliers/supplierQueryHandlers.js";
import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function row(overrides = {}) {
  return {
    id: 7,
    supplier_code: "SUP-007",
    supplier_name: "Evergreen Trading",
    display_name: "Evergreen",
    default_currency_code: "HKD",
    default_payment_term_id: null,
    website: "",
    general_phone: "2123 4567",
    general_email: "orders@example.test",
    notes: "",
    status: "active",
    version: 2,
    created_at: 100,
    updated_at: 200,
    ...overrides
  };
}

function harness({ rows = [row()], duplicateRows = [] } = {}) {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push([sql, params]);
      if (sql.includes("COUNT(*) AS total")) return [[{ total: rows.length }]];
      if (sql.includes("FROM suppliers") && sql.includes("WHERE id = ?")) return [[rows[0]].filter(Boolean)];
      return [rows];
    },
    async withTransaction(work) { return work(this); }
  };
  const events = [];
  const service = new SupplierAdminService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 300 },
    authorize: async () => { events.push("authorize"); return { id: 1, username: "sam" }; },
    businessMaster: {},
    duplicates: { async find(_connection, input) { events.push(["duplicates", input]); return duplicateRows; } }
  });
  return { service, queries, events };
}

test("list applies bounded paging, escaped search, allowlisted stable sort and excludes archived by default", async () => {
  const { service, queries, events } = harness();
  const result = await service.listSuppliers({
    actorId: 1,
    claimedRoles: [],
    claimedPermissions: ["supplier.view"],
    page: 2,
    pageSize: 20,
    q: "SUP%_",
    sortBy: "supplierName",
    descending: false
  });

  assert.equal(events[0], "authorize");
  assert.deepEqual(result, {
    items: [{
      id: 7,
      supplierCode: "SUP-007",
      supplierName: "Evergreen Trading",
      displayName: "Evergreen",
      defaultCurrencyCode: "HKD",
      defaultPaymentTermId: null,
      status: "active",
      version: 2,
      updatedAt: 200
    }],
    total: 1,
    page: 2,
    pageSize: 20
  });
  assert.match(queries[0][0], /status != 'archived'/u);
  assert.ok(queries[0][1].some((value) => typeof value === "string" && value.includes("\\%\\_")));
  assert.match(queries[1][0], /ORDER BY CASE WHEN s\.supplier_code_key = \? THEN 0 ELSE 1 END, s\.supplier_name ASC, s\.id ASC/u);
  assert.deepEqual(queries[1][1].slice(-2), [20, 20]);
});

test("detail and completeness return projected fields without internal keys or bank plaintext", async () => {
  const { service } = harness();
  const detail = await service.getSupplier({ actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.view"], id: 7 });
  assert.equal(detail.supplierCode, "SUP-007");
  assert.deepEqual(detail.addresses, []);
  assert.deepEqual(detail.bankAccounts, []);
  assert.equal("supplier_code_key" in detail, false);

  const completeness = await service.getSupplierCompleteness({
    actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.view"], id: 7
  });
  assert.deepEqual(completeness.issues, []);
  assert.ok(completeness.warnings.some((warning) => warning.code === "PAYMENT_TERM_MISSING"));
});

test("duplicate check reports a hard Code conflict separately from warning-only name candidates", async () => {
  const candidate = { supplierId: 3, supplierCode: "SUP-003", supplierName: "Evergreen Trade", score: 0.9, exact: false, warningOnly: true };
  const { service } = harness({ duplicateRows: [candidate] });
  const result = await service.findSupplierDuplicateCandidates({
    actorId: 1,
    claimedRoles: [],
    claimedPermissions: ["supplier.mgmt"],
    supplierCode: "SUP-007",
    supplierName: "Evergreen Trading"
  });
  assert.deepEqual(result.codeConflict, { supplierId: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading" });
  assert.deepEqual(result.duplicateCandidates, [candidate]);
});

test("query handlers expose distinct view/mgmt policies and bounded schemas", () => {
  assert.equal(ListSuppliersHandler.api.path, "/api/v1/suppliers");
  assert.equal(ListSuppliersHandler.api.requestSchema.query.properties.pageSize.maximum, 100);
  assert.deepEqual(ListSuppliersHandler.api.authorizationPolicies[0].options.permissions, ["supplier.view"]);
  assert.equal(GetSupplierHandler.api.path, "/api/v1/suppliers/:id");
  assert.equal(GetSupplierCompletenessHandler.api.path, "/api/v1/suppliers/:id/completeness");
  assert.deepEqual(CheckSupplierDuplicatesHandler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
});
