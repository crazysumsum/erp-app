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

test("constructor requires database, logger and time", () => {
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
