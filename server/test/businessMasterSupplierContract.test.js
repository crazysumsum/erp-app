import assert from "node:assert/strict";
import test from "node:test";

import { BusinessMasterLookupProvider } from "../src/modules/supplier/providers/BusinessMasterLookupProvider.js";

function harness({ readinessStatus = "READY" } = {}) {
  const calls = [];
  const provider = {
    async listActiveCurrencies(input) {
      calls.push(["list-currencies", input]);
      return [{ code: "HKD", name: "Hong Kong Dollar", status: "ACTIVE", version: 1 }];
    },
    async listActivePaymentTerms(input) {
      calls.push(["list-payment-terms", input]);
      return [{ id: 8, code: "NET30", name: "Net 30", status: "ACTIVE", version: 2 }];
    },
    async getCurrencyHistory(code) {
      calls.push(["currency-history", code]);
      return { code, name: "US Dollar", status: "INACTIVE", version: 7 };
    },
    async getPaymentTermHistory(id) {
      calls.push(["payment-term-history", id]);
      return { id, code: "OLD", name: "Old term", status: "INACTIVE", version: 3 };
    },
    async assertCurrencyUsableInTransaction(connection, input) {
      calls.push(["assert-currency", connection, input]);
      return { code: input.code, name: "Hong Kong Dollar", status: "ACTIVE", version: 1 };
    },
    async assertPaymentTermUsableInTransaction(connection, input) {
      calls.push(["assert-payment-term", connection, input]);
      return { id: input.id, code: "NET30", name: "Net 30", status: "ACTIVE", version: 2 };
    }
  };
  const readiness = {
    async inspect() {
      return { status: readinessStatus, providerContract: "business-master-currency-payment-term-provider/v1" };
    }
  };
  return { lookup: new BusinessMasterLookupProvider({ provider, readiness }), calls };
}

test("Supplier selectors expose only Business Master active values", async () => {
  const { lookup, calls } = harness();
  assert.equal(BusinessMasterLookupProvider.contract, "business-master-currency-payment-term-provider/v1");
  assert.equal((await lookup.assertReady()).status, "READY");
  assert.equal((await lookup.listCurrencies({ page: 2, pageSize: 50 }))[0].code, "HKD");
  assert.equal((await lookup.listPaymentTerms({ page: 3, pageSize: 20 }))[0].code, "NET30");
  assert.deepEqual(calls, [
    ["list-currencies", { page: 2, pageSize: 50 }],
    ["list-payment-terms", { page: 3, pageSize: 20 }]
  ]);
});

test("historical Supplier references can resolve inactive master records", async () => {
  const { lookup } = harness();
  assert.equal((await lookup.getCurrencyHistory("USD")).status, "INACTIVE");
  assert.equal((await lookup.getPaymentTermHistory(9)).status, "INACTIVE");
});

test("Supplier writes revalidate required currency and optional payment term on the caller transaction", async () => {
  const { lookup, calls } = harness();
  const connection = { query() {} };
  const result = await lookup.assertSupplierDefaultsInTransaction(connection, {
    currencyCode: "HKD",
    currencyVersion: 1,
    paymentTermId: 8,
    paymentTermVersion: 2
  });
  assert.equal(result.currency.code, "HKD");
  assert.equal(result.paymentTerm.id, 8);
  assert.deepEqual(calls, [
    ["assert-currency", connection, { code: "HKD", expectedVersion: 1, purpose: "new_assignment" }],
    ["assert-payment-term", connection, { id: 8, expectedVersion: 2, purpose: "new_assignment" }]
  ]);

  calls.length = 0;
  const withoutTerm = await lookup.assertSupplierDefaultsInTransaction(connection, {
    currencyCode: "HKD",
    currencyVersion: 1,
    paymentTermId: null
  });
  assert.equal(withoutTerm.paymentTerm, null);
  assert.equal(calls.length, 1);
});

test("Supplier Core fails closed when Business Master readiness is not READY", async () => {
  const { lookup } = harness({ readinessStatus: "NOT_READY" });
  await assert.rejects(
    () => lookup.assertReady(),
    (error) => error.code === "BUSINESS_MASTER_NOT_READY" && error.statusCode === 503
  );
});
