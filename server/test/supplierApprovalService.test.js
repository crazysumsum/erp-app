import assert from "node:assert/strict";
import test from "node:test";

import { APPROVAL_SIGNIFICANT_COLUMNS, SupplierApprovalService, buildApprovalSummary } from "../src/modules/supplier/SupplierApprovalService.js";

function harness({
  requestStatus = "pending", requestVersion = 1, requestedBy = 1, assignedApproverId = 2,
  supplierStatus = "pending_approval", supplierVersion = 5, requestSupplierVersion = 5,
  actorId = 2, actorPermissions = ["supplier.approval"], approverActive = true,
  approverPermissions = ["supplier.approval"], updateAffectedRows = 1
} = {}) {
  const events = [];
  const request = {
    id: 11, supplier_id: 7, requested_by: requestedBy, assigned_approver_id: assignedApproverId,
    supplier_version: requestSupplierVersion, status: requestStatus, version: requestVersion,
    summary: "{}", request_note: "", decision_reason: "", requested_at: 10
  };
  const supplier = {
    id: 7, supplier_code: "SUP-7", supplier_name: "Demo", display_name: "",
    default_currency_code: "HKD", default_payment_term_id: null,
    status: supplierStatus, version: supplierVersion
  };
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM supplier_activation_requests")) return [[request]];
      if (sql.includes("FROM suppliers")) return [[supplier]];
      if (sql.includes("FROM users")) return [approverActive ? [{ id: params[0], username: "approver" }] : []];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (updateAffectedRows === 0) return [{ affectedRows: 0 }];
      if (sql.includes("UPDATE supplier_activation_requests")) request.status = params[0];
      if (sql.includes("UPDATE suppliers")) supplier.status = params[0];
      return [{ affectedRows: 1, insertId: 11 }];
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
        events.push(["transaction", "rollback"]);
        throw error;
      }
    },
    async query() { return [[]]; }
  };
  const service = new SupplierApprovalService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    authorize: async () => { events.push(["authorize"]); return { id: actorId, username: "approver", permissions: actorPermissions }; },
    audit: { async record(_connection, entry) { events.push(["audit", entry]); } },
    loadPermissions: async () => approverPermissions
  });
  return { service, events, request, supplier, connection };
}

const context = { actorId: 2, claimedRoles: [], claimedPermissions: ["supplier.approval"], id: 11, version: 1, requestId: "req-1", ip: "127.0.0.1" };

// ---- AC1: eligible approver -------------------------------------------------

test("an approver must be named, must be someone else, must be active and must hold the permission now", async () => {
  const cases = [
    [{ approverUserId: undefined }, "APPROVER_REQUIRED", {}],
    [{ approverUserId: 1 }, "APPROVER_MUST_DIFFER", {}],
    [{ approverUserId: 2 }, "APPROVER_NOT_ELIGIBLE", { approverActive: false }],
    [{ approverUserId: 2 }, "APPROVER_NOT_ELIGIBLE", { approverPermissions: ["supplier.mgmt"] }]
  ];
  for (const [input, code, options] of cases) {
    const { service, connection } = harness(options);
    await assert.rejects(
      () => service.assertEligibleApprover(connection, { ...input, requesterId: 1 }),
      (error) => error.publicCode === code,
      `expected ${code} for ${JSON.stringify({ ...input, ...options })}`
    );
  }
});

test("the permission is read from the database, not from what the submitter claimed", async () => {
  // BR-012/AC-009: a submitter could claim anything. The check that matters is what
  // the directory says about the approver right now.
  const { service, connection, events } = harness({ approverPermissions: ["supplier.approval"] });
  await service.assertEligibleApprover(connection, { approverUserId: 2, requesterId: 1 });
  const lookup = events.find(([kind, sql]) => kind === "query" && String(sql).includes("FROM users"));
  assert.match(String(lookup[1]), /status = 'active'/u, "an inactive user must not be an eligible approver");
});

// ---- AC2: snapshot ----------------------------------------------------------

test("the snapshot carries the minimum activation data and masks identifiers", async () => {
  const summary = buildApprovalSummary(
    { supplier_code: "SUP-7", supplier_name: "Demo", display_name: "D", default_currency_code: "HKD", default_payment_term_id: 3 },
    [{ identifier_type: "tax", issuer_country_code: "HK", identifier_value: "12345678" }]
  );
  assert.deepEqual(summary, {
    supplierCode: "SUP-7", supplierName: "Demo", displayName: "D",
    defaultCurrencyCode: "HKD", defaultPaymentTermId: 3,
    identifiers: [{ identifierType: "tax", issuerCountryCode: "HK", identifierValueMasked: "****5678" }]
  });
});

test("the snapshot is a whitelist, so a bank field cannot leak into it", async () => {
  // Design 4.5: the summary must not contain a full bank account. A blacklist would
  // let the next column added to suppliers through by default; this is a whitelist.
  const summary = buildApprovalSummary({
    supplier_code: "SUP-7", supplier_name: "Demo", display_name: "", default_currency_code: "HKD",
    default_payment_term_id: null,
    bank_account_number: "1234567890", account_ciphertext: "x", notes: "internal"
  });
  const serialized = JSON.stringify(summary);
  for (const leaked of ["1234567890", "account_ciphertext", "internal"]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} reached the approval snapshot`);
  }
});

test("the significant-field list is the one design 4.5 names", () => {
  assert.deepEqual([...APPROVAL_SIGNIFICANT_COLUMNS], [
    "supplier_code", "supplier_name", "display_name", "default_currency_code", "default_payment_term_id"
  ]);
});

// ---- AC3: decisions ---------------------------------------------------------

test("approving moves the Supplier to active and closes the request in one transaction", async () => {
  const { service, events } = harness();
  const result = await service.approveRequest({ ...context, reason: "資料齊全，批准啟用" });
  assert.equal(result.status, "approved");
  assert.equal(result.supplierStatus, "active");
  assert.equal(events.at(-1)[1], "commit");
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "approval.approve");
  assert.deepEqual(audit.detail.after, { requestStatus: "approved", supplierStatus: "active" });
});

test("rejecting returns the Supplier to draft and keeps the reason", async () => {
  const { service, events } = harness();
  const result = await service.rejectRequest({ ...context, reason: "幣別資料需要補充" });
  assert.equal(result.supplierStatus, "draft");
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "approval.reject");
  assert.equal(audit.reason, "幣別資料需要補充");
});

test("rejecting without a reason is refused before anything is locked", async () => {
  const { service, events } = harness();
  await assert.rejects(
    () => service.rejectRequest({ ...context, reason: "  " }),
    (error) => error.publicCode === "SUPPLIER_REASON_REQUIRED"
  );
  assert.equal(events.length, 0);
});

test("only the assigned approver may decide, and never the requester", async () => {
  const notAssigned = harness({ assignedApproverId: 9, actorId: 2 });
  await assert.rejects(
    () => notAssigned.service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "APPROVAL_NOT_ASSIGNED"
  );
  const selfApprove = harness({ requestedBy: 2, assignedApproverId: 2, actorId: 2 });
  await assert.rejects(
    () => selfApprove.service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "APPROVER_MUST_DIFFER"
  );
});

test("an approver who has lost the permission since submission cannot decide", async () => {
  // Design 4.5 requires the actor to hold the permission at decision time, not
  // merely to have held it when the request was created.
  const { service } = harness({ actorPermissions: ["supplier.view"] });
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "APPROVAL_PERMISSION_LOST"
  );
});

test("only the requester may withdraw", async () => {
  const { service } = harness({ requestedBy: 1, actorId: 2 });
  await assert.rejects(
    () => service.withdrawRequest({ ...context, reason: "暫時不需要這個供應商" }),
    (error) => error.publicCode === "APPROVAL_NOT_REQUESTER"
  );
  const own = harness({ requestedBy: 2, actorId: 2 });
  const result = await own.service.withdrawRequest({ ...context, reason: "暫時不需要這個供應商" });
  assert.equal(result.supplierStatus, "draft");
});

test("a Supplier changed since submission cannot be approved on the old request", async () => {
  // AC-012: the snapshot is bound to a Supplier version.
  const { service, events } = harness({ supplierVersion: 8, requestSupplierVersion: 5 });
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "APPROVAL_REQUEST_STALE" &&
      error.publicDetails?.submittedVersion === 5 && error.publicDetails?.currentVersion === 8
  );
  assert.equal(events.some(([kind]) => kind === "audit"), false, "a stale approval must not be audited");
  assert.equal(events.at(-1)[1], "rollback");
});

test("re-sending a decision that already happened returns the current state without a second audit", async () => {
  // FR-APPROVAL-007: a retried approve must not transition or audit twice.
  const { service, events } = harness({ requestStatus: "approved", supplierStatus: "active" });
  const result = await service.approveRequest({ ...context, reason: "批准" });
  assert.equal(result.replayed, true);
  assert.equal(result.status, "approved");
  assert.equal(events.some(([kind]) => kind === "audit"), false);
  assert.equal(events.some(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE")), false);
});

test("an opposite decision on a closed request is a conflict, not a replay", async () => {
  const { service } = harness({ requestStatus: "approved", supplierStatus: "active" });
  await assert.rejects(
    () => service.rejectRequest({ ...context, reason: "改變主意想拒絕" }),
    (error) => error.publicCode === "APPROVAL_REQUEST_NOT_OPEN"
  );
});

test("a stale request version is a conflict", async () => {
  const { service, events } = harness({ requestVersion: 3 });
  await assert.rejects(
    () => service.approveRequest({ ...context, version: 1, reason: "批准" }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(events.some(([kind]) => kind === "audit"), false);
});

test("a writer that slips in between the lock and the UPDATE is caught by the WHERE guards", async () => {
  const { service, events } = harness({ updateAffectedRows: 0 });
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(events.some(([kind]) => kind === "audit"), false);
  assert.equal(events.at(-1)[1], "rollback");
});

test("reassigning changes the approver without touching the Supplier", async () => {
  const { service, events } = harness({ actorId: 1 });
  const result = await service.reassignRequest({ ...context, actorId: 1, approverUserId: 3, reason: "原審批人休假" });
  assert.equal(result.assignedApproverId, 3);
  const supplierWrite = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE suppliers"));
  assert.equal(supplierWrite, undefined, "reassignment is not a decision and must not move the Supplier");
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "approval.reassign");
});

test("reassigning to the current approver is a no-op, not a version bump", async () => {
  const { service, events } = harness({ assignedApproverId: 3, actorId: 1 });
  const result = await service.reassignRequest({ ...context, actorId: 1, approverUserId: 3, reason: "重送同一個指派" });
  assert.equal(result.replayed, true);
  assert.equal(events.some(([kind]) => kind === "audit"), false);
});

test("a closed request cannot be reassigned", async () => {
  const { service } = harness({ requestStatus: "approved", actorId: 1 });
  await assert.rejects(
    () => service.reassignRequest({ ...context, actorId: 1, approverUserId: 3, reason: "已經結案再指派" }),
    (error) => error.publicCode === "APPROVAL_REQUEST_NOT_OPEN"
  );
});

test("the lock order is settings then supplier then request, per design 2.6", async () => {
  // The decision path does not read settings, so what it must show is that the
  // Supplier row is locked before the request is updated, never the reverse.
  const { service, events } = harness();
  await service.approveRequest({ ...context, reason: "批准" });
  const order = events
    .filter(([kind, sql]) => (kind === "query" || kind === "execute") && /FOR UPDATE|UPDATE supplier/u.test(String(sql)))
    .map(([, sql]) => (/FROM suppliers|UPDATE suppliers/u.test(String(sql)) ? "supplier" : "request"));
  assert.equal(order.indexOf("supplier") < order.lastIndexOf("request"), true,
    `supplier must be locked before the request is written, saw ${order.join(" -> ")}`);
});
