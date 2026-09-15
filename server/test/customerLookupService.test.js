import assert from "node:assert/strict";
import test from "node:test";

import { CustomerLookupService } from "../src/modules/customer/CustomerLookupService.js";

const activeCustomer = {
  id: 4,
  customer_code: "C-004",
  legal_name: "Acme Limited",
  trading_name: "Acme",
  default_currency_code: "HKD",
  default_payment_term_id: 7,
  status: "active",
  version: 3
};

test("TC-027 rejects an unknown purpose before querying and exposes the versioned contract", async () => {
  let queries = 0;
  const lookup = new CustomerLookupService({ database: { async query() { queries += 1; return [[]]; } } });
  assert.equal(CustomerLookupService.contract, "customer-purpose-provider-contracts/aligned-design-2.0");
  await assert.rejects(
    () => lookup.findById(4, { purpose: "generic_status_bypass" }),
    (error) => error.code === "CUSTOMER_LOOKUP_PURPOSE_INVALID" && error.statusCode === 400
  );
  assert.equal(queries, 0);
});

test("TC-027 new_sale is Active-only while history returns the same minimal immutable projection", async () => {
  const database = {
    async query(_sql, [id]) {
      if (id === 4) return [[activeCustomer]];
      return [[{ ...activeCustomer, id: 5, customer_code: "C-005", status: "suspended" }]];
    }
  };
  const lookup = new CustomerLookupService({ database });
  const active = await lookup.findById(4, { purpose: "new_sale", atMs: 10 });
  const unavailable = await lookup.findById(5, { purpose: "new_sale", atMs: 10 });
  const history = await lookup.findById(5, { purpose: "history", atMs: 10 });

  assert.deepEqual(active, {
    customerId: 4,
    customerCode: "C-004",
    legalName: "Acme Limited",
    displayName: "Acme",
    defaultCurrencyCode: "HKD",
    defaultPaymentTermId: 7,
    status: "active",
    version: 3
  });
  assert.equal(Object.isFrozen(active), true);
  assert.equal(unavailable, null);
  assert.equal(history.status, "suspended");
  assert.equal("notes" in history, false);
  assert.equal("generalEmail" in history, false);
});

test("TC-027 purpose matrix rejects non-Active Customers only for new transactions", async () => {
  const lookup = new CustomerLookupService({
    database: { async query() { return [[{ ...activeCustomer, status: "blocked" }]]; } }
  });
  const activeOnly = ["new_sale", "manual_invoice"];
  const existingOrHistorical = [
    "existing_order_fulfillment",
    "invoice_existing_shipment",
    "ar_existing_document",
    "historical_return",
    "refund_existing_transaction",
    "history"
  ];
  for (const purpose of activeOnly) assert.equal(await lookup.findById(4, { purpose }), null);
  for (const purpose of existingOrHistorical) assert.equal((await lookup.findById(4, { purpose })).status, "blocked");
});

test("TC-027 findByCode uses the canonical equality key and listActive is bounded and stable", async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("COUNT(*)")) return [[{ total: 1 }]];
      return [[activeCustomer]];
    }
  };
  const lookup = new CustomerLookupService({ database });

  assert.equal((await lookup.findByCode("  ｃ－００４  ", { purpose: "new_sale" })).customerId, 4);
  assert.equal(calls[0].params[0], "c-004");
  const page = await lookup.listActive({ q: "Acme", page: 2, pageSize: 50, purpose: "new_sale", atMs: 20 });
  assert.deepEqual({ total: page.total, page: page.page, pageSize: page.pageSize }, { total: 1, page: 2, pageSize: 50 });
  assert.equal(page.items[0].customerId, 4);
  assert.match(calls[1].sql, /status = 'active'/);
  assert.deepEqual(calls[2].params.slice(-2), [50, 50]);
});

test("TC-027 listActive accepts legal-name searches longer than the Customer code limit", async () => {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("COUNT(*)")) return [[{ total: 0 }]];
      return [[]];
    }
  };
  const lookup = new CustomerLookupService({ database });
  const legalNameSearch = "A".repeat(65);

  const page = await lookup.listActive({ q: legalNameSearch, purpose: "new_sale" });

  assert.equal(page.total, 0);
  assert.match(calls[0].sql, /legal_name_key LIKE \? ESCAPE '!'/);
  assert.doesNotMatch(calls[0].sql, /customer_code_key LIKE/);
  assert.deepEqual(calls[0].params, [`${legalNameSearch.toLowerCase()}%`]);
});

test("TC-027 credit lookup preserves absent, zero and on-hold semantics without notes", async () => {
  let result = [[{
    customer_id: 4,
    credit_limit: "0.0000",
    credit_currency_code: "HKD",
    credit_status: "on_hold",
    credit_version: 2
  }]];
  const lookup = new CustomerLookupService({ database: { async query() { return result; } } });

  assert.deepEqual(await lookup.getCreditPolicy(4, { atMs: 30 }), {
    configured: true,
    creditLimit: "0.0000",
    currencyCode: "HKD",
    status: "on_hold",
    policyVersion: 2
  });
  result = [[{ customer_id: 4, credit_limit: null, credit_currency_code: null, credit_status: null, credit_version: null }]];
  assert.deepEqual(await lookup.getCreditPolicy(4), {
    configured: false,
    creditLimit: null,
    currencyCode: null,
    status: "not_configured",
    policyVersion: null
  });
  result = [[]];
  await assert.rejects(() => lookup.getCreditPolicy(999), (error) => error.code === "CUSTOMER_NOT_FOUND");
});

test("TC-018 and TC-027 address lookup returns only active owned purpose rows and safe fields", async () => {
  const row = {
    id: 11, customer_id: 4, label: "Warehouse", recipient_company_department: "Receiving",
    address_line1: "1 Main Street", address_line2: "", address_line3: "", city: "Hong Kong",
    state_region: "", postal_code: "", country_code: "HK", phone: "1234", notes: "private note",
    sort_order: 1, status: "active", version: 6, is_default: 1
  };
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql: String(sql), params }); return [[row]]; } };
  const lookup = new CustomerLookupService({ database });
  const addresses = await lookup.listAddresses(4, { purpose: "shipping", atMs: 40 });

  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].addressId, 11);
  assert.equal(addresses[0].isDefault, true);
  assert.equal("notes" in addresses[0], false);
  assert.match(calls[0].sql, /a\.customer_id = \?/);
  assert.match(calls[0].sql, /p\.purpose_code = \?/);
  assert.deepEqual(calls[0].params, [4, "shipping"]);
});

test("TC-018 transaction-aware address assertion is owner-scoped, active-purpose checked and version safe", async () => {
  const calls = [];
  const row = {
    id: 11, customer_id: 4, customer_status: "suspended", customer_version: 8,
    label: "Warehouse", recipient_company_department: "", address_line1: "1 Main", address_line2: "",
    address_line3: "", city: "", state_region: "", postal_code: "", country_code: "HK", phone: "",
    sort_order: 1, status: "active", version: 6, is_default: 1
  };
  const transaction = { async query(sql, params) { calls.push({ sql: String(sql), params }); return [[row]]; } };
  const lookup = new CustomerLookupService({ database: { async query() { throw new Error("must use caller transaction"); } } });

  const address = await lookup.assertAddressUsableInTransaction(transaction, 4, 11, { purpose: "shipping", expectedVersion: 6, atMs: 50 });
  assert.equal(address.addressId, 11);
  assert.equal(address.customerStatus, "suspended");
  assert.match(calls[0].sql, /FOR UPDATE$/);
  assert.deepEqual(calls[0].params, [4, 11, "shipping"]);
  await assert.rejects(
    () => lookup.assertAddressUsableInTransaction(transaction, 4, 11, { purpose: "shipping", expectedVersion: 5 }),
    (error) => error.code === "VERSION_CONFLICT" && error.publicDetails.currentVersion === 6
  );
  await assert.rejects(
    () => lookup.assertAddressUsableInTransaction(null, 4, 11, { purpose: "shipping", expectedVersion: 6 }),
    TypeError
  );
  await assert.rejects(
    () => lookup.assertAddressUsableInTransaction(transaction, 4, 11, { purpose: "shipping" }),
    (error) => error instanceof TypeError && /expectedVersion/.test(error.message)
  );
});

test("TC-018 contact assertion uses the same safe absent response for missing and cross-owner records", async () => {
  const lookup = new CustomerLookupService({ database: { async query() { return [[]]; } } });
  await assert.rejects(
    () => lookup.assertContactUsable(4, 99, { purpose: "billing_ar", expectedVersion: 1 }),
    (error) => error.code === "CUSTOMER_PARTY_NOT_FOUND" && error.statusCode === 404
  );
  await assert.rejects(
    () => lookup.listContacts(4, { purpose: "unknown" }),
    (error) => error.code === "CUSTOMER_LOOKUP_PURPOSE_INVALID"
  );
});
