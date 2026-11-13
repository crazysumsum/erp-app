import assert from "node:assert/strict";
import test from "node:test";

import { CustomerReferenceProviderRegistry } from "../src/modules/customer/CustomerReferenceProviderRegistry.js";
import { SalesCustomerReferenceProvider } from "../src/modules/sales/SalesCustomerReferenceProvider.js";

test("Sales reader returns positive live references from numeric and string aggregates", async (t) => {
  let totalQueries = 0;
  for (const [row, expected] of [
    [{ reference_count: 2, max_copies: 1 },
      { status: "REFERENCE", referenceCount: 2, watermark: "sales-live:v1:2" }],
    [{ reference_count: "3", max_copies: "1" },
      { status: "REFERENCE", referenceCount: 3, watermark: "sales-live:v1:3" }]
  ]) {
    const queries = [];
    const database = {
      async query(_sql, params) {
        queries.push({ receiver: this, params });
        totalQueries += 1;
        return [[row]];
      }
    };
    const reader = new SalesCustomerReferenceProvider({ database });
    assert.equal(reader.database, database);
    assert.deepEqual(await reader.checkCustomerReferences(42), expected);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].receiver, database);
    assert.deepEqual(queries[0].params, [42, 42]);
  }
  assert.equal(totalQueries, 2);
  t.diagnostic("variants=2 stubQueries=2");
});

test("Sales uncertainty remains UNKNOWN without error details", async (t) => {
  const unknown = { status: "UNKNOWN", referenceCount: null, watermark: null };
  const sentinel = new Error("private Sales driver sentinel");
  const variants = [
    { row: { reference_count: 0, max_copies: 0 } },
    { row: { reference_count: 1, max_copies: 2 } },
    { row: { reference_count: Number.MAX_SAFE_INTEGER + 1, max_copies: 1 } },
    { row: { reference_count: "01", max_copies: 1 } },
    { empty: true },
    { reject: true }
  ];
  let totalQueries = 0;
  for (const variant of variants) {
    let queries = 0;
    const reader = new SalesCustomerReferenceProvider({ database: {
      async query() {
        queries += 1;
        totalQueries += 1;
        if (variant.reject) throw sentinel;
        return [variant.empty ? [] : [variant.row]];
      }
    } });
    assert.deepEqual(await reader.checkCustomerReferences(42), unknown);
    assert.equal(queries, 1);
  }
  assert.equal(totalQueries, 6);
  t.diagnostic("variants=6 stubQueries=6");
});

test("Sales invalid input and NOT_READY protect the registry boundary", async (t) => {
  let totalQueries = 0;
  for (const variant of ["invalidId", "readiness", "registry"]) {
    const reader = new SalesCustomerReferenceProvider({ database: {
      async query() {
        totalQueries += 1;
        throw new Error("Sales query must not run");
      }
    } });
    if (variant === "invalidId") {
      await assert.rejects(reader.checkCustomerReferences(0), TypeError);
    } else if (variant === "readiness") {
      assert.deepEqual(await reader.inspectReadiness(), { status: "NOT_READY" });
    } else {
      let directChecks = 0;
      const check = reader.checkCustomerReferences.bind(reader);
      reader.checkCustomerReferences = (...args) => {
        directChecks += 1;
        return check(...args);
      };
      const registry = new CustomerReferenceProviderRegistry({
        providers: [reader],
        requiredProviders: [{ id: "sales", contract: "sales-customer-references/v1" }]
      });
      assert.deepEqual(await registry.inspectReadiness(), {
        status: "NOT_READY",
        contract: "customer-reference-provider-registry/v1",
        providers: [{ id: "sales", contract: "sales-customer-references/v1", status: "NOT_READY" }]
      });
      assert.deepEqual(await registry.checkCustomerReferences(42), {
        status: "UNKNOWN",
        providers: [{ id: "sales", status: "UNKNOWN", referenceCount: null, watermark: null }]
      });
      assert.equal(directChecks, 0);
    }
    assert.equal(totalQueries, 0);
  }
  t.diagnostic("variants=3 stubQueries=0");
});
