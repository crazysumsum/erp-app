import assert from "node:assert/strict";
import test from "node:test";
import { SalesSequenceService } from "../../../src/modules/sales/SalesSequenceService.js";
import { SystemTimeService } from "../../../src/services/time/SystemTimeService.js";

const time = new SystemTimeService({ config: { application: { timeZone: "Asia/Hong_Kong" } } });
test("TC-013 Sequence uses HKT month and allocates SO/QT through caller transaction", async () => {
  const calls = [], tx = { async execute(sql, args) { calls.push({ sql, args }); return [{ affectedRows: 1 }]; },
    async query(sql, args) { calls.push({ sql, args }); return [[{ next_value: 7 }]]; } };
  const service = new SalesSequenceService({ time });
  const nowMs = Date.parse("2026-09-30T16:00:00Z");
  assert.equal(await service.nextNumberInTransaction(tx, { documentType: "QUOTATION", nowMs }), "QT-202610-000007");
  assert.deepEqual(calls[0].args, ["QUOTATION", "202610", nowMs]);
  assert.match(calls[1].sql, /FOR UPDATE/u);
  assert.equal(await service.nextNumberInTransaction(tx, { documentType: "SALES_ORDER", nowMs }), "SO-202610-000007");
});
test("TC-013 Sequence refuses exhaustion and invalid allocation inputs before increment", async () => {
  const service = new SalesSequenceService({ time });
  let writes = 0;
  const tx = { async execute() { writes++; return [{ affectedRows: 1 }]; }, async query() { return [[{ next_value: 1000000 }]]; } };
  await assert.rejects(() => service.nextNumberInTransaction(tx, { documentType: "SALES_ORDER", nowMs: 0 }), { code: "SALES_SEQUENCE_EXHAUSTED" });
  assert.equal(writes, 1);
  for (const input of [{ documentType: "UNKNOWN", nowMs: 0 }, { documentType: "QUOTATION", nowMs: NaN }])
    await assert.rejects(() => service.nextNumberInTransaction(tx, input), TypeError);
  assert.equal(writes, 1);
});
test("TC-013 Sales business month stays HKT when the application clock timezone is UTC", async () => {
  const utc = new SystemTimeService({ config: { application: { timeZone: "UTC" } } });
  const tx = { async execute() { return [{ affectedRows: 1 }]; }, async query() { return [[{ next_value: 1 }]]; } };
  assert.equal(await new SalesSequenceService({ time: utc }).nextNumberInTransaction(tx,
    { documentType: "QUOTATION", nowMs: Date.parse("2026-09-30T16:00:00Z") }), "QT-202610-000001");
});

test("TC-034 Import batch uses existing transactional HKT allocation", async () => {
  const tx = { async execute() { return [{ affectedRows: 1 }]; }, async query() { return [[{ next_value: 7 }]]; } };
  assert.equal(await new SalesSequenceService({ time }).nextNumberInTransaction(tx,
    { documentType: "IMPORT_BATCH", nowMs: Date.parse("2026-09-30T16:00:00Z") }), "SI-202610-000007");
});
