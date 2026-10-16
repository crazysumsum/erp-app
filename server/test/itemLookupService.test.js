/**
 * `ItemLookupService` 嘅純業務規則（§8.3 嘅 purpose 表、batching、barcode
 * 資料事故防呆）——用假 database 直接注入固定嘅列，唔碰真 DB。真正嘅 SQL／
 * JOIN／唯一鍵行為由 test/integration/itemLookup.integration.test.js 對真
 * MySQL 驗證。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ItemLookupService } from "../src/modules/item/ItemLookupService.js";
import { createTestTime } from "../test-support/createTestTime.js";

const NOW_MS = 1_700_000_000_000;

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

/** 逐個 call 派下一份預先準備嘅回應；`database.query()` 嘅形狀係
 * `[rows, fields]`，呢度淨係要 `rows`，所以每份回應都包一層陣列。 */
function fakeDatabase(rowSets) {
  const calls = [];
  let index = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const rows = rowSets[index] ?? [];
      index += 1;
      return [rows];
    }
  };
}

function createService({ database, logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  return { service: new ItemLookupService({ database, logger, time }), logger };
}

function skuRow(overrides = {}) {
  return {
    id: 10,
    sku_code: "SKU-1",
    sku_name: "SKU One",
    sku_status: "active",
    purchasable: 1,
    sellable: 1,
    inventory_tracked: 1,
    tracking_policy: "none",
    shelf_life_days: null,
    min_receipt_life_days: null,
    min_sale_life_days: null,
    effective_from: null,
    effective_to: null,
    item_id: 1,
    item_name: "Item 1",
    product_type: "standard",
    item_status: "active",
    ...overrides
  };
}

function uomRow(overrides = {}) {
  return {
    sku_id: 10,
    uom_id: 5,
    uom_code: "EA",
    to_base_factor: 1,
    is_base: 1,
    is_default_purchase: 0,
    is_default_sale: 1,
    ...overrides
  };
}

const saleSku = () => skuRow({ sku_version: 3, item_version: 2, suggested_price_amount: "12.3400" });
const saleUom = (overrides = {}) => uomRow({ id: 91, uom_name: "Each", uom_status: "active", uom_version: 4, version: 5, ...overrides });

test("TC-019 committed receipt validates IDs and time before SQL including empty requests", async () => {
  const database = fakeDatabase([]);
  const { service } = createService({ database });
  for (const ids of [null, undefined, "10", {}, ["10"], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], Array(1), Array.from({ length: 101 }, (_, i) => i + 1)]) {
    await assert.rejects(() => service.findManyForCommittedReceipt(ids), TypeError);
  }
  for (const atMs of [null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0"]) {
    await assert.rejects(() => service.findManyForCommittedReceipt([], { atMs }), TypeError);
  }
  assert.deepEqual(await service.findManyForCommittedReceipt([], { atMs: 0 }), new Map());
  assert.deepEqual(await service.findManyForCommittedReceipt([], { atMs: Number.MAX_SAFE_INTEGER }), new Map());
  assert.equal(database.calls.length, 0);
});

test("TC-019 committed receipt batches 100 unique IDs in ascending order using two parameterized SELECTs", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => i + 1);
  const database = fakeDatabase([ids.toReversed().map(id => skuRow({ id })), []]);
  const { service } = createService({ database });
  const result = await service.findManyForCommittedReceipt([...ids.toReversed(), ...ids]);
  assert.deepEqual([...result.keys()], ids);
  assert.equal(database.calls.length, 2);
  for (const { sql, params } of database.calls) {
    assert.match(sql, /^\s*SELECT\b/i);
    assert.doesNotMatch(sql, /FOR SHARE|FOR UPDATE|START TRANSACTION|COMMIT/i);
    assert.equal((sql.match(/\?/g) ?? []).length, 100);
    assert.deepEqual(params, ids);
  }
});

test("TC-019 committed receipt returns current facts and all historical UOMs without eligibility or authority fields", async () => {
  for (const trackingPolicy of ["none", "batch", "batch_expiry"]) {
    const row = skuRow({ tracking_policy: trackingPolicy, shelf_life_days: "90", min_receipt_life_days: "30", min_sale_life_days: "10", sellable: 0 });
    const uoms = [saleUom({ id: 93, uom_status: "archived" }), saleUom({ id: 92, uom_status: "inactive" }), saleUom()];
    const generic = await createService({ database: fakeDatabase([[row], uoms]) }).service.findById(10, { purpose: "purchase" });
    const database = fakeDatabase([[row], uoms]);
    const result = (await createService({ database }).service.findManyForCommittedReceipt([10])).get(10);
    const { usable, reasons, ...expected } = generic;
    assert.equal(usable, true); assert.deepEqual(reasons, []);
    expected.uoms.sort((a, b) => a.skuUomId - b.skuUomId);
    assert.deepEqual(result, { ...expected, warnings: [] });
    assert.deepEqual(Object.keys(result).sort(), ["skuId", "skuCode", "skuName", "skuStatus", "itemId", "itemName", "productType", "itemStatus", "purchasable", "sellable", "inventoryTracked", "trackingPolicy", "shelfLifeDays", "minimumReceiptLifeDays", "minimumSaleLifeDays", "effectiveFrom", "effectiveTo", "uoms", "warnings"].sort());
    assert.deepEqual(Object.keys(result.uoms[0]).sort(), ["skuUomId", "uomId", "uomCode", "uomName", "status", "toBaseFactor", "isBase", "isDefaultPurchase", "isDefaultSale"].sort());
    assert.notEqual(result.uoms[0].skuUomId, result.uoms[0].uomId);
    for (const key of ["usable", "reasons", "canReceive", "suggestedPrice", "skuVersion", "poSnapshot"]) assert.equal(key in result, false);
    assert.equal(result.trackingPolicy, trackingPolicy);
    assert.equal(result.shelfLifeDays, 90);
    assert.equal(result.minimumReceiptLifeDays, 30);
    assert.equal(result.minimumSaleLifeDays, 10);
  }
});

test("TC-019 committed receipt reports nonactive Item and SKU states once in fixed warning order", async () => {
  for (const status of ["draft", "inactive", "discontinued", "archived"]) {
    for (const states of [{ item_status: status }, { sku_status: status }, { item_status: status, sku_status: status }]) {
      const database = fakeDatabase([[skuRow({ ...states, purchasable: 0, inventory_tracked: 0, effective_from: NOW_MS + 1 })], []]);
      const result = (await createService({ database }).service.findManyForCommittedReceipt([10])).get(10);
      assert.deepEqual(result.warnings, ["STATUS_NOT_ACTIVE", "NOT_PURCHASABLE", "NOT_INVENTORY_TRACKED", "OUTSIDE_EFFECTIVE_RANGE"]);
      assert.deepEqual(result.uoms, []);
    }
  }
});

test("TC-019 committed receipt warnings use inclusive dates and one captured default time", async () => {
  let clockCalls = 0;
  for (const [range, warnings] of [
    [{ effective_from: NOW_MS, effective_to: NOW_MS }, []],
    [{ effective_from: null, effective_to: null }, []],
    [{ effective_from: NOW_MS + 1 }, ["OUTSIDE_EFFECTIVE_RANGE"]],
    [{ effective_to: NOW_MS - 1 }, ["OUTSIDE_EFFECTIVE_RANGE"]],
    [{ purchasable: 0 }, ["NOT_PURCHASABLE"]],
    [{ inventory_tracked: 0 }, ["NOT_INVENTORY_TRACKED"]]
  ]) {
    const service = new ItemLookupService({ database: fakeDatabase([[skuRow(range)], [], [skuRow(range)], []]), logger: collectingLogger(), time: { nowMs: () => { clockCalls++; return NOW_MS; } } });
    assert.deepEqual((await service.findManyForCommittedReceipt([10])).get(10).warnings, warnings);
    assert.deepEqual((await service.findManyForCommittedReceipt([10], { atMs: undefined })).get(10).warnings, warnings);
    assert.deepEqual((await new ItemLookupService({ database: fakeDatabase([[skuRow(range)], []]), logger: collectingLogger(), time: { nowMs: () => { throw new Error("explicit time must not read clock"); } } }).findManyForCommittedReceipt([10], { atMs: NOW_MS })).get(10).warnings, warnings);
  }
  assert.equal(clockCalls, 12);
});

test("TC-019 committed receipt rejects the lowest missing identity before serial or UOM loading", async () => {
  const database = fakeDatabase([[skuRow({ id: 10, tracking_policy: "serial" })]]);
  await assert.rejects(() => createService({ database }).service.findManyForCommittedReceipt([12, 10, 11]), error => error.code === "SKU_NOT_FOUND" && error.statusCode === 404 && error.message.includes("11"));
  assert.equal(database.calls.length, 1);
});

test("TC-019 committed receipt rejects the lowest serial identity without a partial Map", async () => {
  const database = fakeDatabase([[skuRow({ id: 12, tracking_policy: "serial" }), skuRow({ id: 10 }), skuRow({ id: 11, tracking_policy: "serial" })]]);
  await assert.rejects(() => createService({ database }).service.findManyForCommittedReceipt([12, 10, 11]), error => {
    assert.equal(error.code, "SKU_NOT_USABLE");
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.details, { skuId: 11, purpose: "committed_receipt", reasons: ["SERIAL_NOT_SUPPORTED"] });
    return true;
  });
  assert.equal(database.calls.length, 1);
});

test("TC-019 committed receipt propagates either executor failure without retry or fallback", async () => {
  for (const failAt of [1, 2]) {
    let calls = 0;
    const failure = new Error("synthetic database failure");
    const database = { query: async () => { if (++calls === failAt) throw failure; return [[skuRow()]]; } };
    await assert.rejects(() => createService({ database }).service.findManyForCommittedReceipt([10]), error => error === failure);
    assert.equal(calls, failAt);
  }
});

test("TC-019 committed receipt does not add a generic purpose or relax purchase and inventory rules", async () => {
  const row = skuRow({ sku_status: "archived", purchasable: 0, inventory_tracked: 0 });
  const service = createService({ database: fakeDatabase([[row], [], [row], [], [row], [], [row], []]) }).service;
  assert.deepEqual((await service.findManyForCommittedReceipt([10])).get(10).warnings, ["STATUS_NOT_ACTIVE", "NOT_PURCHASABLE", "NOT_INVENTORY_TRACKED"]);
  for (const purpose of ["purchase", "inventory"]) assert.equal((await service.findById(10, { purpose })).usable, false);
  await assert.rejects(() => service.findById(10, { purpose: "committed_receipt" }), TypeError);
});

test("TC-017 purchase lookup adds mapping metadata without changing old fields or inactive UOM usability", async () => {
  const old = { uomId: 5, uomCode: "EA", toBaseFactor: 1, isBase: true, isDefaultPurchase: false, isDefaultSale: true };
  for (const lookup of [
    service => service.findById(10, { purpose: "purchase" }),
    service => service.findByCode("SKU-1", { purpose: "purchase" }),
    service => service.findByBarcode("123", { purpose: "purchase" }),
    async service => (await service.findManyByIds([10], { purpose: "purchase" })).get(10),
    service => service.assertUsable(10, { purpose: "purchase" })
  ]) {
    const database = fakeDatabase([[skuRow()], [saleUom({ uom_status: "inactive" })]]);
    const result = await lookup(createService({ database }).service);
    assert.deepEqual(result.uoms, [{ ...old, skuUomId: 91, uomName: "Each", status: "inactive" }]);
    assert.equal(result.usable, true);
    assert.deepEqual(result.reasons, []);
    assert.equal(database.calls.length, 2);
  }
  for (const options of [{}, { purpose: "sale" }, { purpose: "inventory" }]) {
    const result = await createService({ database: fakeDatabase([[skuRow()], [saleUom()]]) }).service.findById(10, options);
    assert.deepEqual(result.uoms, [old], "non-purchase projections are unchanged");
  }
});

test("TC-018 purchase search returns bounded pages, escaped prefixes and metadata for serial non-sellable SKUs", async () => {
  const database = fakeDatabase([[{ total: 5 }], [skuRow({ sellable: 0, tracking_policy: "serial" })],
    [saleUom(), saleUom({ id: 92, uom_id: 6, uom_name: "Box", uom_status: "inactive", is_base: 0, to_base_factor: 24 })]]);
  const { service } = createService({ database });
  const result = await service.searchForPurchase({ q: " SKU_%! ", page: 2, pageSize: 1 });
  assert.deepEqual({ total: result.total, page: result.page, pageSize: result.pageSize }, { total: 5, page: 2, pageSize: 1 });
  assert.equal(result.items[0].usable, true);
  assert.equal(result.items[0].sellable, false);
  assert.equal(result.items[0].trackingPolicy, "serial");
  assert.deepEqual(result.items[0].uoms.map(({ skuUomId, uomName, status }) => ({ skuUomId, uomName, status })),
    [{ skuUomId: 91, uomName: "Each", status: "active" }, { skuUomId: 92, uomName: "Box", status: "inactive" }]);
  assert.equal(database.calls.length, 3);
  assert.deepEqual(database.calls[0].params, [NOW_MS, NOW_MS, "SKU!_!%!!%", "SKU!_!%!!%", "SKU!_!%!!%"]);
  assert.deepEqual(database.calls[1].params.slice(-2), [1, 1]);
  assert.match(database.calls[0].sql, /u\.status\s*=\s*'active'/);
  assert.doesNotMatch(database.calls[0].sql, /s\.sellable|s\.tracking_policy/);
});

test("TC-018 purchase search rejects unsafe bounds before SQL and propagates database errors", async () => {
  const database = fakeDatabase([]), { service } = createService({ database });
  for (const input of [{ q: null }, { q: [] }, { q: "\n" }, { q: "a".repeat(191) },
    { q: "😀".repeat(191) }, { page: 0 }, { page: 1.5 }, { page: "1" }, { pageSize: 0 },
    { pageSize: 101 }, { pageSize: NaN }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }]) {
    await assert.rejects(() => service.searchForPurchase(input), TypeError);
  }
  assert.equal(database.calls.length, 0);
  const outage = new Error("database unavailable");
  const broken = createService({ database: { query: async () => { throw outage; } } }).service;
  await assert.rejects(() => broken.searchForPurchase({}), error => error === outage);
});

test("TC-018 purchase empty pages keep the total with two queries and one clock capture", async () => {
  const database = fakeDatabase([[{ total: 5 }], []]);
  let clockCalls = 0;
  const service = new ItemLookupService({ database, logger: collectingLogger(), time: { nowMs() { clockCalls++; return NOW_MS; } } });
  assert.deepEqual(await service.searchForPurchase({ page: 9 }), { items: [], total: 5, page: 9, pageSize: 20 });
  assert.equal(database.calls.length, 2);
  assert.equal(clockCalls, 1);
  assert.deepEqual(database.calls[0].params, [NOW_MS, NOW_MS]);
  assert.deepEqual(database.calls[1].params, [NOW_MS, NOW_MS, 20, 160]);
});

test("TC-018 purchase search reuses purchase evaluation and rejects invalid provider rows", async () => {
  for (const [overrides, reason] of [[{ item_status: "inactive" }, "STATUS_NOT_ACTIVE"],
    [{ sku_status: "discontinued" }, "STATUS_NOT_ACTIVE"], [{ purchasable: 0 }, "NOT_PURCHASABLE"],
    [{ effective_from: NOW_MS + 1 }, "OUTSIDE_EFFECTIVE_RANGE"], [{ effective_to: NOW_MS - 1 }, "OUTSIDE_EFFECTIVE_RANGE"]]) {
    const { service } = createService({ database: fakeDatabase([[{ total: 1 }], [skuRow(overrides)], [saleUom()]]) });
    await assert.rejects(() => service.searchForPurchase({}), error => error.code === "SKU_NOT_USABLE" &&
      error.details.purpose === "purchase" && error.details.reasons.includes(reason));
  }
});

test("TC-018 purchase search batch-loads UOMs for100 results without N+1", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => skuRow({ id: i + 10 }));
  const database = fakeDatabase([[{ total: 100 }], rows, rows.map(row => saleUom({ sku_id: row.id, id: row.id + 1000 }))]);
  const { service } = createService({ database });
  const result = await service.searchForPurchase({ q: "😀".repeat(190), pageSize: 100 });
  assert.equal(result.items.length, 100);
  assert.equal(result.items[99].uoms[0].skuUomId, 1109);
  assert.equal(database.calls.length, 3);
});

test("Sales search owns bounded count/page qualification and exact price projection with a constant query budget", async () => {
  const database = fakeDatabase([[{ total: 5 }], [saleSku()], [saleUom()]]), { service } = createService({ database });
  const result = await service.searchForSale({ q: "SKU_%", barcode: "1234-56 78", page: 2, pageSize: 1, atMs: NOW_MS });
  assert.equal(result.total, 5);assert.equal(result.page, 2);assert.equal(result.pageSize, 1);
  assert.equal(result.items[0].suggestedPrice.amount, "12.3400");assert.equal(result.items[0].uoms[0].skuUomId, 91);
  assert.equal(database.calls.length, 3);
  assert.deepEqual(database.calls[0].params, [NOW_MS, NOW_MS, "SKU!_!%%", "SKU!_!%%", "SKU!_!%%", "12345678"]);
});
test("Sales search rejects unsafe query bounds before SQL and fails closed on unusable provider rows", async () => {
  const empty = fakeDatabase([]), { service } = createService({ database: empty });
  for (const input of [{ page: 0 }, { pageSize: 101 }, { q: "\n" }, { barcode: [] }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }])
    await assert.rejects(() => service.searchForSale(input), TypeError);
  assert.equal(empty.calls.length, 0);
  const invalid = createService({ database: fakeDatabase([[{ total: 1 }], [skuRow({ sku_status: "inactive" })], [saleUom()]]) }).service;
  await assert.rejects(() => invalid.searchForSale({}), error => error.code === "SKU_NOT_USABLE" && error.details.purpose === "new_sale" && error.details.reasons.includes("STATUS_NOT_ACTIVE"));
});

test("Sales named lookup includes mapping identity, versions and exact stored price with a constant query budget", async () => {
  const database = fakeDatabase([[saleSku()], [saleUom()]]);
  const { service } = createService({ database });
  const result = await service.findManyForSale([10, 10], { atMs: NOW_MS });
  assert.equal(database.calls.length, 2);
  assert.equal(result.size, 1);
  assert.equal(result.get(10).skuVersion, 3);
  assert.equal(result.get(10).itemVersion, 2);
  assert.deepEqual(result.get(10).suggestedPrice, { amount: "12.3400", currency: "HKD", taxBasis: "tax_not_applicable" });
  assert.deepEqual(result.get(10).uoms[0], {
    skuUomId: 91, uomId: 5, uomCode: "EA", uomName: "Each", status: "active",
    uomVersion: 4, mappingVersion: 5, toBaseFactor: 1, isBase: true, isDefaultPurchase: false, isDefaultSale: true
  });
  const lookup = createService({ database: fakeDatabase([[saleSku()], [saleUom()]]) }).service;
  assert.equal((await lookup.findSaleUom(10, 91)).skuUomId, 91);
  const wrongId = createService({ database: fakeDatabase([[saleSku()], [saleUom()]]) }).service;
  assert.equal(await wrongId.findSaleUom(10, 5), null, "master UOM ID is not mapping ID");
});

test("Sales named eligibility is Active-only without changing generic clearance sales", async () => {
  for (const [overrides, reason] of [
    [{ sku_status: "discontinued" }, "STATUS_NOT_ACTIVE"],
    [{ item_status: "discontinued" }, "STATUS_NOT_ACTIVE"],
    [{ sellable: 0 }, "NOT_SELLABLE"],
    [{ effective_from: NOW_MS + 1 }, "OUTSIDE_EFFECTIVE_RANGE"],
    [{ effective_to: NOW_MS - 1 }, "OUTSIDE_EFFECTIVE_RANGE"],
    [{ tracking_policy: "serial" }, "SERIAL_NOT_SUPPORTED"]
  ]) {
    const { service } = createService({ database: fakeDatabase([[{ ...saleSku(), ...overrides }], [saleUom()]]) });
    const result = (await service.findManyForSale([10])).get(10);
    assert.equal(result.usable, false);
    assert.ok(result.reasons.includes(reason));
  }
  const { service } = createService({ database: fakeDatabase([[saleSku()], [saleUom()]]) });
  assert.equal((await service.findManyForSale([10], { atMs: NOW_MS })).get(10).usable, true);
});

test("Sales lookup validates bounds before SQL and fails closed for invalid conversion", async () => {
  const database = fakeDatabase([]);
  const { service } = createService({ database });
  for (const ids of [[0], [1.5], Array.from({ length: 101 }, (_, i) => i + 1)]) {
    await assert.rejects(() => service.findManyForSale(ids), TypeError);
  }
  await assert.rejects(() => service.findManyForSale([10], { purpose: "sale" }), TypeError);
  await assert.rejects(() => service.findManyForSale([10], { atMs: -1 }), TypeError);
  assert.equal((await service.findManyForSale([])).size, 0);
  assert.equal(database.calls.length, 0);
  for (const factor of [0, 1.5, 1_000_001, 2]) {
    const invalid = createService({ database: fakeDatabase([[saleSku()], [saleUom({ to_base_factor: factor })]]) }).service;
    await assert.rejects(() => invalid.findManyForSale([10]), { code: "UOM_CONVERSION_INVALID" });
  }
});

function saleTransaction(count = 1, { mapping = {}, sku = {}, uom = {} } = {}) {
  const ids = Array.from({ length: count }, (_, i) => i + 10);
  return fakeDatabase([
    ids.map(id => ({ sku_id: id, item_id: 1, id: id + 81, uom_id: 5 })),
    [{ id: 5, code: "EA", name: "Each", status: "active", version: 4, ...uom }],
    [{ id: 1, name: "Item 1", product_type: "standard", status: "active", version: 2 }],
    ids.map(id => ({ ...saleSku(), id, item_id: 1, ...sku })),
    ids.map(id => ({ ...saleUom(), id: id + 81, sku_id: id, ...mapping }))
  ]);
}

test("Sales transaction snapshots use UOM→Item→SKU→mapping SHARE locks and fixed queries for 1 or 100 lines", async () => {
  for (const count of [1, 100]) {
    const transaction = saleTransaction(count);
    const database = fakeDatabase([]);
    const { service } = createService({ database });
    const requests = Array.from({ length: count }, (_, i) => ({ skuId: i + 10, skuUomId: i + 91 })).reverse();
    const result = await service.getSalesSnapshotsInTransaction(transaction, [...requests, requests[0]], { atMs: NOW_MS });
    assert.equal(result.length, count);
    assert.equal(result[0].skuId, 10);
    assert.equal(result[0].salesUom.skuUomId, 91);
    assert.equal(result[0].suggestedPrice.amount, "12.3400");
    assert.equal(transaction.calls.length, 5);
    assert.equal(database.calls.length, 0);
    for (const [index, table] of [[1, "item_uoms"], [2, "items"], [3, "item_skus"], [4, "item_sku_uoms"]]) {
      assert.match(transaction.calls[index].sql, new RegExp(`FROM ${table} .*ORDER BY (?:s\\.)?id FOR SHARE`, "s"));
      assert.doesNotMatch(transaction.calls[index].sql, /FOR UPDATE/);
    }
  }
});

test("Sales snapshots reject changed associations, cross-SKU mapping, inactive UOM and unavailable SKU", async () => {
  const { service } = createService({ database: fakeDatabase([]) });
  for (const options of [{ mapping: { uom_id: 6 } }, { mapping: { sku_id: 11 } }, { uom: { status: "inactive" } }]) {
    await assert.rejects(() => service.getSalesSnapshotsInTransaction(saleTransaction(1, options), [{ skuId: 10, skuUomId: 91 }]), { code: "UOM_CONVERSION_INVALID" });
  }
  await assert.rejects(() => service.getSalesSnapshotsInTransaction(saleTransaction(1, { sku: { sku_status: "inactive" } }), [{ skuId: 10, skuUomId: 91 }]), { code: "SKU_NOT_USABLE" });
  await assert.rejects(() => service.getSalesSnapshotsInTransaction(null, []), TypeError);
  await assert.rejects(() => service.getSalesSnapshotsInTransaction(saleTransaction(), Array.from({ length: 101 }, (_, i) => ({ skuId: i + 1, skuUomId: i + 1 }))), TypeError);
});

test("Sales Inventory profiles reuse current snapshots with six caller-only queries for 1/100 SKUs", async () => {
  for (const count of [1, 100]) {
    const snapshots = saleTransaction(count);
    const calls = [];
    const ids = Array.from({ length: count }, (_, i) => i + 10);
    const transaction = { async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [ids.map(id => ({ sku_id: id, id: id + 81 }))];
      return snapshots.query(sql, params);
    } };
    const database = fakeDatabase([]);
    const { service } = createService({ database });
    const profiles = await service.getSalesInventoryProfilesInTransaction(transaction, ids, { atMs: NOW_MS });
    assert.equal(profiles.size, count);
    assert.equal(profiles.get(10).salesUom.isBase, true);
    assert.equal(profiles.get(10).minimumSaleLifeDays, null);
    assert.equal(calls.length, 6);
    assert.equal(database.calls.length, 0);
  }
});

test("Sales Inventory profile discovery rejects 101 SKUs, missing Base and current Base reassignment", async () => {
  const { service } = createService({ database: fakeDatabase([]) });
  const transaction = fakeDatabase([]);
  await assert.rejects(() => service.getSalesInventoryProfilesInTransaction(transaction, Array.from({ length: 101 }, (_, i) => i + 1)), TypeError);
  assert.equal(transaction.calls.length, 0);
  await assert.rejects(() => service.getSalesInventoryProfilesInTransaction(fakeDatabase([[]]), [10]), { code: "UOM_CONVERSION_INVALID" });
  const current = saleTransaction(1, { mapping: { is_base: 0 } });
  let calls = 0;
  await assert.rejects(() => service.getSalesInventoryProfilesInTransaction({ async query(sql, params) {
    if (calls++ === 0) return [[{ sku_id: 10, id: 91 }]];
    return current.query(sql, params);
  } }, [10]), { code: "UOM_CONVERSION_INVALID" });
});

test("ItemLookupService constructor requires database, logger and time", () => {
  assert.throws(() => new ItemLookupService({}), TypeError);
  assert.throws(() => new ItemLookupService({ database: {} }), TypeError);
  assert.throws(() => new ItemLookupService({ database: {}, logger: collectingLogger() }), TypeError);
});

// --- findById／findByCode ----------------------------------------------------

test("findById 搵唔到就回 null，唔會多打一次 UOM query", async () => {
  const database = fakeDatabase([[]]);
  const { service } = createService({ database });

  const result = await service.findById(999);

  assert.equal(result, null);
  assert.equal(database.calls.length, 1);
});

test("findById 搵到就回完整 projection，連 UOM 一齊", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10);

  assert.equal(result.skuId, 10);
  assert.equal(result.skuCode, "SKU-1");
  assert.equal(result.itemId, 1);
  assert.equal(result.uoms.length, 1);
  assert.equal(result.uoms[0].uomCode, "EA");
  assert.equal(result.usable, true, "冇帶 purpose 時預設淨係睇未封存");
});

test("findByCode 用返 sku_code 查", async () => {
  const database = fakeDatabase([[skuRow({ sku_code: "ABC" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findByCode("ABC");

  assert.equal(result.skuCode, "ABC");
  assert.match(database.calls[0].sql, /s\.sku_code = \?/);
  assert.deepEqual(database.calls[0].params, ["ABC"]);
});

// --- findByBarcode -----------------------------------------------------------

test("findByBarcode 搵到一個就正常回 projection", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findByBarcode("4710088412345");

  assert.equal(result.skuId, 10);
});

test("findByBarcode 撞到一個以上：拋 BARCODE_LOOKUP_INCONSISTENT，記 error log，唔會攞第一筆將貨", async () => {
  const database = fakeDatabase([[skuRow({ id: 10 }), skuRow({ id: 11 })]]);
  const { service, logger } = createService({ database });

  await assert.rejects(() => service.findByBarcode("4710088412345"), { code: "BARCODE_LOOKUP_INCONSISTENT" });
  assert.equal(database.calls.length, 1, "唔應該再打 UOM query");
  assert.equal(logger.entries.filter((e) => e.level === "error").length, 1);
});

test("findByBarcode 對數字條碼剝走空格／連字號先查", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  await service.findByBarcode("471-0088 412345");

  assert.deepEqual(database.calls[0].params, ["4710088412345"]);
});

// --- findManyByIds -----------------------------------------------------------

test("findManyByIds 對 100 個 id 都係固定兩條 query，唔逐個查", async () => {
  const database = fakeDatabase([
    [skuRow({ id: 10 }), skuRow({ id: 20 })],
    [uomRow({ sku_id: 10 }), uomRow({ sku_id: 20, uom_id: 6 })]
  ]);
  const { service } = createService({ database });

  const result = await service.findManyByIds([10, 20, 10]);

  assert.equal(database.calls.length, 2);
  assert.equal(result.size, 2);
  assert.equal(result.get(10).uoms.length, 1);
  assert.equal(result.get(20).uoms[0].uomId, 6);
});

test("findManyByIds 搵唔到嘅 id 唔會出現喺個 map 度", async () => {
  const database = fakeDatabase([[skuRow({ id: 10 })], [uomRow({ sku_id: 10 })]]);
  const { service } = createService({ database });

  const result = await service.findManyByIds([10, 999]);

  assert.equal(result.size, 1);
  assert.equal(result.has(999), false);
});

test("findManyByIds 空陣列完全唔打 DB", async () => {
  const database = fakeDatabase([]);
  const { service } = createService({ database });

  const result = await service.findManyByIds([]);

  assert.equal(result.size, 0);
  assert.equal(database.calls.length, 0);
});

// --- assertUsable ------------------------------------------------------------

test("assertUsable：SKU 唔存在拋 SKU_NOT_FOUND", async () => {
  const database = fakeDatabase([[]]);
  const { service } = createService({ database });

  await assert.rejects(() => service.assertUsable(999, { purpose: "purchase" }), { code: "SKU_NOT_FOUND" });
});

test("assertUsable：存在但唔啱 purpose 拋 SKU_NOT_USABLE，帶埋 reasons", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "discontinued" })], [uomRow()]]);
  const { service } = createService({ database });

  await assert.rejects(() => service.assertUsable(10, { purpose: "purchase" }), (error) => {
    assert.equal(error.code, "SKU_NOT_USABLE");
    assert.ok(error.details.reasons.includes("STATUS_NOT_ACTIVE"));
    return true;
  });
});

test("assertUsable：啱就返個 projection", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.assertUsable(10, { purpose: "purchase" });

  assert.equal(result.usable, true);
});

// --- purpose 規則：purchase ---------------------------------------------------

test("purchase：Item 同 SKU 都 active、purchasable、喺有效期內 → usable", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "purchase" });

  assert.equal(result.usable, true);
  assert.deepEqual(result.reasons, []);
});

test("purchase：SKU discontinued 就拒絕", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "discontinued" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "purchase" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("STATUS_NOT_ACTIVE"));
});

test("purchase：purchasable=false 就拒絕", async () => {
  const database = fakeDatabase([[skuRow({ purchasable: 0 })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "purchase" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("NOT_PURCHASABLE"));
});

test("purchase：唔喺 effective 範圍內就拒絕", async () => {
  const database = fakeDatabase([
    [skuRow({ effective_from: NOW_MS - 5000, effective_to: NOW_MS - 1000 })],
    [uomRow()]
  ]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "purchase" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("OUTSIDE_EFFECTIVE_RANGE"));
});

test("purchase：帶明確 atMs 就用嗰個時間，唔用 time.nowMs()", async () => {
  const database = fakeDatabase([
    [skuRow({ effective_from: 1000, effective_to: 2000 })],
    [uomRow()]
  ]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "purchase", atMs: 1500 });

  assert.equal(result.usable, true);
});

// --- purpose 規則：sale --------------------------------------------------------

test("sale：Item active、SKU discontinued 都算 usable（清貨）", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "discontinued" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "sale" });

  assert.equal(result.usable, true);
});

test("sale：Item 同 SKU 都 discontinued 都算 usable", async () => {
  const database = fakeDatabase([
    [skuRow({ item_status: "discontinued", sku_status: "discontinued" })],
    [uomRow()]
  ]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "sale" });

  assert.equal(result.usable, true);
});

test("sale：Item active、SKU draft 唔算 usable", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "draft" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "sale" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("STATUS_NOT_SELLABLE"));
});

test("sale：sellable=false 就拒絕", async () => {
  const database = fakeDatabase([[skuRow({ sellable: 0 })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "sale" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("NOT_SELLABLE"));
});

// --- purpose 規則：inventory ---------------------------------------------------

test("inventory：inventoryTracked、Active、未封存 → usable", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "inventory" });

  assert.equal(result.usable, true);
});

test("inventory：inventoryTracked=false 就拒絕", async () => {
  const database = fakeDatabase([[skuRow({ inventory_tracked: 0 })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "inventory" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("NOT_INVENTORY_TRACKED"));
});

test("inventory：Inactive 冇帶 includeInactive 就拒絕", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "inactive" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "inventory" });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("NOT_ACTIVE"));
});

test("inventory：Inactive 但帶明確 includeInactive:true 就通過", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "inactive" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "inventory", includeInactive: true });

  assert.equal(result.usable, true);
});

test("inventory：Archived 就算帶 includeInactive 都唔通過", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "archived" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10, { purpose: "inventory", includeInactive: true });

  assert.equal(result.usable, false);
  assert.ok(result.reasons.includes("ARCHIVED"));
});

// --- 其他 -----------------------------------------------------------------

test("未知嘅 purpose 拋 TypeError", async () => {
  const database = fakeDatabase([[skuRow()], [uomRow()]]);
  const { service } = createService({ database });

  await assert.rejects(() => service.findById(10, { purpose: "shipping" }), TypeError);
});

test("冇帶 purpose：淨係睇未封存", async () => {
  const database = fakeDatabase([[skuRow({ sku_status: "archived" })], [uomRow()]]);
  const { service } = createService({ database });

  const result = await service.findById(10);

  assert.equal(result.usable, false);
  assert.deepEqual(result.reasons, ["ARCHIVED"]);
});

// --- Inventory transaction contract -----------------------------------------

function inventoryTransaction(sku = skuRow(), uom = uomRow()) {
  return fakeDatabase([
    [{ sku_id: sku.id, item_id: sku.item_id, id: 91, uom_id: uom.uom_id }],
    [{ id: uom.uom_id, code: uom.uom_code, name: "Each", status: "active", version: 1 }],
    [{ id: sku.item_id, name: sku.item_name, product_type: sku.product_type, status: sku.item_status, version: 1 }],
    [sku], [{ ...uom, id: 91, version: 1 }]
  ]);
}

test("Inventory profile uses only the caller transaction and returns a narrow projection", async () => {
  const database = fakeDatabase([]);
  const transaction = inventoryTransaction(skuRow({ tracking_policy: "serial", shelf_life_days: 90, min_receipt_life_days: 30 }));
  const { service } = createService({ database });

  const result = await service.getInventoryProfileInTransaction(transaction, 10);

  assert.equal(database.calls.length, 0);
  assert.equal(transaction.calls.length, 5);
  for (const call of transaction.calls.slice(1)) assert.match(call.sql, /FOR SHARE/u);
  assert.deepEqual(Object.keys(result).sort(), [
    "baseUom", "inventoryTracked", "itemStatus", "minimumReceiptLifeDays",
    "minimumSaleLifeDays", "reasons", "shelfLifeDays", "skuCode", "skuId",
    "skuName", "skuStatus", "trackingPolicy", "usable"
  ]);
  assert.equal(result.skuName, "SKU One");
  assert.deepEqual(result.baseUom, { uomId: 5, uomCode: "EA" });
  assert.equal(result.trackingPolicy, "serial", "Inventory must see serial and fail closed");
});

test("Inventory profile preserves Item lifecycle eligibility", async () => {
  for (const [status, expectedReason] of [
    ["inactive", "NOT_ACTIVE"],
    ["discontinued", "NOT_ACTIVE"],
    ["archived", "ARCHIVED"]
  ]) {
    const transaction = inventoryTransaction(skuRow({ sku_status: status }));
    const { service } = createService({ database: fakeDatabase([]) });
    const result = await service.getInventoryProfileInTransaction(transaction, 10);
    assert.equal(result.usable, false);
    assert.ok(result.reasons.includes(expectedReason));
  }
});

test("Inventory UOM resolution uses the caller transaction and validates integer factors", async () => {
  const database = fakeDatabase([]);
  const transaction = inventoryTransaction(skuRow(), uomRow({ to_base_factor: 12, is_base: 0 }));
  const { service } = createService({ database });

  assert.deepEqual(await service.resolveUomInTransaction(transaction, 10, 5), {
    skuId: 10,
    uomId: 5,
    uomCode: "EA",
    toBaseFactor: 12,
    isBase: false
  });
  assert.equal(database.calls.length, 0);

  for (const factor of [0, 1.5, 1_000_001]) {
    const invalidTransaction = inventoryTransaction(skuRow(), uomRow({ to_base_factor: factor }));
    await assert.rejects(
      () => service.resolveUomInTransaction(invalidTransaction, 10, 5),
      { code: "UOM_CONVERSION_INVALID" }
    );
  }
});

test("Inventory transaction methods reject a missing executor", async () => {
  const { service } = createService({ database: fakeDatabase([]) });
  await assert.rejects(() => service.getInventoryProfileInTransaction(null, 10), TypeError);
  await assert.rejects(() => service.resolveUomInTransaction({}, 10, 5), TypeError);
});


test("TC-035 Item code/UOM precheck batch preserves per-member missing/inactive and one bounded caller query",async()=>{
 const rows=[{...saleSku(),request_index:0,mapping_id:91,mapping_version:5,uom_id:5,uom_code:"EA",uom_name:"Each",uom_status:"active",uom_version:4,to_base_factor:1,is_base:1,is_default_sale:1},
 {...saleSku(),request_index:1,sku_status:"discontinued",mapping_id:null}];
 const tx=fakeDatabase([rows]),{service}=createService({database:{query(){throw new Error("Pool forbidden");}}});
 const result=await service.resolveSaleCodesInTransaction(tx,[{skuCode:"sku-1",salesUomCode:"ea"},{skuCode:"SKU-1",salesUomCode:"MISSING"},{skuCode:"MISSING",salesUomCode:"EA"}],{atMs:NOW_MS});
 assert.equal(tx.calls.length,1);assert.equal(result.length,3);assert.equal(result[0].sku.skuId,10);assert.equal(result[0].salesUom.skuUomId,91);assert.equal(result[0].skuCode,"sku-1");assert.equal(result[1].sku.usable,false);assert.equal(result[1].salesUom,null);assert.equal(result[2].sku,null);
 assert.deepEqual(await service.resolveSaleCodesInTransaction(tx,[]),[]);assert.equal(tx.calls.length,1);
 for(const requests of [[{skuCode:"",salesUomCode:"EA"}],Array.from({length:101},(_,i)=>({skuCode:"SKU"+i,salesUomCode:"EA"}))])await assert.rejects(()=>service.resolveSaleCodesInTransaction(tx,requests),TypeError);
 assert.equal(tx.calls.length,1);
});

test("Inventory transaction methods preserve null for a missing SKU or UOM", async () => {
  const { service } = createService({ database: fakeDatabase([]) });
  assert.equal(await service.getInventoryProfileInTransaction(fakeDatabase([[]]), 10), null);
  assert.equal(await service.resolveUomInTransaction(fakeDatabase([[]]), 10, 5), null);
  assert.equal(await service.resolveUomInTransaction(inventoryTransaction(), 10, 999), null);
});
