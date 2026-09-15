import assert from "node:assert/strict";
import test from "node:test";

import { SupplierAuditLogService } from "../src/modules/supplier/SupplierAuditLogService.js";

function service(overrides = {}) {
  return new SupplierAuditLogService({
    database: overrides.database ?? { async query() { return [[]]; } },
    time: { nowMs: () => 1234 },
    authorize: overrides.authorize ?? (async () => ({ id: 1 })),
    logger: { warn() {} }
  });
}

test("audit writer uses only the caller connection and writes an allowlisted bounded detail", async () => {
  const calls = [];
  const connection = { async execute(sql, params) { calls.push([sql, params]); } };
  await service().record(connection, {
    actorUserId: 1,
    actorUsername: "sam",
    action: "supplier.update",
    targetType: "supplier",
    targetId: 7,
    supplierId: 7,
    targetLabel: "SUP-7",
    detail: { before: { supplierName: "Old" }, after: { supplierName: "New" } },
    requestId: "req-1",
    ip: "127.0.0.1"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO supplier_audit_logs/u);
  assert.deepEqual(JSON.parse(calls[0][1][9]), { before: { supplierName: "Old" }, after: { supplierName: "New" } });
});

test("audit writer rejects unknown actions, unknown detail keys and Bank-sensitive fields", async () => {
  const connection = { async execute() { throw new Error("must not write"); } };
  await assert.rejects(() => service().record(connection, { action: "unknown", targetType: "supplier" }), /Unsupported Supplier audit action/u);
  await assert.rejects(() => service().record(connection, { action: "supplier.update", targetType: "supplier", detail: { surprise: true } }), /detail key/u);
  await assert.rejects(() => service().record(connection, { action: "supplier.update", targetType: "supplier", detail: { after: { accountNumber: "123" } } }), /sensitive/u);
});

test("audit query revalidates actor and escapes user LIKE input", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push([sql, params]);
      return sql.includes("COUNT") ? [[{ total: 0 }]] : [[]];
    }
  };
  const auth = [];
  const audit = service({ database, authorize: async (input) => auth.push(input) });
  assert.deepEqual(await audit.list({ actorId: 2, claimedRoles: [], claimedPermissions: ["supplier.view"], actor: "%_", page: 1, pageSize: 20 }), {
    items: [], total: 0, page: 1, pageSize: 20
  });
  assert.equal(auth.length, 1);
  assert.equal(queries[0][1][0], "%\\%\\_%");
});
