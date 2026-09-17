import assert from "node:assert/strict";
import Ajv from "ajv";
import test from "node:test";

import { SUPPLIER_DETAIL_SCHEMA } from "../src/handlers/suppliers/supplierSchemas.js";
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
    async withTransaction(work) {
      events.push(["transaction", "begin"]);
      try {
        const result = await work(connection);
        events.push(["transaction", "commit"]);
        return result;
      } catch (error) {
        // 之前呢個 fake 唔會記 rollback，所以「失敗時冇留低嘢」係 assert 唔到嘅。
        events.push(["transaction", "rollback"]);
        throw error;
      }
    },
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
      loadPermissions: async () => (approverEligible ? ["supplier.approval"] : []),
  businessMaster: { async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; } },
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

function updateHarness({ version = 2, references = 0, duplicateError = false, status = "draft", openRequest = { id: 11, supplier_id: 7 } } = {}) {
  const events = [];
  const current = {
    id: 7, supplier_code: "SUP-7", supplier_code_key: "sup-7", supplier_name: "Old Name",
    supplier_name_key: "old name", display_name: "Old", default_currency_code: "HKD",
    default_payment_term_id: null, website: "", general_phone: "", general_email: "",
    notes: "", status, version, created_at: 50, updated_at: 90
  };
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("supplier_activation_requests")) return [openRequest ? [openRequest] : []];
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

test("AC-009: naming an ineligible approver refuses the create and leaves nothing behind", async () => {
  // The approverEligible scaffolding existed but no test used it, so the seam
  // between createSupplier and the approval domain was never exercised for refusal.
  const { service, events } = harness({ approvalRequired: true, approverEligible: false });
  await assert.rejects(
    () => service.createSupplier({ ...input, approverUserId: 2 }),
    (error) => error.publicCode === "APPROVER_NOT_ELIGIBLE"
  );
  assert.equal(events.at(-1)[1], "rollback", "a refused submission must not leave a Supplier behind");
});

test("naming an approver while the policy is OFF is refused rather than ignored", async () => {
  const { service } = harness({ approvalRequired: false });
  await assert.rejects(
    () => service.createSupplier({ ...input, approverUserId: 2 }),
    (error) => error.publicCode === "APPROVER_NOT_REQUIRED"
  );
});

// ---- REV-022 H-B: fixes that previously survived deletion with the suite green ----

test("a significant edit while pending invalidates the request and returns the Supplier to draft", async () => {
  const { service, events } = updateHarness({ status: "pending_approval" });
  const result = await service.updateSupplier({
    ...updateInput, supplierName: "A Completely Different Name", reason: "更正供應商名稱"
  });
  assert.equal(result.approvalInvalidated, true, "design 4.5 requires this in the response");
  const audits = events.filter(([kind]) => kind === "audit").map(([, entry]) => entry.action);
  assert.ok(audits.includes("approval.invalidate"));
  const draft = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("status = 'draft'"));
  assert.ok(draft, "the Supplier must go back to draft in the same transaction");
});

test("an insignificant edit while pending keeps the request and re-pins its Supplier version", async () => {
  // Without the re-pin, editing a phone number leaves the request permanently
  // unapprovable, because staleness is judged on suppliers.version.
  const { service, events } = updateHarness({ status: "pending_approval" });
  const result = await service.updateSupplier({
    ...updateInput, supplierName: "Old Name", displayName: "Old", generalPhone: "+852 9000 0000", reason: "更新聯絡電話"
  });
  assert.equal(result.approvalInvalidated, false);
  assert.equal(events.some(([kind, entry]) => kind === "audit" && entry.action === "approval.invalidate"), false);
  const repin = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("SET supplier_version = ?"));
  assert.ok(repin, "the open request must be re-pinned to the new Supplier version");
});

test("an edit while not pending touches the approval domain at all", async () => {
  const { service, events } = updateHarness({ status: "draft" });
  await service.updateSupplier({ ...updateInput, supplierName: "Another Name", reason: "更正供應商名稱" });
  assert.equal(events.some(([kind, sql]) => (kind === "query" || kind === "execute") &&
    String(sql).includes("supplier_activation_requests")), false);
});

test("the create schema accepts the approver fields the approval flow needs", async () => {
  // H2 was: additionalProperties:false plus no approverUserId made
  // create-with-activate impossible whenever the policy was ON.
  const { SUPPLIER_CREATE_SCHEMA } = await import("../src/handlers/suppliers/supplierSchemas.js");
  assert.equal(SUPPLIER_CREATE_SCHEMA.additionalProperties, false);
  for (const field of ["approverUserId", "requestNote"]) {
    assert.ok(Object.hasOwn(SUPPLIER_CREATE_SCHEMA.properties, field), `${field} is rejected by the create schema`);
  }
});

test("the submitted note reaches the request rather than being dropped", async () => {
  const { service, events } = harness({ approvalRequired: true });
  await service.createSupplier({ ...input, approverUserId: 2, requestNote: "請盡快批准，這是急單" });
  const insert = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("INSERT INTO supplier_activation_requests"));
  assert.ok(insert[2].includes("請盡快批准，這是急單"), "requestNote was discarded");
});

test("changing the Supplier Code while pending invalidates the request, per AC-012", async () => {
  // Design 4.5 lists Supplier Code first in the approval-significant set and AC-012
  // names it explicitly. Without this the request is stuck: the snapshot no longer
  // matches so it cannot be approved, and the Supplier stays in pending_approval so
  // it cannot be re-submitted either. The enforced field map now derives from
  // APPROVAL_SIGNIFICANT_COLUMNS so the two lists cannot drift apart again.
  const { service, events } = updateHarness({ status: "pending_approval" });
  const result = await service.changeSupplierCode({ ...updateInput, supplierCode: "SUP-NEW", reason: "更正舊有編碼" });
  assert.equal(result.approvalInvalidated, true);
  const audits = events.filter(([kind]) => kind === "audit").map(([, entry]) => entry.action);
  assert.ok(audits.includes("approval.invalidate"), "the pending request must not survive a code change");
  const draft = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("status = 'draft'"));
  assert.ok(draft, "the Supplier must return to draft so it can be re-submitted");
});

test("changing the Supplier Code while not pending leaves the approval domain alone", async () => {
  const { service, events } = updateHarness({ status: "draft" });
  const result = await service.changeSupplierCode({ ...updateInput, supplierCode: "SUP-NEW", reason: "更正舊有編碼" });
  assert.equal(result.approvalInvalidated, false);
  assert.equal(events.some(([kind, entry]) => kind === "audit" && entry.action === "approval.invalidate"), false);
});

test("the enforced significant-field map is derived from the documented list, not a second copy", async () => {
  // DEF-011 shape: two hand-maintained lists side by side drifted, and supplier_code
  // fell out of enforcement while the comment claimed it could not be changed here.
  const { APPROVAL_SIGNIFICANT_COLUMNS } = await import("../src/modules/supplier/SupplierApprovalService.js");
  assert.ok(APPROVAL_SIGNIFICANT_COLUMNS.includes("supplier_code"));
  for (const column of APPROVAL_SIGNIFICANT_COLUMNS) {
    const owner = column === "supplier_code" ? "changeSupplierCode" : "updateSupplier";
    assert.ok(owner, `${column} has no owning invalidation path`);
  }
});

test("the supplier detail response declares every field the service actually returns", async () => {
  // updateSupplier and changeSupplierCode return approvalInvalidated, which design
  // 4.5 requires. The response schema is additionalProperties:false and response
  // validation runs in every environment, so an undeclared field 500s a write that
  // already committed.
  const detail = {
    id: 1, supplierCode: "S", supplierName: "N", displayName: "", defaultCurrencyCode: "HKD",
    defaultPaymentTermId: null, status: "draft", version: 1, updatedAt: 1, website: "",
    generalPhone: "", generalEmail: "", notes: "", createdAt: 1,
    addresses: [], contacts: [], identifiers: [], bankAccounts: [], warnings: []
  };
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(SUPPLIER_DETAIL_SCHEMA);
  assert.equal(validate({ ...detail, duplicateCandidates: [], approvalInvalidated: true }), true,
    `the payload updateSupplier returns is rejected: ${JSON.stringify(validate.errors)}`);
});
