import assert from "node:assert/strict";
import test from "node:test";

import { up as createCustomerOperationRequests } from "../database/migrations/0043_create_customer_operation_requests.js";
import { CustomerOperationService } from "../src/modules/customer/CustomerOperationService.js";
import { CustomerService } from "../src/modules/customer/CustomerService.js";

test("TC-010 creates the durable Customer operation table with actor-scoped idempotency", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes("information_schema.columns")) return [[]];
      return [[]];
    }
  };
  await createCustomerOperationRequests(connection);
  const ddl = calls.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS customer_operation_requests"));
  assert.match(ddl, /UNIQUE KEY uq_customer_operation_requests_idempotency \(actor_user_id, route_key, idempotency_key\)/);
  assert.match(ddl, /payload_hash\s+BINARY\(32\) NOT NULL/);
  assert.match(ddl, /FOREIGN KEY \(actor_user_id\) REFERENCES users \(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(ddl, /DELETE FROM|DROP TABLE/);
});

test("TC-010 reuses only a matching actor-scoped operation payload", async () => {
  const operations = new CustomerOperationService();
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).startsWith("INSERT INTO customer_operation_requests")) {
        const error = new Error("duplicate");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      return [{}];
    },
    async query() {
      return [[{
        id: "3c7b8d79-3249-4d51-b0be-1bc4d975b2aa",
        payload_hash: calls[0].params[4], status: "succeeded", resource_type: "customer",
        resource_id: 42, result_version: 2, error_code: ""
      }]];
    }
  };
  const replay = await operations.begin(connection, {
    actorId: 9, routeKey: "customer.create", idempotencyKey: "create-1",
    payload: { legalName: "Acme", categoryId: null }, nowMs: 1
  });
  assert.equal(replay.replay.resourceId, 42);
  assert.equal(replay.replay.status, "succeeded");

  await assert.rejects(
    () => operations.begin(connection, {
      actorId: 9, routeKey: "customer.create", idempotencyKey: "create-1",
      payload: { legalName: "Other" }, nowMs: 1
    }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("TC-011 accepts the approved high-risk lifecycle route keys", async () => {
  const operations = new CustomerOperationService();
  const connection = { async execute() { return [{}]; } };
  for (const routeKey of ["customer.code_change", "customer.activate", "customer.suspend", "customer.reactivate", "customer.archive", "customer.restore", "customer.delete"]) {
    await operations.begin(connection, { actorId: 9, routeKey, idempotencyKey: routeKey, payload: { id: 42 }, nowMs: 1 });
  }
});

test("TC-012 creates a Draft Customer, audit event and durable result in one transaction", async () => {
  const calls = [];
  const row = {
    id: 42, customer_code: "CUS-042", legal_name: "Acme Limited", trading_name: "Acme",
    default_currency_code: null, default_payment_term_id: null, account_manager_user_id: null,
    category_id: null, industry_id: null, territory_id: null, website: "", general_phone: "",
    general_email: "", notes: "", status: "draft", ever_activated_at: null, version: 1,
    created_at: 1000, updated_at: 1000, created_by: 9, updated_by: 9
  };
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("INSERT INTO customers")) return [{ insertId: 42 }];
      return [{}];
    },
    async query(sql) {
      if (String(sql).includes("FROM customers WHERE id")) return [[row]];
      return [[]];
    }
  };
  const service = new CustomerService({
    database: { withTransaction: async (work) => work(connection) },
    time: { nowMs: () => 1000 },
    actorVerifier: async () => ({ username: "sam" }),
    businessMaster: {
      async assertCurrencyUsableInTransaction() {},
      async assertPaymentTermUsableInTransaction() {}
    }
  });
  const result = await service.create({
    actorId: 9, claimedRoles: [], claimedPermissions: [], idempotencyKey: "create-42",
    requestId: "request-42", ip: "127.0.0.1", customerCode: " CUS-042 ", legalName: " Acme Limited ", tradingName: " Acme "
  });
  assert.equal(result.customer.id, 42);
  assert.equal(result.customer.status, "draft");
  assert.match(result.operation.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(calls.filter((call) => call.sql.startsWith("INSERT INTO customer_operation_requests")).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith("INSERT INTO customers")).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith("INSERT INTO customer_audit_logs")).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith("UPDATE customer_operation_requests")).length, 1);
});
