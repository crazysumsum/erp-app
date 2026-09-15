import assert from "node:assert/strict";
import test from "node:test";

import { SupplierBusinessMasterImpactChecker } from "../src/modules/supplier/SupplierBusinessMasterImpactChecker.js";

function databaseWith(...responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [responses.shift() ?? []];
    }
  };
}

test("reports NOT_INSTALLED only when the Supplier schema is absent", async () => {
  const database = databaseWith([{ present: 0 }]);
  const checker = new SupplierBusinessMasterImpactChecker({ database });

  assert.deepEqual(await checker.check({ entityType: "CURRENCY", entityKey: "HKD" }), {
    status: "NOT_INSTALLED",
    activeDefaultCount: 0,
    openUseCount: 0,
    historicalCount: 0,
    watermark: "not-installed:suppliers"
  });
  assert.equal(database.calls.length, 1);
});

test("returns bounded Currency reference counts and a data-drift watermark", async () => {
  const database = databaseWith(
    [{ present: 1 }],
    [{ active_default_count: 2, open_use_count: 3, historical_count: 4, total_count: 9, max_updated_at: 50, max_id: 12, version_sum: 17 }]
  );
  const checker = new SupplierBusinessMasterImpactChecker({ database });

  assert.deepEqual(await checker.check({ entityType: "CURRENCY", entityKey: " hkd " }), {
    status: "READY",
    activeDefaultCount: 2,
    openUseCount: 3,
    historicalCount: 4,
    watermark: "CURRENCY:HKD:9:2:3:4:50:12:17"
  });
  assert.deepEqual(database.calls[1].params, ["HKD"]);
  assert.match(database.calls[1].sql, /default_currency_code = \?/u);
});

test("uses the Payment Term foreign key and accepts zero references", async () => {
  const database = databaseWith(
    [{ present: 1 }],
    [{ active_default_count: 0, open_use_count: 0, historical_count: 0, total_count: 0, max_updated_at: 0, max_id: 0, version_sum: 0 }]
  );
  const checker = new SupplierBusinessMasterImpactChecker({ database });

  const result = await checker.check({ entityType: "PAYMENT_TERM", entityKey: "7" });
  assert.equal(result.status, "READY");
  assert.equal(result.watermark, "PAYMENT_TERM:7:0:0:0:0:0:0:0");
  assert.deepEqual(database.calls[1].params, [7]);
  assert.match(database.calls[1].sql, /default_payment_term_id = \?/u);
});

test("fails closed for malformed subjects or checker results", async () => {
  const checker = new SupplierBusinessMasterImpactChecker({ database: databaseWith([{ present: 1 }], [{ total_count: -1 }]) });

  await assert.rejects(() => checker.check({ entityType: "ITEM", entityKey: "HKD" }), TypeError);
  await assert.rejects(() => checker.check({ entityType: "PAYMENT_TERM", entityKey: "0" }), TypeError);
  await assert.rejects(() => checker.check({ entityType: "CURRENCY", entityKey: "HK" }), TypeError);
  await assert.rejects(() => checker.check({ entityType: "CURRENCY", entityKey: "HKD" }), TypeError);
});

test("fails closed when a referenced Supplier has an unclassified status", async () => {
  const database = databaseWith(
    [{ present: 1 }],
    [{ active_default_count: 1, open_use_count: 1, historical_count: 0, total_count: 3, max_updated_at: 50, max_id: 12, version_sum: 9 }]
  );
  const checker = new SupplierBusinessMasterImpactChecker({ database });

  await assert.rejects(
    () => checker.check({ entityType: "CURRENCY", entityKey: "HKD" }),
    /unclassified status/u
  );
});
