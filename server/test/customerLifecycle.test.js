import assert from "node:assert/strict";
import test from "node:test";

import { CustomerService } from "../src/modules/customer/CustomerService.js";

function row(status = "draft") {
  return {
    id: 4, customer_code: "CUS-004", customer_code_key: "cus-004", legal_name: "Demo Customer",
    legal_name_key: "demo customer", trading_name: "", default_currency_code: "HKD",
    default_payment_term_id: null, account_manager_user_id: null, category_id: null, industry_id: null,
    territory_id: null, website: "", general_phone: "", general_email: "", notes: "", status,
    ever_activated_at: null, version: 3, created_at: 1, updated_at: 1, created_by: 2, updated_by: 2
  };
}

function harness({ approval = false, status = "draft", referenceStatus = "NO_REFERENCE", operationReplay = null, approvalRequest = null } = {}) {
  const customer = row(status);
  const events = [];
  const connection = {
    async query(sql) {
      const text = String(sql);
      events.push(["query", text]);
      if (text.includes("customer_settings")) return [[{ require_activation_approval: approval ? 1 : 0, version: 7 }]];
      if (text.includes("FROM customers")) return [[customer]];
      if (text.includes("customer_activation_requests")) return [approvalRequest ? [approvalRequest] : []];
      return [[]];
    },
    async execute(sql, params) {
      const text = String(sql);
      events.push(["execute", text, params]);
      if (text.includes("UPDATE customers SET status")) {
        customer.status = params[0];
        if (text.includes("ever_activated_at = COALESCE")) customer.ever_activated_at = params[1];
        customer.version += 1;
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("DELETE FROM customers")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }
  };
  const approvals = {
    async submitInTransaction(receivedConnection, input, context) {
      events.push(["approval", receivedConnection, input, context]);
      customer.status = "pending_approval";
      customer.version += 1;
      return { id: 9, customerId: 4, customerStatus: "pending_approval", status: "pending", version: 1 };
    }
  };
  const service = new CustomerService({
    database: { withTransaction: async (work) => work(connection) }, time: { nowMs: () => 100 },
    actorVerifier: async () => ({ username: "sam", permissions: ["customer.view", "customer.mgmt", "customer.approval"] }), audit: { async record(_connection, input) { events.push(["audit", input]); } },
    businessMaster: { async assertCurrencyUsableInTransaction(_connection, input) { events.push(["currency", input]); } },
    approvals,
    operations: {
      async begin(_connection, input) { events.push(["operation", input]); return { operationId: "11111111-1111-4111-8111-111111111111", replay: operationReplay }; },
      async succeed(_connection, input) { events.push(["operationSucceeded", input]); }
    },
    references: { async checkCustomerReferences() { events.push(["reference"]); return { status: referenceStatus, providers: [] }; } }
  });
  return { service, customer, events };
}

const input = { actorId: 2, claimedRoles: [], claimedPermissions: ["customer.view", "customer.mgmt"], id: 4, version: 3, idempotencyKey: "lifecycle-4", requestId: "request-1", ip: "127.0.0.1" };

test("TC-011 approval OFF activates Draft atomically and records first activation", async () => {
  const { service, customer, events } = harness();
  const result = await service.activate({ ...input });
  assert.equal(result.status, "active");
  assert.equal(customer.ever_activated_at, 100);
  assert.equal(events.find(([kind]) => kind === "currency")[1].code, "HKD");
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "customer.activate");
});

test("TC-011 approval ON submits the locked Draft through the approval aggregate", async () => {
  const { service, customer, events } = harness({ approval: true });
  const result = await service.activate({ ...input, approverUserId: 8, requestNote: "請覆核啟用" });
  assert.equal(result.customerStatus, "pending_approval");
  assert.equal(customer.status, "pending_approval");
  const approval = events.find(([kind]) => kind === "approval");
  assert.equal(approval[3].setting.version, 7);
  assert.equal(approval[3].customer, customer);
  assert.equal(events.find(([kind]) => kind === "operationSucceeded")[1].resultVersion, 4);
});

test("TC-011 approval activation replay returns the original approval request outcome", async () => {
  const { service, events } = harness({
    approval: true,
    operationReplay: { status: "succeeded", resourceType: "customer_activation_approval", resourceId: 4, resultVersion: 4 },
    approvalRequest: { id: 9 }
  });
  const result = await service.activate({ ...input, approverUserId: 8, requestNote: "請覆核啟用" });
  assert.deepEqual(result, { id: 9, customerId: 4, customerStatus: "pending_approval", status: "pending", version: 1 });
  assert.equal(events.some(([kind]) => kind === "approval"), false);
});

test("TC-011 direct activation replay returns the original Customer outcome", async () => {
  const { service, events } = harness({
    operationReplay: { status: "succeeded", resourceType: "customer", resourceId: 4, resultVersion: 4 }
  });
  const result = await service.activate({ ...input });
  assert.equal(result.id, 4);
  assert.equal(result.status, "draft");
  assert.equal(events.some(([kind, sql]) => kind === "query" && sql.includes("customer_activation_requests")), false);
});

test("TC-011 approval OFF rejects a superfluous approver before changing status", async () => {
  const { service, customer } = harness();
  await assert.rejects(
    () => service.activate({ ...input, approverUserId: 8 }),
    (error) => error.publicCode === "APPROVER_NOT_REQUIRED"
  );
  assert.equal(customer.status, "draft");
});

test("TC-011 lifecycle only allows named transitions and archive/delete fail closed on unknown references", async () => {
  const { service } = harness({ status: "active", referenceStatus: "UNKNOWN" });
  const suspended = await service.suspend({ ...input, reason: "暫停銷售使用" });
  assert.equal(suspended.status, "suspended");
  await assert.rejects(() => service.archive({ ...input, version: 4, reason: "封存舊客戶資料" }), (error) => error.publicCode === "CUSTOMER_REFERENCE_CHECK_UNAVAILABLE");
  await assert.rejects(() => service.deleteDraft({ ...input, version: 4, reason: "刪除未使用草稿" }), (error) => error.publicCode === "CUSTOMER_DELETE_NOT_ALLOWED");
});

test("TC-032 reference checks finish before the Customer row is locked", async () => {
  const { service, events } = harness({ status: "active" });
  await service.archive({ ...input, reason: "封存舊客戶資料" });
  assert.ok(events.findIndex(([kind]) => kind === "reference") < events.findIndex(([kind, sql]) => kind === "query" && sql.includes("FROM customers") && sql.includes("FOR UPDATE")));
});

test("TC-011 lifecycle commands bind a durable password-free outcome", async () => {
  const { service, events } = harness({ status: "active" });
  await service.suspend({ ...input, password: "not-stored", reason: "暫停銷售使用" });
  assert.deepEqual(events.find(([kind]) => kind === "operation")[1].payload, { id: 4, version: 3, reason: "暫停銷售使用" });
  assert.equal(events.find(([kind]) => kind === "operationSucceeded")[1].resultVersion, 4);
});

test("TC-011 lifecycle CAS rejects a stale command without an audit or state change", async () => {
  const { service, customer, events } = harness({ status: "active" });
  await assert.rejects(
    () => service.suspend({ ...input, version: 2, reason: "暫停銷售使用" }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(customer.status, "active");
  assert.equal(events.some(([kind]) => kind === "audit"), false);
});

test("TC-011 restore never restores an Archived Customer straight to Active", async () => {
  const { service } = harness({ status: "archived" });
  const result = await service.restore({ ...input, reason: "重新開放維護" });
  assert.equal(result.status, "suspended");
});

test("TC-038 block requires current approval permission and unblocks only to Suspended", async () => {
  const { service, customer, events } = harness({ status: "active" });
  const blocked = await service.block({ ...input, reason: "暫時停止交易" });
  assert.equal(blocked.status, "blocked");
  const unblocked = await service.unblock({ ...input, version: 4, reason: "解除交易限制" });
  assert.equal(unblocked.status, "suspended");
  assert.equal(events.find(([kind, detail]) => kind === "audit" && detail.action === "customer.block")[1].action, "customer.block");
  assert.equal(customer.status, "suspended");
});

test("TC-011 code correction is versioned, audited, and only available as a named command", async () => {
  const { service, events } = harness();
  await service.changeCode({ ...input, customerCode: "CUS-REVISED", reason: "修正輸入客戶代碼" });
  assert.match(events.find(([kind, sql]) => kind === "execute" && sql.includes("customer_code_key"))[1], /UPDATE customers SET customer_code/u);
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "customer.code_change");
});

test("TC-011 create with activation approval enabled creates one pending aggregate", async () => {
  const customer = row();
  const events = [];
  const connection = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("customer_settings")) return [[{ require_activation_approval: 1, version: 7 }]];
      if (text.includes("FROM customers")) return [[customer]];
      return [[]];
    },
    async execute(sql) {
      if (String(sql).includes("INSERT INTO customers")) return [{ insertId: 4 }];
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerService({
    database: { withTransaction: async (work) => work(connection) }, time: { nowMs: () => 100 },
    actorVerifier: async () => ({ username: "sam" }), audit: { async record() {} },
    operations: {
      async begin(_connection, input) { events.push({ operation: input }); return { operationId: "11111111-1111-4111-8111-111111111111", replay: null }; },
      async succeed() {}
    },
    businessMaster: { async assertCurrencyUsableInTransaction() {} },
    approvals: { async submitInTransaction(_connection, _input, context) { events.push(context); customer.status = "pending_approval"; customer.version = 2; return { id: 9 }; } }
  });
  const result = await service.create({
    actorId: 2, claimedRoles: [], claimedPermissions: ["customer.view", "customer.mgmt"], idempotencyKey: "create-4",
    requestId: "request-4", ip: "127.0.0.1", customerCode: "CUS-004", legalName: "Demo Customer",
    activate: true, approverUserId: 8, requestNote: "請覆核啟用"
  });
  assert.equal(result.customer.status, "pending_approval");
  assert.equal(events.find((event) => event.setting).setting.version, 7);
  assert.deepEqual(events.find((event) => event.operation).operation.payload, {
    customer: {
      customerCode: "CUS-004", customerCodeKey: "cus-004", legalName: "Demo Customer", legalNameKey: "demo customer",
      tradingName: "", tradingNameKey: null, defaultCurrencyCode: null, defaultPaymentTermId: null,
      accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null,
      website: "", generalPhone: "", generalEmail: "", notes: ""
    },
    activate: true, approverUserId: 8, requestNote: "請覆核啟用"
  });
});

test("TC-060 import create applies children, credit and the confirmed approval snapshot in one transaction", async () => {
  const customer = row(); customer.version = 1; const events = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes("customer_credit_profiles")) return [[]];
      if (String(sql).includes("FROM customers")) return [[customer]];
      return [[]];
    },
    async execute(sql) {
      const text = String(sql); events.push(["execute", text]);
      if (text.includes("INSERT INTO customers")) return [{ insertId: 4 }];
      if (text.includes("INSERT INTO customer_addresses")) return [{ insertId: 10 }];
      if (text.includes("INSERT INTO customer_contacts")) return [{ insertId: 20 }];
      return [{ affectedRows: 1, insertId: 30 }];
    }
  };
  const service = new CustomerService({
    database: {}, time: { nowMs: () => 100 }, audit: { async record(_connection, input) { events.push(["audit", input]); } },
    businessMaster: { async assertCurrencyUsableInTransaction() { events.push(["currency"]); } },
    approvals: { async submitInTransaction(_connection, input, context) { events.push(["approval", input, context]); } }
  });
  const payload = {
    root: { customerCode: "CUS-004", legalName: "Demo Customer", tradingName: "", defaultCurrencyCode: "HKD" },
    address: { label: "Office", recipientCompanyDepartment: "", addressLine1: "1 Main", addressLine2: "", addressLine3: "", city: "", stateRegion: "", postalCode: "", countryCode: "HK", phone: "", notes: "", sortOrder: 0, purposes: [{ code: "billing", isDefault: true }] },
    contact: { name: "Sam", jobTitle: "", department: "", email: "", phone: "", mobile: "", preferredLanguage: "", notes: "", sortOrder: 0, purposes: [{ code: "general", isDefault: true }] },
    identifier: { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "12-34", validFrom: null, expiresAt: null, notes: "" },
    credit: { creditLimit: "10.0000", creditCurrencyCode: "HKD", creditStatus: "normal" }
  };
  const result = await service.applyImportRowInTransaction(connection, {
    job: { activation_mode: "activate", approval_setting_value: 1, approval_setting_version: 7, approver_user_id: 8 },
    row: { operation: "create", normalized_payload: JSON.stringify(payload) },
    actor: { id: 2, username: "sam", permissions: ["customer.view", "customer.mgmt"] }, nowMs: 100
  });
  assert.equal(result, 4);
  assert.ok(events.some(([kind, sql]) => kind === "execute" && sql.includes("customer_address_purposes")));
  assert.ok(events.some(([kind, sql]) => kind === "execute" && sql.includes("customer_contact_purposes")));
  assert.ok(events.some(([kind, sql]) => kind === "execute" && sql.includes("customer_identifiers")));
  assert.ok(events.some(([kind, sql]) => kind === "execute" && sql.includes("customer_credit_profiles")));
  const approval = events.find(([kind]) => kind === "approval");
  assert.equal(approval[1].approverUserId, 8);
  assert.deepEqual(approval[2].setting, { require_activation_approval: 1, version: 7 });
});

test("TC-060 import update preserves omitted fields and uses the precheck Customer version", async () => {
  let customer = row(); const events = [];
  const connection = {
    async query(sql) { if (String(sql).includes("FROM customers")) return [[customer]]; return [[]]; },
    async execute(sql, params) {
      const text = String(sql); events.push([text, params]);
      if (text.includes("UPDATE customers SET legal_name")) customer = { ...customer, legal_name: params[0], legal_name_key: params[1], version: customer.version + 1 };
      return [{ affectedRows: 1 }];
    }
  };
  const service = new CustomerService({
    database: {}, time: { nowMs: () => 100 }, audit: { async record(_connection, input) { events.push(["audit", input]); } },
    businessMaster: { async assertCurrencyUsableInTransaction() {} },
    approvals: { async invalidateForCriticalChange(_connection, input) { events.push(["invalidate", input]); } }
  });
  const result = await service.applyImportRowInTransaction(connection, {
    job: { activation_mode: "draft" },
    row: { operation: "update", match_customer_id: 4, expected_customer_version: 3, normalized_payload: { root: { legalName: "Updated Customer" } } },
    actor: { id: 2, username: "sam", permissions: ["customer.view", "customer.mgmt"] }, nowMs: 100
  });
  assert.equal(result, 4);
  assert.equal(customer.legal_name, "Updated Customer");
  assert.ok(events.some(([kind]) => kind === "invalidate"));
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "customer.update");
});
