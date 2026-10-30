import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import { LookupInventorySkuHandler } from "../src/handlers/inventory/skuLookupHandlers.js";
import { STOCKTAKE_QUERIES, normalizeStocktakeQuery } from "../src/handlers/inventory/stocktakeSchemas.js";
import { stocktakeLineFilters, stocktakeLineBatch, stocktakeSummary, projectStocktakeLine } from "../src/modules/inventory/InventoryInquiryService.js";
import { InventoryStocktakeExportService } from "../src/modules/inventory/InventoryStocktakeExportService.js";

const time = { nowMs: () => 1791763200000, fileDate: () => "2026-10-12" };
const header = { id: 41, warehouse_id: 1, stocktake_number: "ST41", status: "COUNTING", version: 2, started_at: 10, ready_at: null };
const line = { id: 201, stocktake_id: 41, stocktake_bin_id: 101, bin_id: 1, sku_id: 12, lot_id: null,
  stock_status: "AVAILABLE", stock_balance_id: 301, snapshot_quantity: 5, snapshot_balance_version: 1,
  counted_quantity: 3, is_not_found: 0, variance_quantity: null, version: 2, counted_at: 17, counted_by: 7,
  movement_id: null, bin_code_snapshot: "B1", bin_code: "B1", sku_code: "SKU12", sku_name: "Name 中文",
  lot_number: null, base_uom_id: 1, base_uom_code: "EA" };
const totals = { totalLines: 1, countedLines: 1, notFoundLines: 0, uncountedLines: 0, gainLines: 0, lossLines: 1, zeroLines: 0, corruptLines: 0 };
function request(query) {
  const req = { params: {}, query, body: undefined, headers: {} };
  new RequestValidator().compile(LookupInventorySkuHandler.api.requestSchema, "lookup")(req);
  return req;
}
// Isolated executor fixtures exercise real Item/Inventory code, not real DB behavior.
function lookupFixture({ sku = {}, uom = {}, missing = false, multi = false, failure } = {}) {
  const calls = [], row = { id: 12, sku_code: "SKU-%_", sku_name: "Lookup SKU", sku_status: "active",
    item_status: "active", item_id: 1, item_name: "private", product_type: "standard", inventory_tracked: 1,
    tracking_policy: "none", purchasable: 0, sellable: 0, suggested_price_amount: "99.0000", ...sku };
  const tx = { async query(sql, params) {
    calls.push({ sql, params }); if (failure) throw failure;
    if (sql.includes("FROM item_sku_uoms")) return [[{ sku_id: 12, uom_id: 4, uom_code: "EA", is_base: 1, to_base_factor: 1, ...uom }]];
    assert.match(sql, /FROM item_skus/u);
    return [missing ? [] : multi && sql.includes("item_sku_barcodes") ? [row, { ...row, id: 13 }] : [row]];
  } };
  const database = { query() { throw new Error("escaped lookup transaction"); }, withTransaction: work => work(tx) };
  const handler = new LookupInventorySkuHandler({ require(name) {
    if (name === "mysqldatabase") return database;
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return time;
    throw new Error(name);
  } });
  return { calls, lookup: async query => (await handler.execute(request(query))).data };
}
test("ST040-U01 old Code keeps view policy, literal identity and minimum shape", async () => {
  const f = lookupFixture(), result = await f.lookup({ code: "  SKU-%_  " });
  assert.deepEqual(result, { skuId: 12, skuCode: "SKU-%_", skuName: "Lookup SKU", trackingPolicy: "none", baseUom: { uomId: 4, uomCode: "EA" } });
  assert.deepEqual(f.calls[0].params, ["SKU-%_"]); assert.match(f.calls[0].sql, /s\.sku_code = \?/u);
  assert.deepEqual(LookupInventorySkuHandler.api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
  new ResponseValidator({ environment: "production" }).compile(LookupInventorySkuHandler.api.responseSchema, "lookup")(200, result);
});
test("ST040-U02 Barcode raw input rejects controls, blanks and oversize before Item lookup", async () => {
  const f = lookupFixture();
  for (const query of [{}, { code: "X", barcode: "Y" }, { barcode: 1 }, { barcode: ["X", "Y"] }, { barcode: "X", other: "Y" },
    { barcode: "" }, { barcode: "   " }, { barcode: "a".repeat(191) }, { barcode: "😀".repeat(191) }]) {
    await assert.rejects(f.lookup(query), { code: "REQUEST_VALIDATION_FAILED", statusCode: 400 });
  }
  for (const control of ["\u0000", "\t", "\r", "\n", "\u007f", "\u0085", "\u009f"]) {
    for (const barcode of [control + "known", "kn" + control + "own", "known" + control]) {
      await assert.rejects(f.lookup({ barcode }), { code: "REQUEST_VALIDATION_FAILED", statusCode: 400 });
    }
  }
  assert.equal(f.calls.length, 0);
  for (const barcode of ["1", "a".repeat(190), "😀".repeat(190)]) {
    await lookupFixture().lookup({ barcode });
  }
});
test("ST040-U03 Barcode uses pinned numeric/internal normalization and rejects inconsistent matches", async () => {
  for (const [barcode, normalized] of [[" 12-34 56 ", "123456"], ["  internal-12 ", "internal-12"]]) {
    const f = lookupFixture(); await f.lookup({ barcode });
    assert.match(f.calls[0].sql, /b\.normalized_barcode = \?/u); assert.deepEqual(f.calls[0].params, [normalized]);
  }
  await assert.rejects(lookupFixture({ multi: true }).lookup({ barcode: "known" }), { code: "BARCODE_LOOKUP_INCONSISTENT" });
});
test("ST040-U04 Barcode profile does not need Balance, Item permission or purchase/sale qualification", async () => {
  const f = lookupFixture({ sku: { tracking_policy: "batch" } }), result = await f.lookup({ barcode: "known" });
  assert.equal(result.trackingPolicy, "batch"); assert.equal(result.baseUom.uomCode, "EA");
  assert.ok(f.calls.every(call => !/inventory_stock/u.test(call.sql)));
  assert.equal(Object.hasOwn(result, "suggestedPrice"), false); assert.equal(Object.hasOwn(result, "itemName"), false);
});
test("ST040-U05 Barcode keeps Inventory unusable, serial and Base-UOM admission guards", async () => {
  for (const [sku, code] of [[{ inventory_tracked: 0 }, "SKU_NOT_INVENTORY_TRACKED"], [{ sku_status: "inactive" }, "INVENTORY_INPUT_INVALID"],
    [{ item_status: "archived" }, "INVENTORY_INPUT_INVALID"], [{ tracking_policy: "serial" }, "SERIAL_TRACKING_UNSUPPORTED"]]) {
    await assert.rejects(lookupFixture({ sku }).lookup({ barcode: "known" }), { code });
  }
  await assert.rejects(lookupFixture({ uom: { to_base_factor: 2 } }).lookup({ barcode: "known" }), { code: "UOM_CONVERSION_INVALID" });
});
test("ST040-U06 Stocktake q is literal, parameterized and correlated inside owned line predicates", () => {
  const filter = stocktakeLineFilters({ q: " %_!中文 " }, header);
  assert.match(filter.clause, /EXISTS\s*\(/u); assert.match(filter.clause, /\.id\s*=\s*l\.sku_id/u);
  assert.match(filter.clause, /sku_code LIKE \? ESCAPE '!'/u); assert.match(filter.clause, /sku_name LIKE \? ESCAPE '!'/u);
  assert.deepEqual(filter.params, [41, "%!%!_!!中文%", "%!%!_!!中文%"]);
  assert.doesNotMatch(filter.clause, /中文/u);
});
test("ST040-U07 Stocktake q raw bounds reject coercion and remain lines/export-only", () => {
  assert.deepEqual(normalizeStocktakeQuery({ q: " 中文 " }, "lines"), { q: "中文", page: 1, pageSize: 20 });
  assert.deepEqual(normalizeStocktakeQuery({ q: "" }, "export"), { q: "" });
  for (const q of [1, ["a"], "a".repeat(191), "\u0000x", "x\u0085"]) {
    assert.throws(() => normalizeStocktakeQuery({ q }, "lines"), { code: "INVENTORY_INPUT_INVALID" });
    assert.throws(() => stocktakeLineFilters({ q }, header), { code: "INVENTORY_INPUT_INVALID" });
  }
  for (const kind of ["list", "detail"]) assert.throws(() => normalizeStocktakeQuery({ q: "x" }, kind), { code: "INVENTORY_INPUT_INVALID" });
  assert.equal(Object.hasOwn(STOCKTAKE_QUERIES.export.properties, "q"), true);
});
test("ST040-U08 filtered summaries keep disjoint scalar counts and uncounted/notFound preview", async () => {
  let paramsSeen;
  const summary = await stocktakeSummary({ query: async (sql, params) => { assert.match(sql, /EXISTS/u); paramsSeen = params; return [[totals]]; } }, header, { q: "Name" });
  assert.deepEqual(paramsSeen, [41, "%Name%", "%Name%"]); assert.equal(summary.totalLines, 1); assert.equal(summary.lossLines, 1);
  assert.equal(projectStocktakeLine({ ...line, counted_quantity: null }, header).varianceQuantity, null);
  assert.equal(projectStocktakeLine({ ...line, counted_quantity: null, is_not_found: 1 }, header).varianceQuantity, -5);
  assert.equal(line.variance_quantity, null);
});
test("ST040-U09 text filtering stays inside at-most500 keyset candidates with stable ownership", async () => {
  const calls = [], result = await stocktakeLineBatch({ query: async (sql, params) => { calls.push({ sql, params }); return [[line]]; } }, header, { q: "中文", progress: "COUNTED" }, 200, 500);
  assert.equal(result[0].id, 201); assert.equal(calls[0].params.at(-1), 500); assert.equal(calls[0].params.at(-2), 200);
  assert.match(calls[0].sql, /FROM \(SELECT \* FROM inventory_stocktake_lines l.*EXISTS.*ORDER BY l\.id ASC LIMIT \?\) l/su);
  assert.deepEqual(calls[0].params.slice(0, 3), [41, "%中文%", "%中文%"]);
  await assert.rejects(stocktakeLineBatch({ query() { assert.fail("invalid bound reached SQL"); } }, header, { q: "x" }, 0, 501), { code: "INVENTORY_INPUT_INVALID" });
});
test("ST040-U10 unchanged CSV generator uses identical q predicates, retains empty scope and truthful summary", async () => {
  const calls = [], audits = [];
  const tx = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM inventory_stocktakes")) return [[header]];
    if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_bins")) return [[{ total: 1 }]];
    if (sql.includes("COUNT(*)") && sql.includes("inventory_stocktake_lines")) return [[totals]];
    if (sql.includes("inventory_stocktake_lines")) { assert.match(sql, /EXISTS/u); return [params.at(-2) < 201 ? [line] : []]; }
    if (sql.includes("inventory_stocktake_bins")) return [params.at(-2) < 101 ? [{ id: 101, stocktake_id: 41, bin_id: 1, bin_code_snapshot: "EMPTY", bin_code: "EMPTY" }] : []];
    assert.fail("unexpected export query");
  }, execute: async (sql, params) => { assert.match(sql, /INSERT INTO inventory_audit_logs/u); audits.push(params); return [{ affectedRows: 1 }]; } };
  const database = { query() {}, withTransaction: async work => work(tx) };
  const service = new InventoryStocktakeExportService({ database, time, logger: { error() {} } });
  service.createGenerationReader = () => ({ database, initialize: async () => database, close: async () => {} });
  const result = await service.prepare({ stocktakeId: 41, filters: { q: "中文" }, deadline: new Date(time.nowMs() + 120000).toISOString(),
    authorize: async () => ({ id: 7, username: "counter" }) });
  const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
  const rows = parse(Buffer.concat(chunks), { columns: true });
  assert.deepEqual(rows.map(row => row.recordType), ["SCOPE", "LINE", "SUMMARY"]);
  assert.equal(rows.at(-1).truncated, "false"); assert.equal(rows.at(-1).filteredLineCount, "1"); assert.equal(audits.length, 1);
  const lineCalls = calls.filter(call => call.sql.includes("inventory_stocktake_lines"));
  assert.deepEqual(lineCalls[0].params, [41]);
  assert.ok(lineCalls.slice(1).every(call => call.params.includes("%中文%")));
});
test("ST040-U11 explicit Code and Barcode modes never fall back to the other identity", async () => {
  const code = lookupFixture(), barcode = lookupFixture(); await code.lookup({ code: "collision" }); await barcode.lookup({ barcode: "collision" });
  assert.match(code.calls[0].sql, /s\.sku_code = \?/u); assert.doesNotMatch(code.calls[0].sql, /item_sku_barcodes/u);
  assert.match(barcode.calls[0].sql, /b\.normalized_barcode = \?/u);
});
test("ST040-U12 missing Barcode is safe not-found; errors never fabricate a profile or escape executor", async () => {
  const missing = lookupFixture({ missing: true }); await assert.rejects(missing.lookup({ barcode: "unknown" }), { code: "INVENTORY_RESOURCE_NOT_FOUND" });
  assert.equal(missing.calls.length, 1);
  const failure = Object.assign(new Error("controlled DB failure"), { code: "DATABASE_QUERY_TIMEOUT" });
  await assert.rejects(lookupFixture({ failure }).lookup({ barcode: "known" }), error => error === failure);
});
