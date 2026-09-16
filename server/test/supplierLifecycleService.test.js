import assert from "node:assert/strict";
import test from "node:test";

import { SupplierAdminService } from "../src/modules/supplier/SupplierAdminService.js";

function harness({ status = "draft", version = 2, references = 0, openFlows = 0, approvalRequired = false, auditFails = false, latestAction = null } = {}) {
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
      if (sql.includes("ORDER BY id DESC")) return [latestAction ? [{ action: latestAction }] : []];
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
