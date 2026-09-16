import assert from "node:assert/strict";
import test from "node:test";

import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function harness({ status = "draft", version = 2, references = 0, openFlows = 0, approvalRequired = false, auditFails = false, latestAction = null, auditLog = null } = {}) {
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
      if (sql.includes("DELETE FROM suppliers")) return [{ affectedRows: 1 }];
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

test("every lifecycle command the service exposes is covered by the replay filter", async () => {
  // DEF-011: LIFECYCLE_ACTIONS used to be a hand-maintained copy of the action
  // strings, with no structural link to the commands. This discovers the commands
  // by reflection, so a transition added in a later phase without extending the
  // filter fails here rather than silently turning a replay into a 409.
  const starting = { activateSupplier: "draft", suspendSupplier: "active", reactivateSupplier: "suspended",
    blockSupplier: "active", unblockSupplier: "blocked", archiveSupplier: "active", restoreSupplier: "archived" };
  const commands = Object.getOwnPropertyNames(SupplierAdminService.prototype)
    .filter((name) => /^(?!delete)[a-z].*Supplier$/.test(name) && name in starting);
  assert.equal(commands.length, 7, "starting-state map is stale; a lifecycle command was added or removed");

  let boundActions = null;
  const audited = [];
  for (const name of commands) {
    const { service, events } = harness({ status: starting[name] });
    await service[name]({ ...context });
    audited.push(events.find(([kind]) => kind === "audit")[1].action);
    // Re-issuing the same command now that the row sits at the target status
    // drives the replay branch, which is where the filter is bound.
    await service[name]({ ...context }).catch(() => {});
    const query = events.find(([kind, sql]) => kind === "query" && String(sql).includes("ORDER BY id DESC"));
    if (query) boundActions = new Set(query[2].slice(1));
  }

  assert.ok(boundActions, "no replay lookup was observed");
  for (const action of audited) {
    assert.ok(boundActions.has(action), `${action} is written by a command but absent from the replay filter`);
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

test("approval-enabled activation fails explicitly until the approval phase is deployed", async () => {
  const { service, events } = harness({ approvalRequired: true });
  await assert.rejects(() => service.activateSupplier({ ...context }), (error) => error.publicCode === "SUPPLIER_APPROVAL_NOT_READY");
  assert.equal(events.some(([name]) => name === "execute" || name === "audit"), false);
});
