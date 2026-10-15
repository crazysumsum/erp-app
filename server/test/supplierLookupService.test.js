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

test("TC-113 (AUTH-003): requires its minimal dependencies and exposes a versioned downstream contract", () => {
  assert.throws(() => new SupplierLookupService(), TypeError);
  assert.throws(() => new SupplierLookupService({ database: {} }), TypeError);
  assert.equal(SupplierLookupService.contract, "supplier-core-provider/v1");
});

test("TC-113 (AUTH-003): findById uses a bounded read transaction and returns only the minimal non-bank projection", async () => {
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

test("TC-039 (STATE-010): purchase marks non-Active Suppliers unusable while history keeps every non-deleted status visible", async () => {
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

test("TC-039 (STATE-010): findManyByIds de-duplicates stable IDs, performs one query and rejects unbounded or invalid inputs", async () => {
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

// ---- TASK-040：listForSku（設計 §8.7，HD-094）----

function poolDatabase(responses = []) {
  const calls = [];
  return {
    calls,
    async withTransaction() { throw new Error("listForSku reads from the pool"); },
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [responses.shift() ?? []];
    }
  };
}

function forSkuRow(overrides = {}) {
  return { ...supplierRow(), relation_id: null, relationship_status: null, supplier_item_code: null, last_supplied_at: null, exact_rank: 1, ...overrides };
}

const purchasableItems = (calls = []) => ({
  async assertUsable(skuId, options) { calls.push({ skuId, options }); return { skuId, usable: true }; }
});

test("TASK-040: listForSku rejects malformed input and needs an Item lookup", async () => {
  const service = serviceFor(poolDatabase(), { items: purchasableItems() });
  for (const [skuId, options] of [[0, {}], ["x", {}], [5, { q: "a".repeat(191) }], [5, { q: "a\u0000" }], [5, { q: 1 }],
    [5, { page: 0 }], [5, { pageSize: 101 }], [5, { pageSize: 1.5 }], [5, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }]]) {
    await assert.rejects(() => service.listForSku(skuId, options), TypeError, JSON.stringify([skuId, options]));
  }
  await assert.rejects(() => serviceFor(poolDatabase()).listForSku(5), /requires an Item lookup/u);
});

test("TASK-040 (HD-094 3A): an SKU that cannot be purchased fails closed before any Supplier query", async () => {
  const database = poolDatabase();
  const refused = Object.assign(new Error("SKU 5 is not usable"), { code: "SKU_NOT_USABLE" });
  const service = serviceFor(database, { items: { async assertUsable() { throw refused; } } });
  await assert.rejects(() => service.listForSku(5), (error) => error === refused);
  assert.equal(database.calls.length, 0);
});

test("TASK-040 (HD-095 B): without a search, total counts Active Suppliers; ranked ones come first, the rest follow by name", async () => {
  const database = poolDatabase([[{ total: 3 }], [{ headTotal: 1 }], [forSkuRow({ id: 9, relation_id: 4, relationship_status: "preferred" })],
    [forSkuRow(), forSkuRow({ id: 8, supplier_code: "SUP-008" })]]);
  const itemCalls = [];
  const result = await serviceFor(database, { items: purchasableItems(itemCalls) }).listForSku(5, { atMs: 900 });

  assert.deepEqual(itemCalls, [{ skuId: 5, options: { purpose: "purchase", atMs: 900 } }]);
  const [count, headCount, head, rest] = database.calls;
  assert.match(count.sql, /^SELECT COUNT\(\*\) AS total FROM suppliers s WHERE s\.status = 'active'$/u);
  assert.deepEqual(count.params, []);
  assert.match(headCount.sql, /FROM \(SELECT y\.supplier_id AS id FROM supplier_sku_refs y WHERE y\.sku_id = \? AND \(y\.relationship_status = 'preferred'/u);
  assert.match(headCount.sql, /\) h STRAIGHT_JOIN suppliers s ON s\.id = h\.id/u, "the head drives the join (TASK-050)");
  assert.deepEqual(headCount.params, [5, 5]);
  assert.deepEqual(head.params, [5, 5, 20, 0]);
  assert.match(rest.sql, /AND NOT COALESCE\(\(r\.relationship_status = 'preferred' OR \(r\.relationship_status <> 'stopped' AND r\.last_supplied_at IS NOT NULL\)\), FALSE\)/u);
  assert.doesNotMatch(rest.sql, /NOT EXISTS/u, "an antijoin made MySQL scan every relation (HD-095)");
  assert.match(rest.sql, /ORDER BY s\.supplier_name, s\.id LIMIT \? OFFSET \?$/u);
  assert.deepEqual(rest.params, [5, 19, 0], "fills the page after the head, from the start of the rest");
  assert.deepEqual([result.total, result.items.map((item) => item.supplierId)], [3, [9, 7, 8]]);
  assert.deepEqual(result.items[1], {
    supplierId: 7, supplierCode: "SUP-007", supplierName: "Evergreen Trading", displayName: "Evergreen", defaultCurrencyCode: "HKD",
    defaultPaymentTermId: 3, status: "active", version: 4, usable: true, reasons: [], rankReason: null, relation: null
  });
  assert.equal(JSON.stringify(result).includes("bank"), false);
});

test("TASK-040 (HD-095 B): a page past the head skips the head query and offsets into the rest", async () => {
  const database = poolDatabase([[{ total: 50 }], [{ headTotal: 7 }], []]);
  await serviceFor(database, { items: purchasableItems() }).listForSku(5, { page: 3, pageSize: 10 });
  assert.equal(database.calls.length, 3);
  assert.deepEqual(database.calls[2].params.slice(-2), [10, 13]);
});

test("TASK-040 (HD-094 4A): a search matches the Supplier list fields or this SKU's Supplier Item Code, and exact matches rank first", async () => {
  const database = poolDatabase([[{ supplier_id: 11 }, { supplier_id: 12 }], [{ total: 30 }], [{ headTotal: 0 }], []]);
  await serviceFor(database, { items: purchasableItems() }).listForSku(5, { q: " ＡＢ-1 ", page: 3, pageSize: 10 });
  const [byItemCode, count, headCount, rest] = database.calls;
  assert.deepEqual([byItemCode.sql, byItemCode.params],
    ["SELECT supplier_id FROM supplier_sku_refs WHERE sku_id = ? AND supplier_item_code_key = ?", [5, "ab-1"]], "NFKC, trimmed, lower-cased");
  const match = ["ab-1%", "%AB-1%", "%AB-1%", "%AB-1%", "%AB-1%", 11, 12];
  assert.match(count.sql, /general_email LIKE \? ESCAPE '\\\\' OR s\.id IN \(\?,\?\)\)$/u);
  assert.deepEqual(count.params, match);
  assert.match(headCount.sql, / OR y\.supplier_item_code_key = \?\) UNION SELECT id FROM suppliers WHERE supplier_code_key = \?\) h/u);
  assert.deepEqual(headCount.params, [5, "ab-1", "ab-1", 5, ...match]);
  assert.match(rest.sql, /AND s\.supplier_code_key <> \? ORDER BY/u);
  assert.match(rest.sql, / OR r\.supplier_item_code_key = \?\), FALSE\) AND s\.supplier_code_key <> \? ORDER BY/u);
  assert.deepEqual(rest.params, [5, ...match, "ab-1", "ab-1", 10, 20]);
});

test("TASK-040 (HD-095 B): no Item Code match adds no IN list, and an empty rest is not read", async () => {
  const database = poolDatabase([[], [{ total: 1 }], [{ headTotal: 1 }], [forSkuRow({ exact_rank: 0 })]]);
  const result = await serviceFor(database, { items: purchasableItems() }).listForSku(5, { q: "SUP-007" });
  assert.equal(database.calls.length, 4, "item code, count, head count, head — no rest query");
  assert.doesNotMatch(database.calls[1].sql, / IN \(/u);
  assert.deepEqual(result.items.map((item) => item.rankReason), ["exact_match"]);
});

test("TASK-040 (HD-094 2A): rankReason follows exact, preferred, recently supplied; stopped never ranks", async () => {
  const relation = (id, status, lastSuppliedAt = null, exact = 1) => forSkuRow({ id, relation_id: 9, relationship_status: status,
    supplier_item_code: "AB-1", last_supplied_at: lastSuppliedAt, exact_rank: exact });
  const rows = [relation(1, "stopped", 500, 0), relation(2, "preferred"), relation(3, "alternative", 400), relation(4, "stopped", 300),
    relation(5, "alternative")];
  const result = await serviceFor(poolDatabase([[{ total: 5 }], [{ headTotal: 5 }], rows]), { items: purchasableItems() }).listForSku(5);
  assert.deepEqual(result.items.map((item) => item.rankReason), ["exact_match", "preferred", "recently_supplied", null, null]);
  assert.deepEqual(result.items[3].relation, { relationId: 9, relationshipStatus: "stopped", supplierItemCode: "AB-1", lastSuppliedAt: 300 });
});

test("TASK-040 (REV-087 I-3): an SKU ID is reported as one, and null options mean the defaults", async () => {
  const service = serviceFor(poolDatabase([[{ total: 0 }], [{ headTotal: 0 }]]), { items: purchasableItems() });
  await assert.rejects(() => service.listForSku(0), /^TypeError: SKU ID must be a positive safe integer$/u);
  assert.deepEqual(await service.listForSku(5, null), { items: [], total: 0, page: 1, pageSize: 20 });
});

test("TASK-040 (REV-087 L-3): a Supplier seen in both reads is returned once", async () => {
  const database = poolDatabase([[{ total: 3 }], [{ headTotal: 1 }], [forSkuRow()], [forSkuRow(), forSkuRow({ id: 8 })]]);
  const result = await serviceFor(database, { items: purchasableItems() }).listForSku(5);
  assert.deepEqual(result.items.map((item) => item.supplierId), [7, 8]);
});

test("TASK-050 (design §12.4): each for-SKU lookup logs how many results each ranking reason placed, as numbers only", async () => {
  const relation = (id, status, lastSuppliedAt = null, exact = 1) => forSkuRow({ id, supplier_name: `Secret ${id}`, relation_id: id,
    relationship_status: status, supplier_item_code: "AB-1", last_supplied_at: lastSuppliedAt, exact_rank: exact });
  const logged = [];
  const logger = { info: (event, message, context) => logged.push({ event, context }), error() {} };
  await serviceFor(poolDatabase([[], [{ total: 9 }], [{ headTotal: 4 }], [relation(1, "stopped", 5, 0), relation(2, "preferred"),
    relation(3, "alternative", 4), relation(4, "alternative", 3)], [forSkuRow({ id: 5 })]]), { logger, items: purchasableItems() })
    .listForSku(5, { q: "x", pageSize: 5 });
  assert.deepEqual(logged, [{ event: "supplier.for_sku.lookup", context: { skuId: 5, page: 1, pageSize: 5, returned: 5, total: 9, searched: true,
    ranked: { exact_match: 1, preferred: 1, recently_supplied: 2, none: 1 } } }]);
  assert.equal(JSON.stringify(logged).includes("Secret"), false, "no Supplier names in the log");
});

test("TASK-050 (REV-089 L-4): the lookup log reflects no search, the requested page and the de-duplicated results", async () => {
  const logged = [];
  const logger = { info: (event, message, context) => logged.push(context), error() {} };
  const preferred = forSkuRow({ id: 3, relation_id: 30, relationship_status: "preferred" });
  await serviceFor(poolDatabase([[{ total: 9 }], [{ headTotal: 3 }], [preferred], [preferred, forSkuRow({ id: 4 })]]),
    { logger, items: purchasableItems() }).listForSku(5, { page: 2, pageSize: 2 });
  assert.deepEqual(logged, [{ skuId: 5, page: 2, pageSize: 2, returned: 2, total: 9, searched: false,
    ranked: { exact_match: 0, preferred: 1, recently_supplied: 0, none: 1 } }], "the duplicate Supplier 3 is counted once");
});
