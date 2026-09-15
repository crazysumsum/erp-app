import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { SupplierAuditLogService } from "../../src/modules/supplier/SupplierAuditLogService.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function config() {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

integrationTest("Supplier audit follows its caller transaction and committed rows remain queryable", async (t) => {
  const pool = mysql.createPool({ ...config(), connectionLimit: 3 });
  const requestId = `supplier-audit-${Date.now()}`;
  t.after(async () => {
    await pool.query("DELETE FROM supplier_audit_logs WHERE request_id = ?", [requestId]);
    await pool.end();
  });
  const audit = new SupplierAuditLogService({
    database: pool,
    time: { nowMs: () => Date.now() },
    logger: { warn() {} },
    authorize: async () => ({ id: 1 })
  });

  const rolledBack = await pool.getConnection();
  await rolledBack.beginTransaction();
  await audit.record(rolledBack, { actorUsername: "integration", action: "supplier.update", targetType: "supplier", targetId: 99, supplierId: 99, targetLabel: "ROLLBACK", requestId });
  await rolledBack.rollback();
  rolledBack.release();
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS total FROM supplier_audit_logs WHERE request_id = ?", [requestId]))[0][0].total), 0);

  const committed = await pool.getConnection();
  await committed.beginTransaction();
  await audit.record(committed, { actorUsername: "integration", action: "supplier.update", targetType: "supplier", targetId: 99, supplierId: 99, targetLabel: "COMMIT", requestId });
  await committed.commit();
  committed.release();
  const result = await audit.list({ actorId: 1, claimedRoles: [], claimedPermissions: ["supplier.view"], target: "COMMIT" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].requestId, requestId);
});
