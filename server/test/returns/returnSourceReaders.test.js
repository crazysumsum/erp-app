import assert from "node:assert/strict";
import test from "node:test";
import { MySqlDatabaseService } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { findShipmentReturnsInTransaction } from "../../src/modules/returns/findShipmentReturnsInTransaction.js";
import { readPostedSupplierReturnQuantitiesInTransaction } from "../../src/modules/returns/readPostedSupplierReturnQuantitiesInTransaction.js";

function transaction(onSelect) {
  let current = {};
  const context = { get: () => current, update: patch => { current = { ...current, ...patch }; } };
  const connection = {
    async query(options, params) {
      const sql = typeof options === "string" ? options : options.sql;
      return sql.startsWith("SET ") ? [[]] : [onSelect(sql, params)];
    },
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, destroy() {}
  };
  return new MySqlDatabaseService({
    pool: { query: connection.query, getConnection: async () => connection },
    context,
    config: { acquireTimeoutMs: 1000, queryTimeoutMs: 1000, transactionTimeoutMs: 1000 }
  });
}

test("shipment return lookup counts drafts and posted returns and fills absent requested shipments", async () => {
  const db = transaction((sql, params) => {
    assert.match(sql, /FROM customer_returns/u);
    assert.match(sql, /status IN \('DRAFT', 'POSTED'\)/u);
    assert.match(sql, /FOR SHARE$/u);
    assert.deepEqual(params, ["12", "9"]);
    return [{ shipment_id: "9" }, { shipment_id: "9" }];
  });
  await db.withTransaction(async tx => {
    assert.deepEqual(await findShipmentReturnsInTransaction(tx, { shipmentIds: ["12", "9"] }), [
      { shipmentId: "12", openReturnCount: 0 }, { shipmentId: "9", openReturnCount: 2 }
    ]);
  }, { isolationLevel: "READ COMMITTED" });
});

test("supplier return quantity lookup reads only posted movements and preserves exact totals", async () => {
  const db = transaction((sql, params) => {
    assert.match(sql, /FROM supplier_return_lines/u);
    assert.match(sql, /inventory_movement_id IS NOT NULL/u);
    assert.match(sql, /FOR SHARE$/u);
    assert.deepEqual(params, ["8", "4", "5"]);
    return [
      { goods_receipt_detail_id: "4", base_quantity: "9007199254740991" },
      { goods_receipt_detail_id: "4", base_quantity: "123" }
    ];
  });
  await db.withTransaction(async tx => {
    assert.deepEqual(await readPostedSupplierReturnQuantitiesInTransaction(tx, {
      goodsReceiptId: "8", goodsReceiptDetailIds: ["4", "5"]
    }), new Map([["4", "9007199254741114"], ["5", "0"]]));
  });
});

test("return source readers require the caller's active transaction at the agreed isolation", async () => {
  const db = transaction(() => assert.fail("invalid call issued SQL"));
  await db.withTransaction(async tx => {
    await assert.rejects(findShipmentReturnsInTransaction(tx, { shipmentIds: ["1"] }), TypeError);
  });
  await db.withTransaction(async tx => {
    await assert.rejects(readPostedSupplierReturnQuantitiesInTransaction(tx, {
      goodsReceiptId: "8", goodsReceiptDetailIds: ["4"]
    }), TypeError);
    await assert.rejects(findShipmentReturnsInTransaction(tx, { shipmentIds: ["1", "1"] }), TypeError);
  }, { isolationLevel: "READ COMMITTED" });
});
