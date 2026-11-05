import assert from "node:assert/strict";
import test from "node:test";

import { createCustomerReferenceService } from "../src/modules/customer/customerReferenceComposition.js";
import { FulfillmentCustomerReferenceProvider } from "../src/modules/fulfillment/FulfillmentCustomerReferenceProvider.js";

test("TC-032 partial composition keeps missing owners UNKNOWN on the resolved database", async () => {
  const required = [
    ["fulfillment", "fulfillment-customer-references/v1"],
    ["payment-refund", "payment-refund-customer-references/v1"],
    ["receivables", "ar-customer-references/v1"],
    ["returns", "returns-customer-references/v1"],
    ["sales", "sales-customer-references/v1"]
  ];
  for (const options of [undefined, { timeoutMs: 50 }]) {
    let resolves = 0;
    const queries = [];
    const database = {
      async query(sql, params) {
        assert.equal(this, database);
        queries.push({ sql, params });
        return [[{ reference_count: 0, max_copies: 0, last_updated_at: 0 }]];
      }
    };
    const service = await createCustomerReferenceService({
      services: {
        async resolve(name) {
          assert.equal(name, "mysqldatabase");
          resolves += 1;
          return database;
        }
      },
      ...(options ? { options } : {})
    });
    assert.equal(resolves, 1);
    assert.equal(service.timeoutMs, options?.timeoutMs ?? 2_000);
    assert.equal(service.providers.size, 1);
    assert.ok(service.providers.get("fulfillment") instanceof FulfillmentCustomerReferenceProvider);
    assert.equal(service.providers.get("fulfillment").database, database);
    assert.deepEqual(await service.inspectReadiness(), {
      status: "NOT_READY",
      contract: "customer-reference-provider-registry/v1",
      providers: required.map(([id, contract]) => ({ id, contract, status: id === "fulfillment" ? "READY" : "NOT_READY" }))
    });
    assert.deepEqual(await service.checkCustomerReferences(42), {
      status: "UNKNOWN",
      providers: required.map(([id]) => id === "fulfillment"
        ? { id, status: "NO_REFERENCE", referenceCount: 0, watermark: "fulfillment:42:0:0" }
        : { id, status: "UNKNOWN", referenceCount: null, watermark: null })
    });
    assert.equal(queries.length, 3);
    assert.deepEqual(queries.map(({ params }) => params), [[0, 0, 0, 0], [0, 0, 0, 0], [42, 42, 42, 42]]);
  }
});

test("TC-032 Fulfillment reader preserves reference count and watermark across driver numeric forms", async () => {
  for (const [row, expected] of [
    [{ reference_count: 0, max_copies: 0, last_updated_at: 0 },
      { status: "NO_REFERENCE", referenceCount: 0, watermark: "fulfillment:42:0:0" }],
    [{ reference_count: "3", max_copies: "1", last_updated_at: "1700000000000" },
      { status: "REFERENCE", referenceCount: 3, watermark: "fulfillment:42:3:1700000000000" }]
  ]) {
    let queries = 0;
    const reader = new FulfillmentCustomerReferenceProvider({ database: {
      async query(_sql, params) {
        queries += 1;
        assert.deepEqual(params, [42, 42, 42, 42]);
        return [[row]];
      }
    } });
    assert.deepEqual(await reader.checkCustomerReferences(42), expected);
    assert.equal(queries, 1);
  }
});

test("TC-032 Fulfillment uncertainty never becomes an unreferenced customer", async () => {
  const unknown = { status: "UNKNOWN", referenceCount: null, watermark: null };
  const variants = [
    { row: { reference_count: 1, max_copies: 2, last_updated_at: 0 } },
    { row: { reference_count: -1, max_copies: 1, last_updated_at: 0 } },
    { row: { reference_count: "01", max_copies: 1, last_updated_at: 0 } },
    { row: { reference_count: Number.MAX_SAFE_INTEGER + 1, max_copies: 1, last_updated_at: 0 } },
    { empty: true },
    { reject: true },
    { reject: true, readiness: true },
    { invalidId: true }
  ];
  for (const variant of variants) {
    let queries = 0;
    const reader = new FulfillmentCustomerReferenceProvider({ database: {
      async query() {
        queries += 1;
        if (variant.reject) throw new Error("private stub database error");
        return [variant.empty ? [] : [variant.row]];
      }
    } });
    if (variant.invalidId) {
      await assert.rejects(reader.checkCustomerReferences(0), TypeError);
    } else if (variant.readiness) {
      assert.deepEqual(await reader.inspectReadiness(), { status: "NOT_READY" });
    } else {
      assert.deepEqual(await reader.checkCustomerReferences(42), unknown);
    }
    assert.equal(queries, variant.invalidId ? 0 : 1);
  }
});
