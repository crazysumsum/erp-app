import assert from "node:assert/strict";
import test from "node:test";

import { SupplierRelationService } from "../src/modules/supplier/SupplierRelationService.js";

const time = { nowMs: () => 1_000 };
const logged = [];
const logger = { error: (event, message, context) => logged.push({ event, context }), warn() {}, info() {} };
const sku = { skuId: 5, skuCode: "SKU-5", usable: true, reasons: [] };

function service({ withTransaction, items = { findById: async () => sku } } = {}) {
  return new SupplierRelationService({ database: { query: async () => [[]], withTransaction }, logger, time, items,
    authorize: async () => ({ username: "tester" }), audit: { async record() {} }, verifySource: async () => {} });
}

const command = { eventId: "GR-1", sourceType: "goods_receipt", sourceId: 1, sourceLineId: 1, supplierId: 2, skuId: 5, suppliedAt: 10 };
const deadlock = () => Object.assign(new Error("MySQL database transaction failed"), { cause: Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK" }) });

test("TASK-038 (REV-085 H2): a deadlocked projection is retried whatever the message says, and gives up after three tries", async () => {
  let calls = 0;
  const flaky = service({ withTransaction: async () => {
    calls += 1;
    if (calls === 1) throw deadlock();
    return { eventId: "GR-1", relationId: 9, replayed: false };
  } });
  assert.deepEqual(await flaky.recordSupply(command), { eventId: "GR-1", relationId: 9, replayed: false });
  assert.equal(calls, 2);

  calls = 0;
  logged.length = 0;
  const stuck = service({ withTransaction: async () => { calls += 1; throw deadlock(); } });
  await assert.rejects(() => stuck.recordSupply(command));
  assert.equal(calls, 3);
  // 投影失敗要告警（設計 §6.8），只帶 ID 同代碼。
  assert.deepEqual(logged.map(({ event, context }) => [event, context.eventId, context.sourceId, context.code]),
    [["supplier.sku.supply_failed", "GR-1", 1, "ER_LOCK_DEADLOCK"]]);
});

test("TASK-038: relation fields refuse an unknown status and control characters before touching the database", async () => {
  const untouched = service({ withTransaction: async () => { throw new Error("must not open a transaction"); } });
  const base = { actorId: 1, supplierId: 2, skuId: 5 };
  await assert.rejects(() => untouched.create({ ...base, relationshipStatus: "whitelisted" }),
    (error) => error.publicCode === "SUPPLIER_SKU_RELATION_INVALID" && error.details?.field === "relationshipStatus");
  for (const field of ["supplierItemCode", "supplierItemName"]) {
    await assert.rejects(() => untouched.create({ ...base, [field]: "bell\u0007" }),
      (error) => error.publicCode === "SUPPLIER_SKU_RELATION_INVALID" && error.details?.field === field, field);
  }
});

test("TASK-038 (REV-086 Info): an invalid command and a failed Item lookup are logged as failed projections too", async () => {
  logged.length = 0;
  const invalid = service({ withTransaction: async () => { throw new Error("must not run"); } });
  await assert.rejects(() => invalid.recordSupply({ ...command, sourceType: "invoice" }));
  const itemDown = service({ withTransaction: async () => { throw new Error("must not run"); },
    items: { findById: async () => { throw new Error("item lookup down"); } } });
  await assert.rejects(() => itemDown.recordSupply(command), /item lookup down/u);
  assert.deepEqual(logged.map(({ event, context }) => [event, context.eventId, context.code]), [
    ["supplier.sku.supply_failed", null, "SUPPLIER_SUPPLY_INVALID"],
    ["supplier.sku.supply_failed", "GR-1", "unknown"]
  ]);
});
