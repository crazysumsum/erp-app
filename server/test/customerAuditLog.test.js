import assert from "node:assert/strict";
import test from "node:test";

import { up as createCustomerAuditLog } from "../database/migrations/0032_create_customer_audit_logs.js";
import { CustomerAuditLogService } from "../src/modules/customer/CustomerAuditLogService.js";

test("TC-009 creates the append-only Customer audit table with investigative indexes", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes("information_schema.columns")) return [[]];
      return [[]];
    }
  };

  await createCustomerAuditLog(connection);

  const ddl = calls.find((sql) => /CREATE TABLE IF NOT EXISTS customer_audit_logs/.test(sql));
  assert.match(ddl, /detail\s+JSON\s+NULL/);
  assert.match(ddl, /KEY idx_customer_audit_logs_customer \(customer_id, occurred_at, id\)/);
  assert.match(ddl, /KEY idx_customer_audit_logs_target \(target_type, target_id, occurred_at, id\)/);
  assert.match(ddl, /FOREIGN KEY \(actor_user_id\) REFERENCES users \(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(ddl, /ON UPDATE|ON DELETE CASCADE/);
});

test("TC-009 rejects an incompatible adopted audit table before issuing DDL", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql).includes("information_schema.columns")) {
        return [[{
          column_name: "detail",
          column_type: "longtext",
          is_nullable: "YES",
          collation_name: "utf8mb4_unicode_ci"
        }]];
      }
      return [[]];
    }
  };

  await assert.rejects(
    () => createCustomerAuditLog(connection),
    /Incompatible existing Customer audit schema: customer_audit_logs/
  );
  assert.equal(calls.some((sql) => /CREATE TABLE/.test(sql)), false);
});

test("TC-009 writes only allowlisted, bounded audit detail through the caller transaction", async () => {
  const calls = [];
  const service = new CustomerAuditLogService();
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ insertId: 1 }];
    }
  };

  await service.record(connection, {
    occurredAt: 1_757_808_000_000,
    actorUserId: 7,
    actorUsername: "sam",
    action: "customer.create",
    targetType: "customer",
    targetId: 9,
    customerId: 9,
    targetLabel: "CUS-001",
    reason: "initial import",
    detail: {
      before: { legalName: "Old", notes: "must-not-leak" },
      after: { legalName: "New", notes: "must-not-leak" },
      arbitrary: "must-not-leak"
    },
    requestId: "request-1",
    ip: "127.0.0.1"
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^INSERT INTO customer_audit_logs/);
  const detail = JSON.parse(calls[0].params[9]);
  assert.deepEqual(detail, { before: { legalName: "Old" }, after: { legalName: "New" } });
  assert.doesNotMatch(calls[0].params[9], /notes|arbitrary/);
});

test("TC-009 fails the business transaction when an audit detail exceeds its bounded representation", async () => {
  const service = new CustomerAuditLogService();
  const connection = { async execute() { throw new Error("must not write"); } };

  await assert.rejects(
    () => service.record(connection, {
      occurredAt: 1,
      actorUsername: "sam",
      action: "customer.create",
      targetType: "customer",
      targetLabel: "CUS-001",
      detail: { after: { legalName: "x".repeat(9_000) } }
    }),
    /Customer audit detail exceeds 8192 bytes/
  );
});
