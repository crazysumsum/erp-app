import assert from "node:assert/strict";
import test from "node:test";

import { CustomerApprovalService } from "../src/modules/customer/CustomerApprovalService.js";

function harness({ approvalEnabled = true, approverId = 9, approverPermissions = ["customer.approval"], customerStatus = "draft", duplicateSubmit = false } = {}) {
  const events = [];
  const customer = {
    id: 4, customer_code: "CUS-004", customer_code_key: "cus004", legal_name: "Demo Customer",
    legal_name_key: "democustomer", default_currency_code: "HKD", status: customerStatus, version: 3
  };
  const request = { id: 8, customer_id: 4, requested_by: 2, assigned_approver_id: approverId, status: "pending", version: 1 };
  const connection = {
    async query(sql, params) {
      const text = String(sql);
      events.push(["query", text, params]);
      if (text.includes("FROM customer_settings")) return [[{ require_activation_approval: approvalEnabled ? 1 : 0, version: 5 }]];
      if (text.includes("FROM customers")) return [[customer]];
      if (text.includes("FROM customer_identifiers")) return [[{ identifier_type: "tax", issuer_country_code: "HK", identifier_value_key: "HK123" }]];
      if (text.includes("FROM customer_credit_profiles")) return [[{ credit_status: "on_hold" }]];
      if (text.includes("FROM users")) return [[{ id: approverId, username: "approver" }]];
      if (text.includes("FROM customer_activation_requests")) return [[request]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", String(sql), params]);
      if (String(sql).includes("INSERT INTO customer_activation_requests")) {
        if (duplicateSubmit) throw Object.assign(new Error("duplicate pending request"), { code: "ER_DUP_ENTRY" });
        return [{ insertId: 8 }];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerApprovalService({
    database: { withTransaction: (work) => work(connection) }, time: { nowMs: () => 100 },
    authorize: async () => ({ id: 2, username: "requester", permissions: ["customer.view", "customer.mgmt"] }),
    loadPermissions: async () => approverPermissions,
    audit: { async record(_connection, input) { events.push(["audit", input]); } }
  });
  return { service, events, customer, request, connection };
}

const input = {
  actorId: 2, claimedRoles: [], claimedPermissions: ["customer.view", "customer.mgmt"], customerId: 4,
  approverUserId: 9, requestNote: "請覆核客戶啟用", requestId: "req-1", ip: "127.0.0.1"
};

test("approval submit locks settings then Customer, records an immutable safe snapshot and moves Draft to pending", async () => {
  const { service, events } = harness();
  const result = await service.submit(input);
  assert.deepEqual(result, { id: 8, customerId: 4, customerStatus: "pending_approval", status: "pending", version: 1 });
  const queried = events.filter(([kind]) => kind === "query").map(([, sql]) => sql);
  assert.match(queried[0], /customer_settings.*FOR SHARE/us);
  assert.match(queried[1], /customers.*FOR UPDATE/us);
  const insert = events.find(([kind, sql]) => kind === "execute" && sql.includes("INSERT INTO customer_activation_requests"));
  assert.match(insert[1], /VALUES \(\?, \?, \?, \?, \?, CAST\(\? AS JSON\), 1, \?, 'pending'/u, "request snapshots approval ON");
  assert.equal(insert[2][6], 5, "request snapshots settings version");
  assert.equal(Buffer.isBuffer(insert[2][4]), true, "critical hash is binary SHA-256");
  const summary = JSON.parse(insert[2][5]);
  assert.equal(JSON.stringify(summary).includes("bank"), false);
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "approval.submit");
});

test("approval submit rejects self, disabled and unauthorized approvers before changing Customer state", async () => {
  for (const config of [
    { approverId: 2 },
    { approverPermissions: [] },
    { approvalEnabled: false }
  ]) {
    const { service, events } = harness(config);
    await assert.rejects(() => service.submit({ ...input, approverUserId: config.approverId ?? input.approverUserId }), (error) => /APPROVER|APPROVAL_REQUIRED/u.test(error.publicCode));
    assert.equal(events.some(([kind]) => kind === "execute"), false);
  }
});

test("concurrent second submit is a stable conflict and never changes Customer state", async () => {
  const { service, events } = harness({ duplicateSubmit: true });
  await assert.rejects(() => service.submit(input), (error) => error.publicCode === "APPROVAL_REQUEST_OPEN");
  assert.equal(events.some(([kind, sql]) => kind === "execute" && sql.includes("UPDATE customers SET status")), false);
});

test("withdraw is scoped to the Customer and only the requester can return the pending request to Draft", async () => {
  const { service, events, request } = harness({ customerStatus: "pending_approval" });
  const result = await service.withdraw({ ...input, approvalRequestId: 8, version: 1 });
  assert.deepEqual(result, { id: 8, customerId: 4, customerStatus: "draft", status: "withdrawn", version: 2 });
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "approval.withdraw");
  request.customer_id = 5;
  await assert.rejects(() => service.withdraw({ ...input, approvalRequestId: 8, version: 1 }), (error) => error.publicCode === "CUSTOMER_NOT_FOUND");
});

test("critical edits invalidate the only pending request and return the locked Customer to Draft", async () => {
  const { service, events, customer, connection } = harness({ customerStatus: "pending_approval" });
  assert.equal(await service.invalidateForCriticalChange(connection, {
    customer, actorId: 2, actorUsername: "requester", reason: "變更法定名稱", requestId: "req-1", ip: "127.0.0.1"
  }), true);
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "approval.invalidate");
  assert.ok(events.some(([kind, sql]) => kind === "execute" && sql.includes("status = 'draft'")));
});
