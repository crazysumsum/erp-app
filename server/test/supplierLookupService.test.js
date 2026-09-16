import assert from "node:assert/strict";
import test from "node:test";

import { SupplierLookupService } from "../src/modules/supplier/SupplierLookupService.js";

function supplierRow(overrides = {}) {
  return {
    id: 7,
    supplier_code: "SUP-007",
    supplier_name: "Evergreen Trading",
    display_name: "Evergreen",
    default_currency_code: "HKD",
    default_payment_term_id: 3,
    status: "active",
    version: 4,
    ...overrides
  };
}

function fakeDatabase(responses = []) {
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [responses.shift() ?? []];
    }
  };
  return {
    calls,
    transactions: [],
    connection,
    async withTransaction(work, options) {
      this.transactions.push(options);
      return work(connection);
    }
  };
}

function serviceFor(database, overrides = {}) {
  return new SupplierLookupService({
    database,
    logger: { error() {} },
    time: { nowMs: () => 1_000 },
    businessMaster: {
      async assertSupplierDefaultsInTransaction(_connection, input) {
        return {
          currency: { code: input.currencyCode, name: "Hong Kong Dollar", status: "ACTIVE", version: 1 },
          paymentTerm: input.paymentTermId === null ? null : { id: input.paymentTermId, code: "NET30", name: "Net 30", status: "ACTIVE", version: 2 }
        };
      }
    },
    ...overrides
  });
}

test("requires its minimal dependencies and exposes a versioned downstream contract", () => {
  assert.throws(() => new SupplierLookupService(), TypeError);
  assert.throws(() => new SupplierLookupService({ database: {} }), TypeError);
  assert.equal(SupplierLookupService.contract, "supplier-core-provider/v1");
});

test("findById uses a bounded read transaction and returns only the minimal non-bank projection", async () => {
  const database = fakeDatabase([[supplierRow()]]);
  const result = await serviceFor(database).findById(7, { purpose: "purchase", atMs: 900 });

  assert.deepEqual(result, {
    supplierId: 7,
    supplierCode: "SUP-007",
    supplierName: "Evergreen Trading",
    displayName: "Evergreen",
    defaultCurrencyCode: "HKD",
    defaultPaymentTermId: 3,
    status: "active",
    version: 4,
    usable: true,
    reasons: []
  });
  assert.equal("bankAccounts" in result, false);
  assert.deepEqual(database.transactions, [{ isolationLevel: "READ COMMITTED", timeoutMs: 5_000 }]);
});

test("purchase marks non-Active Suppliers unusable while history keeps every non-deleted status visible", async () => {
  const database = fakeDatabase([
    [supplierRow({ status: "blocked" })],
    [supplierRow({ status: "archived" })]
  ]);
  const service = serviceFor(database);

  const purchase = await service.findById(7, { purpose: "purchase" });
  const history = await service.findById(7, { purpose: "history" });

  assert.equal(purchase.usable, false);
  assert.deepEqual(purchase.reasons, ["STATUS_NOT_ACTIVE"]);
  assert.equal(history.usable, true);
  assert.equal(history.status, "archived");
});

test("findByCode normalizes the manually entered Code and missing Suppliers return null", async () => {
  const database = fakeDatabase([[supplierRow()], []]);
  const service = serviceFor(database);

  assert.equal((await service.findByCode("  SuP-007  ", { purpose: "history" })).supplierId, 7);
  assert.deepEqual(database.calls[0].params, ["sup-007"]);
  assert.equal(await service.findById(999, { purpose: "history" }), null);
});

test("findManyByIds de-duplicates stable IDs, performs one query and rejects unbounded or invalid inputs", async () => {
  const database = fakeDatabase([[supplierRow(), supplierRow({ id: 8, supplier_code: "SUP-008" })]]);
  const service = serviceFor(database);

  const result = await service.findManyByIds([7, 8, 7], { purpose: "history" });
  assert.equal(result.size, 2);
  assert.equal(database.calls.length, 1);
  assert.deepEqual(database.calls[0].params, [7, 8]);
  await assert.rejects(() => service.findManyByIds(Array.from({ length: 101 }, (_, index) => index + 1), { purpose: "history" }), TypeError);
  await assert.rejects(() => service.findManyByIds([0], { purpose: "history" }), TypeError);
});

test("assertUsable distinguishes missing from non-Active and submit-time validation locks the current row", async () => {
  const database = fakeDatabase([
    [],
    [supplierRow({ status: "suspended" })],
    [supplierRow({ status: "active", version: 9 })]
  ]);
  const service = serviceFor(database);

  await assert.rejects(() => service.assertUsable(999, { purpose: "purchase" }), { code: "SUPPLIER_NOT_FOUND" });
  await assert.rejects(
    () => service.assertUsable(7, { purpose: "purchase" }),
    (error) => error.code === "SUPPLIER_NOT_USABLE" && error.details.reasons.includes("STATUS_NOT_ACTIVE")
  );
  const submitted = await service.assertUsableInTransaction(database.connection, 7, { purpose: "purchase" });
  assert.equal(submitted.version, 9);
  assert.match(database.calls.at(-1).sql, /FOR UPDATE$/u);
});

test("getPurchaseDefaults revalidates Active status and shared references in the caller transaction", async () => {
  const database = fakeDatabase([
    [supplierRow()],
    [{
      id: 12, supplier_id: 7, label: "Ordering", address_line1: "1 Supply Road", address_line2: "",
      address_line3: "", city: "Hong Kong", state_region: "", postal_code: "", country_code: "HK",
      phone: "", notes: "", status: "active", version: 2, updated_at: 900
    }]
  ]);
  const service = serviceFor(database);

  const result = await service.getPurchaseDefaultsInTransaction(database.connection, 7, { atMs: 900 });
  assert.equal(result.supplier.supplierId, 7);
  assert.equal(result.currency.code, "HKD");
  assert.equal(result.paymentTerm.id, 3);
  assert.equal(result.orderingAddress.addressLine1, "1 Supply Road");
  assert.equal("bankAccounts" in result, false);
  assert.match(database.calls[1].sql, /purpose_code = 'ordering'/u);
});

test("unknown purpose, invalid timestamp, missing transaction and unavailable required provider fail closed", async () => {
  const database = fakeDatabase([[supplierRow()], [supplierRow()]]);
  const service = serviceFor(database, { businessMaster: null });

  await assert.rejects(() => service.findById(7, { purpose: "shipping" }), TypeError);
  await assert.rejects(() => service.findById(7, { purpose: "history", atMs: -1 }), TypeError);
  await assert.rejects(() => service.assertUsableInTransaction(null, 7, { purpose: "purchase" }), TypeError);
  await assert.rejects(
    () => service.getPurchaseDefaultsInTransaction(database.connection, 7),
    (error) => error.code === "BUSINESS_MASTER_NOT_READY" && error.statusCode === 503
  );
});
