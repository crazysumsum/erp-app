import assert from "node:assert/strict";
import test from "node:test";
import { precheckInventoryOpeningCsv } from "../src/modules/inventory/opening/inventoryOpeningPrecheck.js";

const header = "warehouseCode,binCode,skuCode,lotNumber,expiryDate,stockStatus,baseQuantity";

function csv(...rows) {
  return Buffer.from([header, ...rows].join("\n"));
}

function fixture({ occupied = new Set(), lots = new Map() } = {}) {
  const skuCalls = [];
  const queries = [];
  const sku = {
    SKU1: { skuId: 31, trackingPolicy: "none" },
    SKU2: { skuId: 32, trackingPolicy: "batch_expiry" }
  };
  const itemLookup = {
    async findByCode(code, options) {
      assert.deepEqual(options, { purpose: "inventory" });
      skuCalls.push(code);
      const item = sku[code.toUpperCase()];
      return item ? { ...item, usable: true, inventoryTracked: true, uoms: [{ uomId: 1, isBase: true, toBaseFactor: 1 }] } : null;
    }
  };
  const reader = {
    async query(sql, params) {
      assert.match(sql.trim(), /^SELECT\b/u);
      queries.push(sql);
      if (sql.includes("FROM inventory_bins")) {
        const binId = { B1: 11, B2: 12, B3: 13 }[params[1]];
        return [params[0] === "W1" && binId ? [{ warehouse_id: 1, warehouse_version: 4, bin_id: binId, bin_version: 2 }] : []];
      }
      if (sql.includes("FROM inventory_lots")) {
        const lot = lots.get(JSON.stringify(params));
        return [lot ? [lot] : []];
      }
      assert.match(sql, /FROM inventory_stock_balances/u);
      assert.match(sql, /FROM inventory_movements/u);
      assert.doesNotMatch(sql, /stock_status\s*=/u);
      assert.deepEqual(params.slice(0, 4), params.slice(4));
      return [[{ occupied: Number(occupied.has(JSON.stringify(params.slice(0, 4)))) }]];
    }
  };
  return { reader, itemLookup, skuCalls, queries };
}

test("Opening precheck resolves SKU and location and permits distinct bins for the same new lot", async () => {
  const deps = fixture();
  const result = await precheckInventoryOpeningCsv(csv(
    "w1,b1,SKU2,L1,2027-01-01,AVAILABLE,3",
    "W1,B2,SKU2,L1,2027-01-01,AVAILABLE,2",
    "W1,B3,SKU1,,,AVAILABLE,0"
  ), deps);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skippedRows, [4]);
  assert.deepEqual(result.rows.map(row => [row.row, row.warehouseId, row.binId, row.skuId,
    row.normalizedLotNumber, row.lotId, row.baseQuantity]), [
    [2, 1, 11, 32, "L1", null, 3],
    [3, 1, 12, 32, "L1", null, 2]
  ]);
  assert.deepEqual(deps.skuCalls, ["SKU2"]);
});

test("Opening precheck rejects the whole file and lists duplicate buckets and checks occupied positions across statuses", async () => {
  const deps = fixture({ occupied: new Set(["[1,12,31,null]"]) });
  const result = await precheckInventoryOpeningCsv(csv(
    "W1,B1,SKU1,,,AVAILABLE,3",
    "w1,b1,sku1,,,AVAILABLE,2",
    "W1,B2,SKU1,,,QUARANTINED,5"
  ), deps);

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [
    { row: 2, field: "row", code: "OPENING_DUPLICATE_BUCKET" },
    { row: 3, field: "row", code: "OPENING_DUPLICATE_BUCKET" },
    { row: 4, field: "row", code: "OPENING_POSITION_OCCUPIED" }
  ]);
});

test("Opening precheck requires Item batch fields and rejects contradictory expiry for a lot", async () => {
  const deps = fixture({ lots: new Map([['[32,"OLD"]', { id: 74, expiry_date: "2027-02-01" }]]) });
  const result = await precheckInventoryOpeningCsv(csv(
    "W1,B1,SKU2,,2027-01-01,AVAILABLE,3",
    "W1,B1,SKU2,L1,,AVAILABLE,3",
    "W1,B1,SKU1,L1,,AVAILABLE,3",
    "W1,B1,SKU2,L2,2027-01-01,AVAILABLE,3",
    "W1,B2,SKU2,L2,2027-02-01,AVAILABLE,3",
    "W1,B3,SKU2,OLD,2027-03-01,AVAILABLE,3"
  ), deps);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [
    { row: 2, field: "lotNumber", code: "LOT_REQUIRED" },
    { row: 3, field: "expiryDate", code: "EXPIRY_REQUIRED" },
    { row: 4, field: "lotNumber", code: "INVENTORY_INPUT_INVALID" },
    { row: 5, field: "expiryDate", code: "LOT_DATA_CONFLICT" },
    { row: 6, field: "expiryDate", code: "LOT_DATA_CONFLICT" },
    { row: 7, field: "expiryDate", code: "LOT_DATA_CONFLICT" }
  ]);
});
