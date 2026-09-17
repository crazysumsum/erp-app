import assert from "node:assert/strict";
import test from "node:test";

import { SupplierApprovalService } from "../src/modules/supplier/SupplierApprovalService.js";
import { LIFECYCLE_COMMANDS, SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function harness({ status = "draft", version = 2, references = 0, openFlows = 0, approvalRequired = false, auditFails = false, latestAction = null, auditLog = null, deleteError = null, approverEligible = true } = {}) {
  const events = [];
  const row = {
    id: 7, supplier_code: "SUP-7", supplier_code_key: "sup-7", supplier_name: "Supplier",
    supplier_name_key: "supplier", display_name: "", default_currency_code: "HKD",
    default_payment_term_id: null, website: "", general_phone: "", general_email: "",
    notes: "", status, version, created_at: 1, updated_at: 2
  };
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM users") && sql.includes("status = 'active'")) {
        return [approverEligible ? [{ id: params[0], username: "approver" }] : []];
      }
      if (sql.includes("SELECT * FROM suppliers") && sql.includes("FOR UPDATE")) return [[row]];
      if (sql.includes("supplier_audit_logs") && sql.includes("supplier.activate")) return [[]];
      if (sql.includes("ORDER BY id DESC")) {
        // Mirror the real query: only the actions the statement actually filters
        // on (its bound params after supplier_id) are candidates for replay.
        if (auditLog) {
          const allowed = new Set(params.slice(1));
          const matches = auditLog.filter((action) => allowed.has(action));
          return [matches.length ? [{ action: matches[matches.length - 1] }] : []];
        }
        return [latestAction ? [{ action: latestAction }] : []];
      }
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("UPDATE suppliers")) {
        row.status = params[0];
        row.version += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("DELETE FROM suppliers")) {
        if (deleteError) throw deleteError;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
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
    async query(sql) {
      events.push(["outer-query", sql]);
      if (sql.includes("SELECT * FROM suppliers")) return [[row]];
      return [[]];
    }
  };
  const service = new SupplierAdminService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    authorize: async () => { events.push(["authorize"]); return { id: 1, username: "sam", permissions: ["supplier.mgmt", "supplier.view", "supplier.approval"] }; },
    approvals: new SupplierApprovalService({
      database, logger: { warn() {} }, time: { nowMs: () => 100 },
      audit: { async record(_c, entry) { events.push(["audit", entry]); } },
      loadPermissions: async () => (approverEligible ? ["supplier.approval"] : []),
  businessMaster: { async assertSupplierDefaultsInTransaction() { return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null }; } },
    }),
    businessMaster: {
      async assertSupplierDefaultsInTransaction() {
        events.push(["business-master"]);
        return { currency: { code: "HKD", status: "ACTIVE" }, paymentTerm: null };
      }
    },
    audit: { async record(_connection, input) { events.push(["audit", input]); if (auditFails) throw new Error("audit failed"); } },
    references: { async describeReferences() { events.push(["references"]); return { references: { purchaseOrders: references }, total: references }; } },
    openFlows: { async describeReferences() { events.push(["open-flows"]); return { references: { openPurchaseOrders: openFlows }, total: openFlows }; } },
    approvalRequired: async () => approvalRequired
  });
  return { service, events, row };
}

const context = { actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.mgmt"], id: 7, version: 2, reason: "Valid lifecycle reason", requestId: "req-1", ip: "127.0.0.1" };

test("activate and reactivate revalidate activation data and write one atomic audit", async () => {
  const activation = harness();
  assert.equal((await activation.service.activateSupplier({ ...context })).status, "active");
  assert.deepEqual(activation.events.filter(([name]) => ["authorize", "business-master", "audit"].includes(name)).map(([name]) => name), ["authorize", "business-master", "audit", "authorize"]);
  assert.equal(activation.events.find(([name]) => name === "audit")[1].action, "supplier.activate");

  const reactivation = harness({ status: "suspended" });
  assert.equal((await reactivation.service.reactivateSupplier({ ...context })).status, "active");
  assert.equal(reactivation.events.find(([name]) => name === "audit")[1].action, "supplier.reactivate");
});

test("same-target lifecycle replay returns current state without version increment or duplicate audit", async () => {
  const { service, events } = harness({ status: "suspended", version: 5, latestAction: "supplier.suspend" });
  const result = await service.suspendSupplier({ ...context, version: 2 });
  assert.equal(result.status, "suspended");
  assert.equal(result.version, 5);
  assert.equal(events.some(([name]) => name === "execute" || name === "audit"), false);
  const wrongCommand = harness({ status: "suspended", version: 5, latestAction: "supplier.suspend" });
  await assert.rejects(() => wrongCommand.service.restoreSupplier({ ...context, version: 5 }), (error) => error.publicCode === "STATUS_TRANSITION_INVALID");
});

test("every registered lifecycle command is covered by the replay filter", async () => {
  // DEF-011: LIFECYCLE_ACTIONS used to be a hand-maintained copy of the action
  // strings. #changeStatus now takes a key of LIFECYCLE_COMMANDS rather than a
  // descriptor, so a transition cannot reach the transition path at all without
  // being registered — and registering it puts its action in the filter. This
  // walks the registry itself and proves the filter really binds what each
  // command writes; a command added to the registry fails here until this test
  // is taught how to reach it.
  const starting = { activate: "draft", suspend: "active", reactivate: "suspended",
    block: "active", unblock: "blocked", archive: "active", restore: "archived" };
  const unreached = Object.keys(LIFECYCLE_COMMANDS).filter((name) => !(name in starting));
  assert.deepEqual(unreached, [], "a lifecycle command was registered without a starting status here");

  for (const [name, command] of Object.entries(LIFECYCLE_COMMANDS)) {
    const { service, events } = harness({ status: starting[name] });
    await service[`${name}Supplier`]({ ...context });
    const written = events.find(([kind]) => kind === "audit")[1].action;
    assert.equal(written, command.action, `${name} writes an action the registry does not declare`);
    // Re-issuing the same command now that the row sits at the target status
    // drives the replay branch, which is where the filter is bound.
    await service[`${name}Supplier`]({ ...context }).catch(() => {});
    const query = events.find(([kind, sql]) => kind === "query" && String(sql).includes("ORDER BY id DESC"));
    assert.ok(query, `${name} did not reach the replay lookup`);
    assert.ok(new Set(query[2].slice(1)).has(written),
      `${written} is written by ${name} but absent from the replay filter`);
  }
});

test("replay detection ignores non-lifecycle audit rows written after the command", async () => {
  // DEF-002: every audit action this module writes begins with "supplier.", so
  // matching on LIKE 'supplier.%' let an unrelated child-record write shadow the
  // real transition and turn a genuine replay into a misleading 409.
  const { service, events } = harness({
    status: "suspended",
    version: 5,
    auditLog: ["supplier.activate", "supplier.suspend", "supplier.contact.create", "supplier.address.update"]
  });
  const result = await service.suspendSupplier({ ...context, version: 2 });
  assert.equal(result.status, "suspended");
  assert.equal(result.version, 5);
  assert.equal(events.some(([name]) => name === "execute" || name === "audit"), false);

  // A genuinely wrong command is still rejected on the same audit history.
  const wrong = harness({
    status: "suspended",
    version: 5,
    auditLog: ["supplier.activate", "supplier.suspend", "supplier.contact.create"]
  });
  await assert.rejects(
    () => wrong.service.restoreSupplier({ ...context, version: 5 }),
    (error) => error.publicCode === "STATUS_TRANSITION_INVALID"
  );
});

test("block and unblock follow the exact state matrix and unblock only to Suspended", async () => {
  const blocked = harness({ status: "active" });
  assert.equal((await blocked.service.blockSupplier({ ...context })).status, "blocked");
  const unblocked = harness({ status: "blocked" });
  assert.equal((await unblocked.service.unblockSupplier({ ...context })).status, "suspended");
  const invalid = harness({ status: "draft" });
  await assert.rejects(() => invalid.service.blockSupplier({ ...context }), (error) => error.publicCode === "STATUS_TRANSITION_INVALID");
  const activeUnblock = harness({ status: "active" });
  await assert.rejects(() => activeUnblock.service.unblockSupplier({ ...context }), (error) => error.publicCode === "STATUS_TRANSITION_INVALID");
});

test("archive returns named open-flow blockers and restore only returns Suspended", async () => {
  const blocked = harness({ status: "active", openFlows: 2 });
  await assert.rejects(
    () => blocked.service.archiveSupplier({ ...context }),
    (error) => error.publicCode === "SUPPLIER_OPEN_FLOWS" && error.details.references.openPurchaseOrders === 2
  );
  assert.equal(blocked.events.some(([name]) => name === "execute" || name === "audit"), false);

  const restored = harness({ status: "archived" });
  assert.equal((await restored.service.restoreSupplier({ ...context })).status, "suspended");
  const activeRestore = harness({ status: "active" });
  await assert.rejects(() => activeRestore.service.restoreSupplier({ ...context }), (error) => error.publicCode === "STATUS_TRANSITION_INVALID");
});

test("delete permits only an unreferenced never-active Draft and retains a reasoned audit", async () => {
  const referenced = harness({ references: 1 });
  await assert.rejects(() => referenced.service.deleteSupplier({ ...context }), (error) => error.publicCode === "SUPPLIER_REFERENCED");
  const active = harness({ status: "active" });
  await assert.rejects(() => active.service.deleteSupplier({ ...context }), (error) => error.publicCode === "SUPPLIER_DELETE_NOT_ALLOWED");

  const allowed = harness();
  assert.deepEqual(await allowed.service.deleteSupplier({ ...context }), { id: 7 });
  const audit = allowed.events.find(([name]) => name === "audit")[1];
  assert.equal(audit.action, "supplier.delete");
  assert.equal(audit.reason, context.reason);
});

test("audit failure rolls a lifecycle state change back as one transaction", async () => {
  const { service, events } = harness({ status: "active", auditFails: true });
  await assert.rejects(() => service.suspendSupplier({ ...context }), /audit failed/u);
  assert.equal(events.at(-1)[1], "rollback");
});

test("approval-enabled activation routes to pending_approval instead of going straight to active", async () => {
  // TASK-025 shipped this path as an explicit refusal because the approval domain
  // did not exist. TASK-028 replaces the refusal with the transition design 4.4
  // specifies: draft -> pending_approval, with a request opened in the same
  // transaction rather than the Supplier reaching active.
  const { service, events } = harness({ approvalRequired: true, status: "draft" });
  await service.activateSupplier({ ...context, approverUserId: 2 });
  const statusWrite = events.find(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE suppliers"));
  assert.equal(statusWrite[2][0], "pending_approval", "approval ON must not produce an active Supplier");
  const audits = events.filter(([kind]) => kind === "audit").map(([, entry]) => entry.action);
  assert.ok(audits.includes("approval.submit"), "the submission must be audited in the same transaction");
});

test("a RESTRICT foreign key that no reference checker covers is reported as a reference conflict", async () => {
  // this.references only reports the child tables whose checkers the caller
  // registered. supplier_activation_requests (0035) is RESTRICT, so its rows can
  // reach the DELETE unannounced; the driver error must not become a 500.
  const referenced = Object.assign(new Error("Cannot delete or update a parent row"), { code: "ER_ROW_IS_REFERENCED_2" });
  const { service } = harness({ status: "draft", deleteError: referenced });
  await assert.rejects(() => service.deleteSupplier({ ...context }), (error) => error.publicCode === "SUPPLIER_REFERENCED");
});

test("a re-sent activate returns current state whether the Supplier is pending or already active", async () => {
  // Scoping the replay comparison to the effective target lost idempotency for a
  // Supplier that went active while the policy was OFF and is re-activated after it
  // was switched ON. Both states are terminal for a re-sent activate.
  for (const [status, approvalRequired] of [["pending_approval", true], ["active", true], ["active", false]]) {
    const { service, events } = harness({ status, approvalRequired, latestAction: "supplier.activate" });
    await service.activateSupplier({ ...context, ...(approvalRequired ? { approverUserId: 2 } : {}) });
    assert.equal(events.some(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE suppliers")), false,
      `re-sent activate on ${status} with policy ${approvalRequired ? "ON" : "OFF"} transitioned again`);
  }
});

test("AC-013: a pending Supplier cannot be activated directly, even after the policy is switched off", async () => {
  // The policy is snapshotted at submission. Flipping it OFF must not turn a pending
  // Supplier into an activatable one -- the open request still has to be decided.
  const { service, events } = harness({ status: "pending_approval", approvalRequired: false });
  await assert.rejects(
    () => service.activateSupplier({ ...context }),
    (error) => error.publicCode === "STATUS_TRANSITION_INVALID" || error.publicCode === "SUPPLIER_NOT_ACTIVATABLE"
  );
  assert.equal(events.some(([kind, sql]) => kind === "execute" && String(sql).includes("UPDATE suppliers")), false);
});

test("no lifecycle command admits pending_approval as a source state", () => {
  // The behaviour has defence in depth -- assertSupplierActivatable rejects
  // pending_approval independently via SUPPLIER_ACTIVATABLE_STATUSES -- so widening
  // allowedFrom only changes which error surfaces, and no behavioural test can catch
  // it. Pin the registry directly: leaving pending_approval only through approve,
  // reject, withdraw or invalidate is design 4.4's rule, not an incidental outcome.
  for (const [name, command] of Object.entries(LIFECYCLE_COMMANDS)) {
    assert.equal(command.allowedFrom.includes("pending_approval"), false,
      `${name} would let a Supplier leave pending_approval without a decision`);
  }
  assert.deepEqual([...LIFECYCLE_COMMANDS.activate.allowedFrom], ["draft"]);
});

test("the submitted note reaches the request on the activate submit path too", async () => {
  // The requestNote rename was fixed at two sites; only createSupplier's had a test,
  // so reverting this one stayed green. This is the path T29's API will drive, and
  // the note is what the approver reads.
  const { service, events } = harness({ status: "draft", approvalRequired: true });
  await service.activateSupplier({ ...context, approverUserId: 2, requestNote: "急單，請盡快批准" });
  const insert = events.find(([kind, sql]) => kind === "execute" &&
    String(sql).includes("INSERT INTO supplier_activation_requests"));
  assert.ok(insert, "a request must be opened");
  assert.ok(insert[2].includes("急單，請盡快批准"),
    `the submitter's note was replaced by something else: ${JSON.stringify(insert[2])}`);
});
