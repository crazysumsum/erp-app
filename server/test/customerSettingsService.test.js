import assert from "node:assert/strict";
import test from "node:test";

import {
  CustomerSettingsService,
  getCustomerActivationPolicy
} from "../src/modules/customer/CustomerSettingsService.js";

function harness({ requireActivationApproval = 0, version = 1, missingRow = false, updateAffectedRows = 1 } = {}) {
  const events = [];
  const row = { id: 1, require_activation_approval: requireActivationApproval, version, updated_at: 10, updated_by: null };
  const connection = {
    async query(sql, params) {
      events.push(["query", String(sql), params]);
      if (String(sql).includes("FROM customer_settings")) return [missingRow ? [] : [row]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", String(sql), params]);
      if (String(sql).includes("UPDATE customer_settings")) {
        if (updateAffectedRows === 0) return [{ affectedRows: 0 }];
        row.require_activation_approval = params[0];
        row.version += 1;
      }
      return [{ affectedRows: updateAffectedRows }];
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
    query: connection.query.bind(connection)
  };
  const service = new CustomerSettingsService({
    database,
    time: { nowMs: () => 100 },
    authorize: async () => ({ id: 1, username: "sam" }),
    audit: { async record(_connection, input) { events.push(["audit", input]); } }
  });
  return { service, connection, events, row };
}

const context = {
  actorId: 1,
  claimedRoles: [],
  claimedPermissions: ["customer.view", "customer.settings"],
  reason: "公司開始要求客戶啟用覆核",
  requestId: "req-1",
  ip: "127.0.0.1"
};

test("Customer settings returns the typed singleton and fails closed when it is absent", async () => {
  const { service } = harness({ requireActivationApproval: 1, version: 4 });
  assert.deepEqual(await service.getSettings(context), {
    requireActivationApproval: true, version: 4, updatedAt: 10, updatedBy: null
  });
  await assert.rejects(
    () => harness({ missingRow: true }).service.getSettings(context),
    (error) => error.publicCode === "CUSTOMER_SETTINGS_MISSING"
  );
});

test("Customer settings updates by CAS and records only the typed before/after value", async () => {
  const { service, events } = harness({ version: 4 });
  assert.deepEqual(
    await service.updateSettings({ ...context, version: 4, requireActivationApproval: true }),
    { requireActivationApproval: true, version: 5, updatedAt: 100, updatedBy: 1 }
  );
  const [, audit] = events.find(([kind]) => kind === "audit");
  assert.equal(audit.action, "setting.update");
  assert.deepEqual(audit.detail, {
    before: { requireActivationApproval: false },
    after: { requireActivationApproval: true }
  });
  assert.equal(events.some(([, sql = ""]) => /\bcustomers\b|customer_activation_requests/u.test(sql)), false);
});

test("Customer settings rejects stale versions, unknown fields and missing reasons without auditing", async () => {
  const stale = harness({ version: 4 });
  await assert.rejects(
    () => stale.service.updateSettings({ ...context, version: 3, requireActivationApproval: true }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(stale.events.some(([kind]) => kind === "audit"), false);

  const invalid = harness();
  await assert.rejects(
    () => invalid.service.updateSettings({ ...context, version: 1, requireActivationApproval: true, unapprovedSetting: true }),
    (error) => error.publicCode === "CUSTOMER_SETTING_UNKNOWN"
  );
  await assert.rejects(
    () => invalid.service.updateSettings({ ...context, reason: " ", version: 1, requireActivationApproval: true }),
    (error) => error.publicCode === "CUSTOMER_REASON_REQUIRED"
  );
  assert.equal(invalid.events.length, 0);
});

test("activation policy is stable inside its transaction and never guesses when the singleton is absent", async () => {
  const { connection, events } = harness({ requireActivationApproval: 1 });
  assert.equal(await getCustomerActivationPolicy(connection), true);
  assert.match(events.find(([kind]) => kind === "query")[1], /FOR SHARE/u);
  await assert.rejects(
    () => getCustomerActivationPolicy(harness({ missingRow: true }).connection),
    (error) => error.publicCode === "CUSTOMER_SETTINGS_MISSING"
  );
});
