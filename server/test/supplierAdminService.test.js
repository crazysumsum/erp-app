import assert from "node:assert/strict";
import test from "node:test";

import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function harness({ approvalRequired = false, duplicateRows = [] } = {}) {
  const events = [];
  const connection = {
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO suppliers")) return [{ insertId: 7 }];
      return [{ affectedRows: 1 }];
    },
    async query(sql, params) { events.push(["query", sql, params]); return [[]]; }
  };
  const database = {
    async withTransaction(work) { events.push(["transaction", "begin"]); const result = await work(connection); events.push(["transaction", "commit"]); return result; },
    async query() {
      return [[{
        id: 7, supplier_code: "SUP-7", supplier_name: "Demo Supplier", display_name: "",
        default_currency_code: "HKD", default_payment_term_id: null, website: "", general_phone: "",
        general_email: "", notes: "", status: "active", version: 1, created_at: 100, updated_at: 100
      }]];
    }
  };
  const service = new SupplierAdminService({
    database, logger: { warn() {} }, time: { nowMs: () => 100 },
    authorize: async () => { events.push(["authorize"]); return { id: 1, username: "sam" }; },
    businessMaster: {
      async assertSupplierDefaultsInTransaction(_connection, input) {
        events.push(["business-master", input]);
        return { currency: { code: input.currencyCode, status: "ACTIVE" }, paymentTerm: null };
      }
    },
    duplicates: { async find() { events.push(["duplicates"]); return duplicateRows; } },
    replaceNameGrams: async () => events.push(["grams"]),
    audit: { async record() { events.push(["audit"]); } },
    approvalRequired: async () => approvalRequired
  });
  return { service, events };
}

const input = {
  actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"],
  supplierCode: " SUP-7 ", supplierName: " Demo Supplier ", defaultCurrencyCode: "HKD",
  defaultCurrencyVersion: 1, defaultPaymentTermId: null, activate: true, requestId: "req-7", ip: "127.0.0.1"
};

test("create Supplier revalidates actor and Business Master inside one transaction and atomically writes root, grams and audit", async () => {
  const { service, events } = harness();
  const result = await service.createSupplier(input);
  assert.equal(result.status, "active");
  assert.deepEqual(events.filter(([name]) => ["authorize", "business-master", "duplicates", "grams", "audit"].includes(name)).map(([name]) => name), [
    "authorize", "business-master", "duplicates", "grams", "audit"
  ]);
  assert.equal(events.at(-1)[1], "commit");
});

test("duplicate names remain warnings and do not block creation", async () => {
  const warning = { supplierId: 2, score: 1, warningOnly: true };
  const { service } = harness({ duplicateRows: [warning] });
  assert.deepEqual((await service.createSupplier({ ...input, activate: false })).duplicateCandidates, [warning]);
});

test("approval-enabled activation fails explicitly until the approval capability is deployed", async () => {
  const { service } = harness({ approvalRequired: true });
  await assert.rejects(() => service.createSupplier(input), (error) => error.publicCode === "SUPPLIER_APPROVAL_NOT_READY");
});
