import assert from "node:assert/strict";
import test from "node:test";

import { CustomerBusinessMasterImpactChecker } from "../src/modules/customer/CustomerBusinessMasterImpactChecker.js";

test("Customer Business Master impact checker reports NOT_INSTALLED when the Customer table is absent", async () => {
  const database = { async query() { return [[{ present: 0 }]]; } };
  const checker = new CustomerBusinessMasterImpactChecker({ database });

  assert.deepEqual(await checker.check({ entityType: "CURRENCY", entityKey: "HKD" }), {
    status: "NOT_INSTALLED",
    activeDefaultCount: 0,
    openUseCount: 0,
    historicalCount: 0,
    watermark: "not-installed:customers"
  });
});

test("Customer Business Master impact checker counts current defaults and produces a stable Currency watermark", async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("information_schema.tables")) return [[{ present: 1 }]];
      return [[
        { status: "active", reference_count: 2, version_sum: 5, latest_updated_at: 21, max_id: 3 },
        { status: "draft", reference_count: 1, version_sum: 4, latest_updated_at: 20, max_id: 4 },
        { status: "inactive", reference_count: 2, version_sum: 8, latest_updated_at: 19, max_id: 5 }
      ]];
    }
  };
  const checker = new CustomerBusinessMasterImpactChecker({ database });

  const first = await checker.check({ entityType: "CURRENCY", entityKey: "HKD" });
  const second = await checker.check({ entityType: "CURRENCY", entityKey: "HKD" });

  assert.deepEqual({ ...first, watermark: undefined }, {
    status: "READY",
    activeDefaultCount: 2,
    openUseCount: 3,
    historicalCount: 0,
    watermark: undefined
  });
  assert.match(first.watermark, /^customer:CURRENCY:HKD:/);
  assert.equal(second.watermark, first.watermark);
  assert.deepEqual(calls.filter(({ sql }) => !sql.includes("information_schema.tables")).map(({ params }) => params), [["HKD"], ["HKD"]]);
});

test("Customer Business Master impact checker uses the Payment Term key without exposing Customer data", async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes("information_schema.tables")) return [[{ present: 1 }]];
      assert.match(sql, /default_payment_term_id/);
      assert.deepEqual(params, [8]);
      return [[{ status: "active", reference_count: 1, version_sum: 2, latest_updated_at: 10, max_id: 6 }]];
    }
  };
  const checker = new CustomerBusinessMasterImpactChecker({ database });

  assert.deepEqual({ ...(await checker.check({ entityType: "PAYMENT_TERM", entityKey: "8" })), watermark: undefined }, {
    status: "READY",
    activeDefaultCount: 1,
    openUseCount: 0,
    historicalCount: 0,
    watermark: undefined
  });
});
