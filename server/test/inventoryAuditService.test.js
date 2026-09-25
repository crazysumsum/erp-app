import assert from "node:assert/strict";
import test from "node:test";

import { InventoryAuditService } from "../src/modules/inventory/InventoryAuditService.js";

const NOW_MS = 1_700_000_000_000;

function input(overrides = {}) {
  return {
    actorUserId: 7,
    actorLabel: "sam",
    action: "receipt.post",
    targetType: "movement_group",
    targetId: 44,
    targetLabel: "MG-44",
    reasonCategory: "",
    reasonText: "",
    beforeSummary: { status: "READY", version: 1 },
    afterSummary: { status: "POSTED", version: 2 },
    operationRequestId: 91,
    requestId: "request-1",
    correlationId: "correlation-1",
    ip: "203.0.113.7",
    errorCode: "",
    ...overrides
  };
}

function logger() {
  const entries = [];
  return {
    entries,
    async error(event, message, context) { entries.push({ event, message, context }); }
  };
}

test("InventoryAuditService writes required success audit on the caller transaction", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ insertId: 5 }];
    }
  };
  const untouchedDatabase = {
    async withTransaction() { throw new Error("success audit must not open another transaction"); }
  };
  const service = new InventoryAuditService({
    database: untouchedDatabase,
    logger: logger(),
    time: { nowMs: () => NOW_MS }
  });

  await service.recordSucceeded(connection, input());

  assert.match(calls[0].sql, /INSERT INTO inventory_audit_logs/);
  assert.deepEqual(calls[0].params.slice(0, 5), [NOW_MS, 7, "sam", "receipt.post", "movement_group"]);
  assert.equal(calls[0].params[7], "SUCCEEDED");
  assert.equal(calls[0].params[10], JSON.stringify({ status: "READY", version: 1 }));
  assert.equal(calls[0].params[11], JSON.stringify({ status: "POSTED", version: 2 }));
  assert.equal(calls[0].params[12], 91);
});

test("InventoryAuditService propagates required success audit failure", async () => {
  const expected = new Error("audit insert failed");
  const service = new InventoryAuditService({
    database: { async withTransaction() {} }, logger: logger(), time: { nowMs: () => NOW_MS }
  });

  await assert.rejects(
    () => service.recordSucceeded({ async execute() { throw expected; } }, input()),
    (error) => error === expected
  );
});

test("InventoryAuditService rejects non-allowlisted actions and summaries", async () => {
  const service = new InventoryAuditService({
    database: { async withTransaction() {} }, logger: logger(), time: { nowMs: () => NOW_MS }
  });
  const connection = { async execute() {} };

  await assert.rejects(
    () => service.recordSucceeded(connection, input({ action: "receipt.run_sql" })),
    /Unsupported Inventory audit action/
  );
  await assert.rejects(
    () => service.recordSucceeded(connection, input({ afterSummary: { password: "secret" } })),
    /Unsupported Inventory audit summary field password/
  );
  await assert.rejects(
    () => service.recordSucceeded(connection, input({ afterSummary: { status: { rawPayload: "hidden" } } })),
    /Inventory audit summary field status must be scalar/
  );
});

test("InventoryAuditService records rejection and failure after rollback without a success projection", async () => {
  const calls = [];
  const database = {
    async withTransaction(work) {
      return work({
        async execute(sql, params) {
          calls.push({ sql: String(sql), params });
          return [{ insertId: 6 }];
        }
      });
    }
  };
  const service = new InventoryAuditService({
    database, logger: logger(), time: { nowMs: () => NOW_MS }
  });

  assert.equal(await service.recordRejected(input({ errorCode: "VERSION_CONFLICT" })), true);
  assert.equal(await service.recordFailed(input({ errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE" })), true);
  assert.equal(calls[0].params[7], "REJECTED");
  assert.equal(calls[0].params[11], null);
  assert.equal(calls[0].params[12], null);
  assert.equal(calls[1].params[7], "FAILED");
  assert.equal(calls[1].params[11], null);
  assert.equal(calls[1].params[12], null);
});

test("InventoryAuditService falls back to a safe structured log when failure audit cannot be written", async () => {
  const auditLogger = logger();
  const databaseError = Object.assign(new Error("SQL contains secret-password"), { code: "ER_LOCK_WAIT_TIMEOUT" });
  const service = new InventoryAuditService({
    database: { async withTransaction() { throw databaseError; } },
    logger: auditLogger,
    time: { nowMs: () => NOW_MS }
  });

  const recorded = await service.recordFailed(input({
    errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE",
    reasonText: "secret-password",
    targetLabel: "private-source-id"
  }));

  assert.equal(recorded, false);
  assert.equal(auditLogger.entries.length, 1);
  assert.equal(auditLogger.entries[0].event, "inventory.audit.write_failed");
  assert.deepEqual(auditLogger.entries[0].context, {
    action: "receipt.post",
    targetType: "movement_group",
    targetId: 44,
    actorUserId: 7,
    requestId: "request-1",
    correlationId: "correlation-1",
    outcome: "FAILED",
    errorCode: "INVENTORY_DEPENDENCY_UNAVAILABLE",
    databaseErrorCode: "ER_LOCK_WAIT_TIMEOUT"
  });
  assert.doesNotMatch(JSON.stringify(auditLogger.entries), /secret-password|private-source-id/);
});
