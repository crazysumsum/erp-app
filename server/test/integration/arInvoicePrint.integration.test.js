import assert from "node:assert/strict";
import test from "node:test";
import { readInvoiceShipmentReferences } from "../../src/modules/fulfillment/readInvoiceShipmentReferences.js";
import { arHttpShipmentFixture } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("發票列印的來源編號逐張按出貨 ID 回傳，沖銷後仍可讀，缺來源拒絕", async (t) => {
  const { db, shipmentIds } = await arHttpShipmentFixture(t, { includeSecond: true });
  const [first, second] = shipmentIds;
  const [expected] = await db.query(`SELECT s.id, s.shipment_number, o.sales_order_number
    FROM shipments s JOIN sales_orders o ON o.id = s.sales_order_id WHERE s.id IN (?,?) ORDER BY s.id`, [first, second]);
  const references = expected.map((row) => ({
    shipmentId: Number(row.id), shipmentNumber: row.shipment_number, salesOrderNumber: row.sales_order_number
  }));
  // 只在隔離庫變更狀態，驗證唯讀編號查詢其後仍可用。
  await db.query("UPDATE shipments SET status = 'REVERSING', version = version + 1 WHERE id = ?", [first]);
  await db.query("UPDATE shipments SET status = 'REVERSED', version = version + 1 WHERE id = ?", [first]);
  assert.deepEqual(await readInvoiceShipmentReferences(db, [second, first]), references);
  await assert.rejects(readInvoiceShipmentReferences(db, [first, first]), { code: "FULFILLMENT_INPUT_INVALID" });
  await assert.rejects(readInvoiceShipmentReferences(db, [first, Number.MAX_SAFE_INTEGER]), { code: "SHIPMENT_NOT_FOUND" });
});
