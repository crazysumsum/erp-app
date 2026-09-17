import assert from "node:assert/strict";
import test from "node:test";

import { SupplierSettingsService, getActivationPolicy } from "../src/modules/supplier/SupplierSettingsService.js";

function harness({ requireActivationApproval = 0, version = 1, missingRow = false } = {}) {
  const events = [];
  const row = { id: 1, require_activation_approval: requireActivationApproval, version, updated_at: 10, updated_by: null };
  const connection = {
    async query(sql, params) {
      events.push(["query", sql, params]);
      if (sql.includes("FROM supplier_settings")) return [missingRow ? [] : [row]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", sql, params]);
      if (sql.includes("UPDATE supplier_settings")) {
        row.require_activation_approval = params[0];
        row.version += 1;
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
    async query(sql, params) {
      events.push(["outer-query", sql, params]);
      if (sql.includes("FROM supplier_settings")) return [missingRow ? [] : [row]];
      return [[]];
    }
  };
  const service = new SupplierSettingsService({
    database,
    logger: { warn() {} },
    time: { nowMs: () => 100 },
    authorize: async () => { events.push(["authorize"]); return { id: 1, username: "sam", permissions: ["supplier.settings"] }; },
    audit: { async record(_connection, input) { events.push(["audit", input]); } }
  });
  return { service, events, row, connection };
}

const context = {
  actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.settings"],
  reason: "公司開始要求供應商建檔覆核", requestId: "req-1", ip: "127.0.0.1"
};

test("reading settings returns the typed singleton with its version", async () => {
  const { service } = harness({ requireActivationApproval: 1, version: 4 });
  assert.deepEqual(await service.getSettings({ ...context }), {
    requireActivationApproval: true, version: 4, updatedAt: 10, updatedBy: null
  });
});

test("updating locks id=1, checks the version and audits before/after with the reason", async () => {
  const { service, events } = harness({ requireActivationApproval: 0, version: 4 });
  const result = await service.updateSettings({ ...context, version: 4, requireActivationApproval: true });
  assert.deepEqual(result, { requireActivationApproval: true, version: 5, updatedAt: 100, updatedBy: 1 });

  const select = events.find(([kind, sql]) => kind === "query" && String(sql).includes("supplier_settings"));
  assert.match(String(select[1]), /WHERE id = 1/u);
  assert.match(String(select[1]), /FOR UPDATE/u);

  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "setting.update");
  assert.equal(audit.reason, context.reason);
  assert.deepEqual(audit.detail, {
    before: { requireActivationApproval: false },
    after: { requireActivationApproval: true }
  });
  assert.equal(audit.supplierId, null, "a settings change belongs to no single supplier");
});

test("a settings change touches neither suppliers nor pending activation requests", async () => {
  // FR-SET-005 / AC-013: turning approval off must not retroactively approve
  // anything, and turning it on must not sweep existing Suppliers. The cheapest
  // way to guarantee that is to never read or write those tables here.
  const { service, events } = harness({ version: 4 });
  await service.updateSettings({ ...context, version: 4, requireActivationApproval: true });
  const touched = events
    .filter(([kind]) => kind === "query" || kind === "execute" || kind === "outer-query")
    .map(([, sql]) => String(sql))
    .filter((sql) => /\bsuppliers\b|supplier_activation_requests/u.test(sql));
  assert.deepEqual(touched, [], "the settings update reached Supplier or approval rows");
});

test("a stale version is a conflict and writes nothing", async () => {
  const { service, events, row } = harness({ version: 4 });
  await assert.rejects(
    () => service.updateSettings({ ...context, version: 2, requireActivationApproval: true }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(row.version, 4);
  assert.equal(events.some(([kind]) => kind === "audit"), false);
  assert.equal(events.at(-1)[1], "rollback");
});

test("a missing reason is rejected before anything is locked", async () => {
  const { service, events } = harness({ version: 4 });
  await assert.rejects(
    () => service.updateSettings({ ...context, reason: "  ", version: 4, requireActivationApproval: true }),
    (error) => error.publicCode === "SUPPLIER_REASON_REQUIRED"
  );
  assert.equal(events.length, 0, "the transaction must not open for an input the service already knows is invalid");
});

test("an unknown setting field is rejected rather than stored", async () => {
  // FR-SET-006: a parameter that is not defined must produce no business effect.
  // The handler schema rejects it too; the service does not rely on that.
  const { service } = harness({ version: 4 });
  await assert.rejects(
    () => service.updateSettings({ ...context, version: 4, requireActivationApproval: true, autoApproveEverything: true }),
    (error) => error.publicCode === "SUPPLIER_SETTING_UNKNOWN"
  );
});

test("an update that changes nothing is still a conflict-free no-op with an audit trail", async () => {
  const { service, events } = harness({ requireActivationApproval: 1, version: 4 });
  const result = await service.updateSettings({ ...context, version: 4, requireActivationApproval: true });
  assert.equal(result.requireActivationApproval, true);
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.deepEqual(audit.detail, {
    before: { requireActivationApproval: true },
    after: { requireActivationApproval: true }
  });
});

test("getActivationPolicy reads the caller's transaction deterministically", async () => {
  // create, approval and import all decide inside a transaction they already own,
  // so the policy has to be read on that connection and be stable for its duration.
  const { connection, events } = harness({ requireActivationApproval: 1 });
  assert.equal(await getActivationPolicy(connection), true);
  const [, sql] = events.find(([kind]) => kind === "query");
  assert.match(String(sql), /FOR SHARE/u, "a concurrent settings write must not change the answer mid-transaction");
  assert.match(String(sql), /WHERE id = 1/u);
});

test("getActivationPolicy refuses to guess when the singleton row is absent", async () => {
  // Defaulting to false would silently grant direct activation when the policy is
  // unknown, which is the wrong direction to fail in for SEC-007.
  const { connection } = harness({ missingRow: true });
  await assert.rejects(() => getActivationPolicy(connection), /supplier_settings/u);
});
