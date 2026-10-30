import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../fulfillment/aggregateFixture.js";
import { FulfillmentQueueService } from "../../src/modules/fulfillment/FulfillmentQueueService.js";
const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
import { seedMaxClaimOrder } from "../fulfillment/p1CapacityFixture.js";
nativeTest("P1 Queue returns 100 SKU lines backed by 5000 native Reservations within the original two-second inquiry budget", { timeout: 120000 }, async t => {
  const f = await fixture(t); await seedMaxClaimOrder(f);
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations"))[0][0].n),5000);
  const service = new FulfillmentQueueService({ database: f.database }), samples = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const result = await f.context.storage.run({ databaseTransaction: null, signal: null, auth: { claims: f.claims }, startedAt: f.time.nowMs() }, () => service.list({ pageSize: 100 }));
    samples.push(performance.now() - start);
    assert.equal(result.items.length, 1); assert.equal(result.items[0].lines.length, 100);
    assert.ok(result.items[0].lines.every(line => line.fulfillableBaseQuantity === "50"));
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  t.diagnostic(JSON.stringify({ scenario: "100-SKU/50-Reservations-per-line", samples: samples.length, p95Ms: p95, maxMs: samples.at(-1), budgetMs: 2000 }));
  assert.ok(p95 <= 2000, `Queue P95 ${p95}ms exceeds original inquiry budget 2000ms`);
});
