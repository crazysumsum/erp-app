import assert from "node:assert/strict";
import test from "node:test";

import { CustomerReferenceProviderRegistry } from "../src/modules/customer/CustomerReferenceProviderRegistry.js";

const required = [
  { id: "sales", contract: "sales-customer-references/v1" },
  { id: "receivables", contract: "ar-customer-references/v1" }
];

function provider(id, contract, referenceStatus = "NO_REFERENCE") {
  return {
    id,
    contract,
    async inspectReadiness() { return { status: "READY" }; },
    async checkCustomerReferences(customerId) {
      return { status: referenceStatus, referenceCount: referenceStatus === "REFERENCE" ? 1 : 0, watermark: `customer-${customerId}` };
    }
  };
}

test("TC-026 registry reports READY and NO_REFERENCE only when every required provider is compatible and clear", async () => {
  const registry = new CustomerReferenceProviderRegistry({
    requiredProviders: required,
    providers: [
      provider("sales", "sales-customer-references/v1"),
      provider("receivables", "ar-customer-references/v1")
    ]
  });

  assert.equal(CustomerReferenceProviderRegistry.contract, "customer-reference-provider-registry/v1");
  assert.deepEqual(await registry.inspectReadiness(), {
    status: "READY",
    contract: "customer-reference-provider-registry/v1",
    providers: [
      { id: "receivables", contract: "ar-customer-references/v1", status: "READY" },
      { id: "sales", contract: "sales-customer-references/v1", status: "READY" }
    ]
  });
  assert.deepEqual(await registry.checkCustomerReferences(42), {
    status: "NO_REFERENCE",
    providers: [
      { id: "receivables", status: "NO_REFERENCE", referenceCount: 0, watermark: "customer-42" },
      { id: "sales", status: "NO_REFERENCE", referenceCount: 0, watermark: "customer-42" }
    ]
  });
});

test("TC-026 missing, incompatible and unavailable providers fail closed without sensitive error detail", async () => {
  const unavailable = provider("sales", "sales-customer-references/v1");
  unavailable.inspectReadiness = async () => { throw new Error("database host and credentials must not leak"); };
  const registry = new CustomerReferenceProviderRegistry({
    requiredProviders: required,
    providers: [unavailable]
  });

  assert.deepEqual(await registry.inspectReadiness(), {
    status: "NOT_READY",
    contract: "customer-reference-provider-registry/v1",
    providers: [
      { id: "receivables", contract: "ar-customer-references/v1", status: "NOT_READY" },
      { id: "sales", contract: "sales-customer-references/v1", status: "NOT_READY" }
    ]
  });
  assert.deepEqual(await registry.checkCustomerReferences(42), {
    status: "UNKNOWN",
    providers: [
      { id: "receivables", status: "UNKNOWN", referenceCount: null, watermark: null },
      { id: "sales", status: "UNKNOWN", referenceCount: null, watermark: null }
    ]
  });
});

test("TC-026 a malformed reference result is UNKNOWN and never treated as clear", async () => {
  const malformed = provider("sales", "sales-customer-references/v1");
  malformed.checkCustomerReferences = async () => ({ status: "NO_REFERENCE", referenceCount: -1, watermark: "bad" });
  const registry = new CustomerReferenceProviderRegistry({
    requiredProviders: [{ id: "sales", contract: "sales-customer-references/v1" }],
    providers: [malformed]
  });

  assert.deepEqual(await registry.checkCustomerReferences(7), {
    status: "UNKNOWN",
    providers: [{ id: "sales", status: "UNKNOWN", referenceCount: null, watermark: null }]
  });
});

test("TC-026 registered references remain blockers and unknown provider configuration is rejected", async () => {
  const registry = new CustomerReferenceProviderRegistry({
    requiredProviders: required,
    providers: [
      provider("sales", "sales-customer-references/v1", "REFERENCE"),
      provider("receivables", "ar-customer-references/v1")
    ]
  });
  assert.equal((await registry.checkCustomerReferences(9)).status, "REFERENCE");

  assert.throws(
    () => new CustomerReferenceProviderRegistry({
      requiredProviders: [{ id: "sales", contract: "sales-customer-references/v1" }],
      providers: [provider("unknown", "unknown/v1")]
    }),
    /Unknown Customer reference provider/
  );
});
