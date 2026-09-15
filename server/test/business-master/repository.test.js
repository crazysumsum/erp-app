import assert from "node:assert/strict";
import test from "node:test";

import { BusinessMasterAuditLogService } from "../../src/modules/businessMaster/BusinessMasterAuditLogService.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";

test("TC-003 list query keeps user search and sort values out of SQL", async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/COUNT/.test(sql)) return [[{ total: 0 }]];
      return [[]];
    }
  };
  const repository = new BusinessMasterRepository();
  const result = await repository.listCurrencies(database, {
    q: "USD%' OR 1=1 --",
    status: "ACTIVE",
    sort: "name",
    page: 1,
    pageSize: 20
  });
  assert.equal(result.total, 0);
  assert.equal(calls.every((call) => !call.sql.includes("OR 1=1")), true);
  assert.equal(calls[0].params.includes("USD!%' OR 1=1 --%"), true);
  assert.match(calls[0].sql, /LIKE \? ESCAPE '!'/);

  calls.length = 0;
  await repository.listPaymentTerms(database, { q: "net_%!", page: 1, pageSize: 20 });
  assert.equal(calls[0].params.includes("NET!_!%!!%"), true);
  assert.match(calls[0].sql, /LIKE \? ESCAPE '!'/);
});

test("TC-004 currency CAS updates only allowlisted columns and returns mapped projection", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async query(sql) {
      calls.push({ sql, params: [] });
      return [[{ code: "USD", name: "Dollar", decimal_places: 2, status: "ACTIVE", version: 3, created_at: 1, updated_at: 2 }]];
    }
  };
  const repository = new BusinessMasterRepository();
  const updated = await repository.updateCurrency(connection, {
    code: "USD",
    version: 2,
    changes: { name: "Dollar", status: "ACTIVE", injected: "no" },
    actorId: 9,
    nowMs: 2
  });
  assert.equal(updated.version, 3);
  assert.equal(updated.decimalPlaces, 2);
  assert.equal(calls[0].sql.includes("injected"), false);
  assert.deepEqual(calls[0].params.slice(-2), ["USD", 2]);
});

test("TC-014 audit insert contains only the explicit catalog snapshots and hashed idempotency key", async () => {
  const calls = [];
  const audit = new BusinessMasterAuditLogService();
  await audit.record({ async execute(sql, params) { calls.push({ sql, params }); return [{ insertId: 1 }]; } }, {
    entityType: "CURRENCY",
    entityKey: "USD",
    action: "UPDATE",
    result: "SUCCESS",
    before: { code: "USD", name: "Old", password: "must-not-appear" },
    after: { code: "USD", name: "New", token: "must-not-appear" },
    impact: null,
    reason: "ordinary update",
    actorUserId: 9,
    correlationId: "req-1",
    idempotencyKeyHash: "a".repeat(64),
    createdAt: 5
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[3], "SUCCESS");
  assert.deepEqual(JSON.parse(calls[0].params[4]), { code: "USD", name: "Old" });
  assert.deepEqual(JSON.parse(calls[0].params[5]), { code: "USD", name: "New" });
  assert.equal(calls[0].params[10], "a".repeat(64));
});
