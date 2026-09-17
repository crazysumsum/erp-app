import assert from "node:assert/strict";
import test from "node:test";

import { SupplierApprovalService } from "../src/modules/supplier/SupplierApprovalService.js";
import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function harness({ approvalRequired = false, duplicateRows = [], approverEligible = true } = {}) {
  const events = [];
  const connection = {
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("INSERT INTO suppliers")) return [{ insertId: 7 }];
      return [{ affectedRows: 1 }];
    },
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM users") && sql.includes("status = 'active'")) {
        return [approverEligible ? [{ id: params[0], username: "approver" }] : []];
      }
      return [[]];
    }
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
    approvals: new SupplierApprovalService({
      database, logger: { warn() {} }, time: { nowMs: () => 100 },
      audit: { async record(_c, entry) { events.push(["audit", entry]); } },
      loadPermissions: async () => (approverEligible ? ["supplier.approval"] : [])
    }),
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

test("creating with activate under approval ON lands in pending_approval, not active", async () => {
  // Replaces TASK-025's placeholder refusal. Design 4.4: the setting decides
  // draft -> active or draft -> pending_approval at submission time.
  const { service, events } = harness({ approvalRequired: true });
  await service.createSupplier({ ...input, approverUserId: 2 });
  const insert = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("INSERT INTO suppliers"));
  assert.ok(insert[2].includes("pending_approval"), "approval ON must not create an active Supplier");
});

function updateHarness({ version = 2, references = 0, duplicateError = false } = {}) {
  const events = [];
  const current = {
    id: 7, supplier_code: "SUP-7", supplier_code_key: "sup-7", supplier_name: "Old Name",
    supplier_name_key: "old name", display_name: "Old", default_currency_code: "HKD",
    default_payment_term_id: null, website: "", general_phone: "", general_email: "",
    notes: "", status: "draft", version, created_at: 50, updated_at: 90
  };
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("SELECT * FROM suppliers") && sql.includes("FOR UPDATE")) return [[current]];
      if (sql.includes("SELECT id FROM suppliers")) return [[]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (duplicateError && sql.includes("UPDATE suppliers")) {
        const error = new Error("duplicate");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      return [{ affectedRows: 1 }];
    }
  };
  const database = {
    async withTransaction(work) {
      events.push(["transaction", "begin"]);
      const result = await work(connection);
      events.push(["transaction", "commit"]);
      return result;
    },
    async query(sql) {
      events.push(["outer-query", sql]);
      if (sql.includes("SELECT * FROM suppliers")) {
        return [[{ ...current, supplier_code: "SUP-NEW", supplier_name: "New Name", display_name: "New", version: version + 1, updated_at: 100 }]];
      }
      return [[]];
    }
  };
  const service = new SupplierAdminService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    authorize: async () => { events.push(["authorize"]); return { id: 1, username: "sam" }; },
    businessMaster: {
      async assertSupplierDefaultsInTransaction(_connection, value) {
        events.push(["business-master", value]);
        return {
          currency: { code: value.currencyCode, status: "ACTIVE" },
          paymentTerm: value.paymentTermId ? { id: value.paymentTermId } : null
        };
      }
    },
    duplicates: { async find() { events.push(["duplicates"]); return []; } },
    replaceNameGrams: async () => events.push(["grams"]),
    audit: { async record(_connection, value) { events.push(["audit", value]); } },
    references: { async describeReferences() { events.push(["references"]); return { references: { purchaseOrders: references }, total: references }; } }
  });
  return { service, events };
}

const updateInput = {
  actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], id: 7,
  supplierName: " New Name ", displayName: "New", defaultCurrencyCode: "HKD",
  defaultCurrencyVersion: 1, defaultPaymentTermId: null, website: "", generalPhone: "",
  generalEmail: "", notes: "", version: 2, requestId: "req-update", ip: "127.0.0.1"
};

test("update Supplier locks and revalidates actor/catalog, replaces name grams and writes audit in one transaction", async () => {
  const { service, events } = updateHarness();
  const result = await service.updateSupplier(updateInput);
  assert.equal(result.supplierName, "New Name");
  assert.equal(result.version, 3);
  assert.deepEqual(events.filter(([name]) => ["authorize", "business-master", "duplicates", "grams", "audit"].includes(name)).map(([name]) => name), [
    "authorize", "business-master", "duplicates", "grams", "audit", "authorize"
  ]);
  assert.match(events.find(([name, sql]) => name === "execute" && sql.includes("UPDATE suppliers"))[1], /version = version \+ 1/u);
});

test("update Supplier rejects stale version before catalog, data or audit writes", async () => {
  const { service, events } = updateHarness({ version: 3 });
  await assert.rejects(() => service.updateSupplier(updateInput), (error) => error.publicCode === "VERSION_CONFLICT");
  assert.equal(events.some(([name]) => name === "business-master" || name === "execute" || name === "audit"), false);
});

test("changing default currency requires a bounded reason", async () => {
  const { service, events } = updateHarness();
  await assert.rejects(
    () => service.updateSupplier({ ...updateInput, defaultCurrencyCode: "USD" }),
    (error) => error.publicCode === "SUPPLIER_REASON_REQUIRED"
  );
  assert.equal(events.some(([name]) => name === "execute" || name === "audit"), false);
});

test("change Supplier Code requires an unreferenced Supplier and writes a reasoned audit", async () => {
  const blocked = updateHarness({ references: 1 });
  await assert.rejects(
    () => blocked.service.changeSupplierCode({ ...updateInput, supplierCode: "SUP-NEW", reason: "Correct legacy code" }),
    (error) => error.publicCode === "SUPPLIER_REFERENCED"
  );
  assert.equal(blocked.events.some(([name]) => name === "execute" || name === "audit"), false);

  const allowed = updateHarness();
  const result = await allowed.service.changeSupplierCode({ ...updateInput, supplierCode: " SUP-NEW ", reason: "Correct legacy code" });
  assert.equal(result.supplierCode, "SUP-NEW");
  const audit = allowed.events.find(([name]) => name === "audit")[1];
  assert.equal(audit.action, "supplier.code.change");
  assert.equal(audit.reason, "Correct legacy code");
  assert.deepEqual(audit.detail, { before: { supplierCode: "SUP-7" }, after: { supplierCode: "SUP-NEW" } });
});

test("change Supplier Code maps the database uniqueness race without disclosing another Supplier", async () => {
  const { service } = updateHarness({ duplicateError: true });
  await assert.rejects(
    () => service.changeSupplierCode({ ...updateInput, supplierCode: "SUP-NEW", reason: "Correct legacy code" }),
    (error) => error.publicCode === "SUPPLIER_CODE_TAKEN" && error.details.supplierCode === "SUP-NEW"
  );
});
