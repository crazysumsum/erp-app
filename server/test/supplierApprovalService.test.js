import assert from "node:assert/strict";
import test from "node:test";

import { APPROVAL_SIGNIFICANT_COLUMNS, SupplierApprovalService, buildApprovalSummary } from "../src/modules/supplier/SupplierApprovalService.js";

function harness({
  requestStatus = "pending", requestVersion = 1, requestedBy = 1, assignedApproverId = 2,
  supplierStatus = "pending_approval", supplierVersion = 5, requestSupplierVersion = 5,
  actorId = 2, actorPermissions = ["supplier.approval"], approverActive = true,
  approverPermissions = ["supplier.approval"], updateAffectedRows = 1, requestMissing = false
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
      if (sql.includes("FROM supplier_activation_requests")) return [requestMissing ? [] : [request]];
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
    loadPermissions: async () => approverPermissions,
    businessMaster: { async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; } },
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
    identifierCount: 1, identifiersTruncated: false,
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
    () => service.withdrawRequest({ ...context, supplierId: 7, reason: "暫時不需要這個供應商" }),
    (error) => error.publicCode === "APPROVAL_NOT_REQUESTER"
  );
  const own = harness({ requestedBy: 2, actorId: 2 });
  const result = await own.service.withdrawRequest({ ...context, supplierId: 7, reason: "暫時不需要這個供應商" });
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

test("suppliers is locked before the request, per design 2.6", async () => {
  // The previous version of this test asserted indexOf("supplier") < lastIndexOf("request"),
  // which passes under BOTH orders because the request is read twice. It certified
  // nothing, and the inverted order it missed deadlocks against updateSupplier on
  // real MySQL. Compare only the row locks, in the order they are actually taken.
  const { service, events } = harness();
  await service.approveRequest({ ...context, reason: "批准" });
  const locks = events
    .filter(([kind, sql]) => kind === "query" && String(sql).includes("FOR UPDATE"))
    .map(([, sql]) => (String(sql).includes("FROM suppliers") ? "suppliers" : "supplier_activation_requests"));
  assert.deepEqual(locks, ["suppliers", "supplier_activation_requests"],
    "updateSupplier locks suppliers then the request; taking them in the reverse order here closes a deadlock cycle");
});

test("reassigning requires the actor to hold supplier.approval right now", async () => {
  const { service } = harness({ actorId: 1, actorPermissions: ["supplier.mgmt"] });
  await assert.rejects(
    () => service.reassignRequest({ ...context, actorId: 1, approverUserId: 3, reason: "冇權限都想指派" }),
    (error) => error.publicCode === "APPROVAL_PERMISSION_LOST"
  );
});

test("an unauthorised actor cannot learn the request state through the replay branch", async () => {
  // The replay short-circuit used to return request and Supplier state before the
  // assignment check ran, so anyone fresh could probe a request by re-sending a
  // decision that had already happened.
  const { service } = harness({ requestStatus: "approved", supplierStatus: "active", assignedApproverId: 9 });
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "APPROVAL_NOT_ASSIGNED"
  );
});

test("no decision may be taken on a Supplier that has left pending_approval", async () => {
  for (const command of ["approveRequest", "rejectRequest", "withdrawRequest"]) {
    const { service } = harness({ supplierStatus: "active", requestedBy: 2, actorId: 2, assignedApproverId: 2 });
    await assert.rejects(
      // withdraw 而家一定要帶 route scope（REV-026 H-1），approve／reject 唔帶。
      () => service[command]({ ...context, reason: "供應商已經唔喺審批中", ...(command === "withdrawRequest" ? { supplierId: 7 } : {}) }),
      (error) => error.publicCode === "STATUS_TRANSITION_INVALID" || error.publicCode === "APPROVER_MUST_DIFFER",
      `${command} decided on a Supplier that is not pending`
    );
  }
});

// ---- AC2 second half: invalidation (H5 -- this path had no coverage at all) ----

function txHarness({ openRequestRow = { id: 11, supplier_id: 7 } } = {}) {
  const events = [];
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM supplier_activation_requests")) return [openRequestRow ? [openRequestRow] : []];
      return [[]];
    },
    async execute(sql, params) { events.push(["execute", sql, params]); return [{ affectedRows: 1 }]; }
  };
  const service = new SupplierApprovalService({
    database: { async withTransaction(work) { return work(connection); }, async query() { return [[]]; } },
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    audit: { async record(_c, entry) { events.push(["audit", entry]); } }
  });
  return { service, connection, events };
}

test("invalidating an open request closes it and records what changed", async () => {
  const { service, connection, events } = txHarness();
  const result = await service.invalidateOpenRequest(connection, {
    supplierId: 7, actorId: 1, actorUsername: "sam", supplierCode: "SUP-7",
    changedFields: ["supplierName"], reason: "名稱更正", requestId: "req-1", ip: "127.0.0.1"
  });
  assert.deepEqual(result, { id: 11, status: "invalidated" });
  const lock = events.find(([kind, sql]) => kind === "query" && String(sql).includes("FOR UPDATE"));
  assert.match(String(lock[1]), /status = \?/u, "only an open request may be invalidated");
  const write = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE supplier_activation_requests"));
  assert.match(String(write[1]), /status = 'invalidated'/u);
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "approval.invalidate");
  assert.deepEqual(audit.detail.changes, ["supplierName"]);
});

test("invalidating when there is no open request is a no-op, not an error", async () => {
  const { service, connection, events } = txHarness({ openRequestRow: null });
  assert.equal(await service.invalidateOpenRequest(connection, { supplierId: 7, actorId: 1 }), null);
  assert.equal(events.some(([kind]) => kind === "audit"), false);
  assert.equal(events.some(([kind]) => kind === "execute"), false);
});

test("an insignificant edit keeps a pending request usable by syncing its Supplier version", async () => {
  // Design 4.5 says Address/Contact/Notes/Bank changes do not affect the approval.
  // updateSupplier bumps suppliers.version regardless, and staleness is judged on
  // that version -- so without this sync, editing a phone number would make the
  // request permanently unapprovable.
  const { service, connection, events } = txHarness();
  assert.equal(await service.syncOpenRequestSupplierVersion(connection, { supplierId: 7, supplierVersion: 9 }), true);
  const [, sql, params] = events.find(([kind]) => kind === "execute");
  assert.match(String(sql), /SET supplier_version = \?/u);
  assert.deepEqual(params, [9, 7, "pending"], "only an open request may be re-pinned");
});

test("approval re-checks that the Supplier can still be activated", async () => {
  // Design 4.5: a Supplier whose default currency was retired between submit and
  // approve must not reach Active just because nothing about it changed.
  const { service } = harness();
  service.businessMaster = {
    async assertSupplierDefaultsInTransaction() {
      return { currency: { code: "HKD", status: "INACTIVE" }, paymentTerm: null };
    }
  };
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "SUPPLIER_NOT_ACTIVATABLE"
  );
});

test("the snapshot is size-bounded, and says so when it truncates", async () => {
  // A Supplier has no cap on identifiers and the summary is written as one JSON
  // column. Design 4.5 asks for a bounded snapshot; an unbounded one is how a
  // single row becomes hundreds of kilobytes.
  const many = Array.from({ length: 200 }, (_, index) => ({
    identifier_type: "other", issuer_country_code: "HK", identifier_value: `ID-${index}`
  }));
  const summary = buildApprovalSummary({ supplier_code: "SUP-7", supplier_name: "Demo" }, many);
  assert.equal(summary.identifiers.length, 50);
  assert.equal(summary.identifierCount, 200, "the real count must survive truncation");
  assert.equal(summary.identifiersTruncated, true);
  assert.ok(JSON.stringify(summary).length < 8192, "the snapshot must stay small enough to store and read");
});

test("approving without a businessMaster dependency fails loudly rather than skipping the check", async () => {
  // Design 4.5 mandates re-checking activatability at approval. When that dependency
  // was optional, a composition root that forgot to wire it silently removed the
  // rule -- and T29 wires the approve route.
  const { service } = harness();
  service.businessMaster = undefined;
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error instanceof TypeError && /businessMaster/u.test(error.message)
  );
});

test("the activatability filter drops only the status issue, not the data ones", async () => {
  // status is filtered because #assertRequestStillCurrent has already established
  // pending_approval, which SUPPLIER_ACTIVATABLE_STATUSES deliberately excludes so
  // activateSupplier cannot skip approval. Nothing else may be filtered out.
  const { service, supplier } = harness();
  supplier.supplier_name = "";
  await assert.rejects(
    () => service.approveRequest({ ...context, reason: "批准" }),
    (error) => error.publicCode === "SUPPLIER_NOT_ACTIVATABLE" &&
      error.publicDetails?.issues?.some((issue) => issue.field === "supplierName")
  );
});

test("invalidating bumps the request version so a concurrent holder sees it moved", async () => {
  const { service, connection, events } = txHarness();
  await service.invalidateOpenRequest(connection, { supplierId: 7, actorId: 1, reason: "關鍵資料變更" });
  const write = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE supplier_activation_requests"));
  assert.match(String(write[1]), /version = version \+ 1/u);
});

test("invalidateForSignificantChange owns both writes, so no caller can do half of it", async () => {
  // The rule used to be copied into three call sites across two services, and the
  // copies had already drifted: one bumped the Supplier row, two did not.
  const { service, connection, events } = txHarness();
  assert.equal(await service.invalidateForSignificantChange(connection, {
    supplierId: 7, actorId: 1, actorUsername: "sam", changedFields: ["supplierName"], reason: "名稱更正"
  }), true);
  const draft = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("SET status = 'draft'"));
  assert.ok(draft, "the Supplier must return to draft");
  assert.match(String(draft[1]), /version = version \+ 1/u, "and the row must signal that it moved");
  assert.equal(events.some(([kind, entry]) => kind === "audit" && entry.action === "approval.invalidate"), true);
});

test("with no open request it reports false and writes nothing", async () => {
  const { service, connection, events } = txHarness({ openRequestRow: null });
  assert.equal(await service.invalidateForSignificantChange(connection, { supplierId: 7, actorId: 1 }), false);
  assert.equal(events.some(([kind]) => kind === "execute"), false);
});

test("an invalidation with no reason still records why the request died", async () => {
  // updateSupplier always supplies one, but changeSupplierCode and the identifier
  // paths can reach here with an empty string, and an audit row saying nothing is
  // not much of an audit row.
  const { service, connection, events } = txHarness();
  await service.invalidateOpenRequest(connection, { supplierId: 7, actorId: 1, reason: "   " });
  const write = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE supplier_activation_requests"));
  assert.equal(write[2][1], "關鍵資料變更");
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.reason, "關鍵資料變更");
});

// ---- T29 read paths: queue, detail and the eligible approver lookup ---------

/**
 * 讀路徑唔經 withTransaction，所以佢哋淨係需要一個識記低 SQL 嘅 `database.query`。
 * 呢啲斷言睇 SQL 本身：真 MySQL 行為喺 integration/supplierApproval 度證。
 */
function readHarness({ rows = [], total = 0, identifiers = [], actorId = 2, authorizeError = null } = {}) {
  const queries = [];
  const authorizeCalls = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes("COUNT(*)")) return [[{ total }]];
      if (String(sql).includes("FROM supplier_identifiers")) return [identifiers];
      return [rows];
    }
  };
  const service = new SupplierApprovalService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    authorize: async (connection, input) => {
      authorizeCalls.push(input);
      if (authorizeError) throw authorizeError;
      return { id: actorId, username: "approver", permissions: ["supplier.approval"] };
    },
    loadPermissions: async () => ["supplier.approval"]
  });
  const listSql = () => queries.find((entry) => entry.sql.includes("FROM supplier_activation_requests r") && !entry.sql.includes("COUNT(*)"));
  return { service, queries, authorizeCalls, listSql };
}

const reader = { actorId: 2, claimedRoles: [], claimedPermissions: ["supplier.approval"] };

function queueRow(overrides = {}) {
  return {
    id: 11, supplier_id: 7, requested_by: 1, assigned_approver_id: 2, status: "pending",
    request_note: "請覆核", requested_at: 10, decided_at: null, version: 1,
    supplier_code: "SUP-7", supplier_name: "Demo", supplier_status: "pending_approval",
    requester_username: "maker", requester_display_name: "Maker",
    approver_username: "checker", approver_display_name: "Checker",
    ...overrides
  };
}

test("the queue defaults to the actor's own pending requests", async () => {
  const { service, listSql } = readHarness({ rows: [queueRow()], total: 1 });
  await service.listRequests({ ...reader });
  const { sql, params } = listSql();
  assert.match(sql, /r\.assigned_approver_id = \?/u);
  assert.deepEqual(params.slice(0, 2), ["pending", 2], "mine must bind the actor, not a client-supplied id");
});

test("scope=all drops the approver filter and scope=unassigned asks for a NULL approver", async () => {
  const all = readHarness();
  await all.service.listRequests({ ...reader, scope: "all" });
  assert.ok(!all.listSql().sql.includes("assigned_approver_id ="), "scope=all must not filter by approver");
  assert.ok(!all.listSql().sql.includes("assigned_approver_id IS NULL"));

  const unassigned = readHarness();
  await unassigned.service.listRequests({ ...reader, scope: "unassigned" });
  assert.match(unassigned.listSql().sql, /r\.assigned_approver_id IS NULL/u);
  assert.deepEqual(unassigned.listSql().params, ["pending", 20, 0], "unassigned must not bind an approver id");
});

test("an unknown scope or status is refused, not silently treated as the default", async () => {
  const { service } = readHarness();
  await assert.rejects(() => service.listRequests({ ...reader, scope: "everyone" }),
    (error) => error.publicCode === "APPROVAL_SCOPE_INVALID");
  await assert.rejects(() => service.listRequests({ ...reader, status: "maybe" }),
    (error) => error.publicCode === "APPROVAL_STATUS_INVALID");
});

test("the queue pages and counts on the server, and both halves see the same filter", async () => {
  const { service, queries } = readHarness({ rows: [], total: 137 });
  const page = await service.listRequests({ ...reader, scope: "all", status: "approved", requesterId: 9, requestedFrom: 5, requestedTo: 50, page: 3, pageSize: 25 });
  assert.deepEqual({ total: page.total, page: page.page, pageSize: page.pageSize }, { total: 137, page: 3, pageSize: 25 });
  const count = queries.find((entry) => entry.sql.includes("COUNT(*)"));
  const list = queries.find((entry) => entry.sql.includes("LIMIT ? OFFSET ?"));
  assert.deepEqual(count.params, ["approved", 9, 5, 50], "the count must use the same filter as the page");
  assert.deepEqual(list.params, ["approved", 9, 5, 50, 25, 50], "offset must be (page - 1) * pageSize");
});

test("the queue exposes the minimal user projection and never reads the bank table", async () => {
  const { service, listSql } = readHarness({ rows: [queueRow()], total: 1 });
  const { items } = await service.listRequests({ ...reader });
  assert.deepEqual(items[0].requester, { id: 1, username: "maker", displayName: "Maker" });
  assert.deepEqual(Object.keys(items[0]).sort(), [
    "assignedApprover", "decidedAt", "id", "requestNote", "requestedAt", "requester",
    "status", "supplierCode", "supplierId", "supplierName", "supplierStatus", "version"
  ]);
  assert.ok(!/supplier_bank_accounts/u.test(listSql().sql), "the approval queue must not touch bank rows");
  assert.ok(!/u\.email|password_hash/u.test(listSql().sql), "the queue must not select account security fields");
});

test("a request whose requester was deleted reads as nobody, not as user 0", async () => {
  // requested_by 同 assigned_approver_id 都係 ON DELETE SET NULL。
  const { service } = readHarness({ rows: [queueRow({ requested_by: null, assigned_approver_id: null })], total: 1 });
  const { items } = await service.listRequests({ ...reader, scope: "unassigned" });
  assert.equal(items[0].requester, null);
  assert.equal(items[0].assignedApprover, null);
});

test("the detail says stale exactly when the Supplier moved after submission", async () => {
  for (const [supplierVersion, currentVersion, expected] of [[5, 5, false], [5, 6, true]]) {
    const { service } = readHarness({
      rows: [queueRow({
        supplier_version: supplierVersion, current_supplier_version: currentVersion,
        summary: JSON.stringify({ supplierCode: "SUP-7", supplierName: "Demo", displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, identifierCount: 0, identifiersTruncated: false, identifiers: [] }),
        display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
        decided_by: null, decision_reason: ""
      })]
    });
    const detail = await service.getRequest({ ...reader, id: 11 });
    assert.equal(detail.stale, expected, `versions ${supplierVersion}/${currentVersion}`);
  }
});

test("the detail names exactly the snapshot fields that differ from the Supplier now", async () => {
  const submitted = { supplierCode: "SUP-7", supplierName: "Old Name", displayName: "", defaultCurrencyCode: "HKD", defaultPaymentTermId: null, identifierCount: 0, identifiersTruncated: false, identifiers: [] };
  const { service } = readHarness({
    rows: [queueRow({
      supplier_version: 5, current_supplier_version: 6, summary: JSON.stringify(submitted),
      supplier_name: "New Name", display_name: "", default_currency_code: "USD", default_payment_term_id: null,
      decided_by: null, decision_reason: ""
    })]
  });
  const detail = await service.getRequest({ ...reader, id: 11 });
  assert.deepEqual(detail.changedFields, ["supplierName", "defaultCurrencyCode"]);
  assert.equal(detail.submitted.supplierName, "Old Name");
  assert.equal(detail.current.supplierName, "New Name");
});

test("identifier order is not a change: the snapshot query has no ORDER BY to rely on", async () => {
  // 提交嗰陣嘅 identifier 查詢冇 ORDER BY，所以逐 index 比會報一個唔存在嘅改動。
  const identifiers = [
    { identifier_type: "tax", issuer_country_code: "HK", identifier_value: "12345678" },
    { identifier_type: "business_registration", issuer_country_code: "HK", identifier_value: "87654321" }
  ];
  const submitted = buildApprovalSummary(
    { supplier_code: "SUP-7", supplier_name: "Demo", display_name: "", default_currency_code: "HKD", default_payment_term_id: null },
    [identifiers[1], identifiers[0]]
  );
  const { service } = readHarness({
    rows: [queueRow({
      supplier_version: 5, current_supplier_version: 5, summary: JSON.stringify(submitted),
      display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
      decided_by: null, decision_reason: ""
    })],
    identifiers
  });
  const detail = await service.getRequest({ ...reader, id: 11 });
  assert.deepEqual(detail.changedFields, []);
});

test("a dropped identifier is a change even though the count is the only thing that moved", async () => {
  const submitted = buildApprovalSummary(
    { supplier_code: "SUP-7", supplier_name: "Demo", display_name: "", default_currency_code: "HKD", default_payment_term_id: null },
    [{ identifier_type: "tax", issuer_country_code: "HK", identifier_value: "12345678" }]
  );
  const { service } = readHarness({
    rows: [queueRow({
      supplier_version: 5, current_supplier_version: 5, summary: JSON.stringify(submitted),
      display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
      decided_by: null, decision_reason: ""
    })],
    identifiers: []
  });
  const detail = await service.getRequest({ ...reader, id: 11 });
  assert.deepEqual(detail.changedFields, ["identifiers"]);
});

test("a missing request is a 404, not an empty detail", async () => {
  const { service } = readHarness({ rows: [] });
  await assert.rejects(() => service.getRequest({ ...reader, id: 999 }),
    (error) => error.statusCode === 404 && error.publicCode === "SUPPLIER_NOT_FOUND");
});

test("the eligible approver lookup joins the real permission tables", async () => {
  const { service, queries } = readHarness({ rows: [{ id: 3, username: "checker", display_name: "Checker" }] });
  const { items } = await service.listEligibleApprovers({ ...reader });
  const { sql } = queries.at(-1);
  for (const table of ["user_roles", "role_permissions", "permissions"]) {
    assert.ok(sql.includes(table), `the lookup must join ${table} rather than trust a claim`);
  }
  assert.match(sql, /u\.status = 'active'/u);
  assert.match(sql, /p\.name = 'supplier\.approval'/u);
  // \b 係必要嘅：/LIMIT 100/ 會照樣 match "LIMIT 1000"，即係一個放寬上限嘅改動
  // 可以完全唔驚動呢個斷言。
  assert.match(sql, /LIMIT 100\b/u, "設計 6.4 固定上限 100 筆");
  assert.deepEqual(items, [{ id: 3, username: "checker", displayName: "Checker" }]);
});

test("the approver lookup can exclude one user and escapes a LIKE search", async () => {
  const { service, queries } = readHarness({ rows: [] });
  await service.listEligibleApprovers({ ...reader, q: "a_b%", excludeUserId: 9 });
  const { sql, params } = queries.at(-1);
  assert.match(sql, /u\.id <> \?/u);
  assert.deepEqual(params, [9, "%a\\_b\\%%", "%a\\_b\\%%"],
    "a name that really contains _ or % must not become a wildcard search");
});

test("withdraw refuses a request that belongs to another Supplier", async () => {
  // 撤回由 /suppliers/:id/approval/withdraw 入嚟。Route 嘅 Supplier 同 request 嘅
  // Supplier 唔夾就當搵唔到，唔可以借 Supplier B 嘅 route 去撤 Supplier A 嘅申請。
  const mismatched = harness({ requestedBy: 2 });
  await assert.rejects(
    () => mismatched.service.withdrawRequest({ ...context, supplierId: 8 }),
    (error) => error.statusCode === 404 && error.publicCode === "SUPPLIER_NOT_FOUND"
  );
  assert.ok(!mismatched.events.some(([kind]) => kind === "audit"), "a rejected scope must not write an audit row");

  const matched = harness({ requestedBy: 2 });
  const outcome = await matched.service.withdrawRequest({ ...context, supplierId: 7 });
  assert.equal(outcome.status, "withdrawn");
});

// ---- REV-026 remediation: controls that had no test that could fail --------

test("every read path re-reads the actor from the database before answering", async () => {
  // REV-026 M-1：hasPermission 係睇 token claim 嘅。設計 1.4 第四道守衛係呢句
  // assertActorFresh —— 由三條讀路徑各自叫。三句都可以刪走而套測試唔會出聲，
  // 而真實後果係一個已經俾人收返權限嘅 token 由 403 PERMISSION_STALE 變成 200
  // 加成個 queue。
  const detailRow = queueRow({
    supplier_version: 5, current_supplier_version: 5, summary: "{}",
    display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
    decided_by: null, decision_reason: ""
  });
  const calls = [
    ["listRequests", (service) => service.listRequests({ ...reader })],
    ["getRequest", (service) => service.getRequest({ ...reader, id: 11 })],
    ["listEligibleApprovers", (service) => service.listEligibleApprovers({ ...reader })]
  ];
  for (const [name, invoke] of calls) {
    const harnessed = readHarness({ rows: [detailRow], total: 1 });
    await invoke(harnessed.service);
    assert.equal(harnessed.authorizeCalls.length, 1, `${name} must re-read the actor`);
    assert.deepEqual(harnessed.authorizeCalls[0], {
      actorId: reader.actorId, claimedRoles: reader.claimedRoles, claimedPermissions: reader.claimedPermissions
    }, `${name} must pass the claims through for comparison`);
  }
});

test("a rejected actor stops the read: no query runs and the error propagates", async () => {
  const stale = new Error("PERMISSION_STALE");
  for (const invoke of [
    (service) => service.listRequests({ ...reader }),
    (service) => service.getRequest({ ...reader, id: 11 }),
    (service) => service.listEligibleApprovers({ ...reader })
  ]) {
    const harnessed = readHarness({ authorizeError: stale });
    await assert.rejects(() => invoke(harnessed.service), (error) => error === stale);
    assert.equal(harnessed.queries.length, 0, "a rejected actor must not reach the database");
  }
});

test("scope=mine ignores a client-supplied requesterId when choosing whose queue to read", async () => {
  // REV-026 M-2：requesterId 係一個真嘅 query parameter。之前嗰個測試根本冇送過
  // requesterId，所以佢分唔出 actor 同「啱啱好冇送嘅 client 值」。
  const { service, listSql } = readHarness({ rows: [queueRow()], total: 1 });
  await service.listRequests({ ...reader, scope: "mine", requesterId: 999 });
  const { sql, params } = listSql();
  // approverIndex 係「approver 個 ? 之前有幾多個 ?」，亦即佢喺 params 入面嘅位置。
  const approverIndex = sql.slice(0, sql.indexOf("r.assigned_approver_id = ?")).split("?").length - 1;
  assert.equal(params[approverIndex], reader.actorId,
    "?scope=mine&requesterId=<someone else> must still read the actor's own queue");
  assert.ok(params.includes(999), "the requesterId filter itself still applies");
});

test("an added identifier is a change, not just a removed one", async () => {
  // REV-026 L-1：舊測試只覆蓋咗「少咗一個」，嗰邊 b[0] 係 undefined，就算冇長度
  // 檢查都會唔等。長度檢查真正存在嘅理由係「多咗一個」呢個方向。
  // 新嗰個 identifier 要排喺原有嗰個之後，先至真係考到長度檢查：如果佢排前面，
  // 逐 index 比第一項就已經唔等，冇長度檢查一樣會報到改動。business_registration
  // 排喺 tax 之前，所以原有嗰個係 business_registration，新加嘅係 tax。
  const kept = { identifier_type: "business_registration", issuer_country_code: "HK", identifier_value: "87654321" };
  const submitted = buildApprovalSummary(
    { supplier_code: "SUP-7", supplier_name: "Demo", display_name: "", default_currency_code: "HKD", default_payment_term_id: null },
    [kept]
  );
  const identifiers = [kept, { identifier_type: "tax", issuer_country_code: "HK", identifier_value: "12345678" }];
  const { service } = readHarness({
    rows: [queueRow({
      supplier_version: 5, current_supplier_version: 5, summary: JSON.stringify(submitted),
      display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
      decided_by: null, decision_reason: ""
    })],
    identifiers
  });
  const detail = await service.getRequest({ ...reader, id: 11 });
  assert.deepEqual(detail.changedFields, ["identifiers"]);
});

test("two identifiers that differ only by country or by value are not the same identifier", async () => {
  // REV-026 L-2：identifierKey 可以掉走 issuerCountryCode 或者遮罩值而唔會有人出聲。
  const base = { supplier_code: "SUP-7", supplier_name: "Demo", display_name: "", default_currency_code: "HKD", default_payment_term_id: null };
  const cases = [
    ["issuer country", { identifier_type: "tax", issuer_country_code: "CN", identifier_value: "12345678" }],
    ["identifier value", { identifier_type: "tax", issuer_country_code: "HK", identifier_value: "87654321" }]
  ];
  for (const [what, changed] of cases) {
    const submitted = buildApprovalSummary(base, [{ identifier_type: "tax", issuer_country_code: "HK", identifier_value: "12345678" }]);
    const { service } = readHarness({
      rows: [queueRow({
        supplier_version: 5, current_supplier_version: 5, summary: JSON.stringify(submitted),
        display_name: "", default_currency_code: "HKD", default_payment_term_id: null,
        decided_by: null, decision_reason: ""
      })],
      identifiers: [changed]
    });
    const detail = await service.getRequest({ ...reader, id: 11 });
    assert.deepEqual(detail.changedFields, ["identifiers"], `a changed ${what} must count as a change`);
  }
});

test("the date filters bound the range they name, and the newest request comes first", async () => {
  // REV-026 L-2：requestedTo 由 <= 變 >= 唔會有人出聲，而兩頁分割嗰個測試係靠
  // 排序穩定先成立，但冇邊度講明排邊個方向。
  const { service, listSql } = readHarness();
  await service.listRequests({ ...reader, requestedFrom: 5, requestedTo: 50 });
  const { sql } = listSql();
  assert.match(sql, /r\.requested_at >= \?/u, "requestedFrom is a lower bound");
  assert.match(sql, /r\.requested_at <= \?/u, "requestedTo is an upper bound");
  assert.match(sql, /ORDER BY r\.requested_at DESC, r\.id DESC/u, "the queue shows the newest first, stably");
});

test("a user who holds the permission through two roles is listed once", async () => {
  // REV-026 L-2：三張 join 表會將同一個人乘出幾行；DISTINCT 可以刪走而套測試全綠。
  const { service, queries } = readHarness({ rows: [] });
  await service.listEligibleApprovers({ ...reader });
  assert.match(queries.at(-1).sql, /SELECT DISTINCT/u,
    "user_roles x role_permissions can yield the same user more than once");
});

test("a missing approval request says so on every command, not that the Supplier is missing", async () => {
  // REV-027 L-7：五條路入面有四條改咗，reassign 漏低咗。Public code 五條都一樣，
  // 所以分別只喺人睇到嗰句 —— 呢個斷言就係守住嗰句。
  const commands = [
    ["approveRequest", { ...context, supplierId: undefined }],
    ["rejectRequest", { ...context, reason: "拒絕原因夠長" }],
    ["withdrawRequest", { ...context, supplierId: 7 }],
    ["reassignRequest", { ...context, approverUserId: 3, reason: "重新指派原因" }]
  ];
  for (const [command, input] of commands) {
    const { service } = harness({ requestMissing: true, requestedBy: 2 });
    await assert.rejects(
      () => service[command](input),
      (error) => error.statusCode === 404
        && error.publicCode === "SUPPLIER_NOT_FOUND"
        && error.publicMessage === "找不到這個審批申請",
      `${command} reported a missing approval request as a missing Supplier`
    );
  }
  // 讀路徑係第五條。
  const { service } = readHarness({ rows: [] });
  await assert.rejects(
    () => service.getRequest({ ...reader, id: 999 }),
    (error) => error.publicMessage === "找不到這個審批申請"
  );
});
