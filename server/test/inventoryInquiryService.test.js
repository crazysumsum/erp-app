import assert from "node:assert/strict";
import test from "node:test";

import { InventoryInquiryService } from "../src/modules/inventory/InventoryInquiryService.js";

function databaseWith(...results) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (results.length === 0) throw new Error(`Unexpected query: ${sql}`);
      return results.shift();
    }
  };
}

const time = { fileDate: () => "2026-09-28" };

function stockRow(overrides = {}) {
  return {
    id: "12", warehouse_id: "1", warehouse_code: "WH-A", warehouse_name: "Main",
    bin_id: "2", bin_code: "A-01", bin_name: "Primary", sku_id: "3",
    sku_code: "SKU-3", sku_name: "Widget", lot_id: "4", lot_number: "LOT-4",
    expiry_date: "2026-10-31", manufacture_date: "2026-01-01",
    stock_status: "AVAILABLE", on_hand_quantity: "10", allocated_quantity: "3",
    base_uom_id: "5", base_uom_code: "EA", version: "6", internal_cost: "99.00",
    ...overrides
  };
}

function movementRow(overrides = {}) {
  return {
    id: "21", movement_group_id: "group-1", operation_request_id: "31",
    movement_type: "RECEIPT", location_kind: "BIN", warehouse_id: "1", bin_id: "2",
    sku_id: "3", lot_id: "4", stock_status: "AVAILABLE", direction: "IN", quantity: "8",
    balance_before: "2", balance_after: "10", balance_version_after: "5",
    sku_code_snapshot: "SKU-3", sku_name_snapshot: "Widget", warehouse_code_snapshot: "WH-A",
    bin_code_snapshot: "A-01", lot_number_snapshot: "LOT-4", expiry_date_snapshot: "2026-10-31",
    posted_at: "1700000000000", posted_by: "7", posted_by_label: "Sam",
    source_module: "PURCHASING_RECEIVING", source_document_type: "GOODS_RECEIPT",
    source_document_id: "GR-42", source_line_id: "1", source_event_id: "posted-1",
    reversal_of_movement_id: null, reversed_by_movement_id: null,
    request_hash: "must not leak", ...overrides
  };
}

test("TASK-016 Stock inquiry uses bounded filters, exact search priority and explicit projections", async () => {
  const database = databaseWith(
    [[{ total: "1" }]],
    [[stockRow()]]
  );
  const service = new InventoryInquiryService({ database, time });

  const page = await service.listStocks({
    q: "SKU_3%", warehouseId: 1, status: "AVAILABLE", availability: "IN_STOCK",
    page: 2, pageSize: 20, sortBy: "skuName", descending: true
  });

  assert.deepEqual(page, {
    items: [{
      balanceId: 12,
      warehouse: { warehouseId: 1, code: "WH-A", name: "Main" },
      bin: { binId: 2, code: "A-01", name: "Primary" },
      sku: { skuId: 3, code: "SKU-3", name: "Widget" },
      lot: { lotId: 4, number: "LOT-4", expiryDate: "2026-10-31", manufactureDate: "2026-01-01" },
      stockStatus: "AVAILABLE", isExpired: false, onHand: 10, allocated: 3, bucketFree: 7,
      baseUom: { uomId: 5, uomCode: "EA" }, version: 6
    }],
    total: 1, page: 2, pageSize: 20
  });
  assert.match(database.calls[0].sql, /normalized_barcode/);
  assert.match(database.calls[0].sql, /LIKE \? ESCAPE '!'/);
  assert.match(database.calls[1].sql, /CASE WHEN/);
  assert.match(database.calls[1].sql, /ORDER BY search_rank ASC, s\.sku_name DESC, b\.id DESC/);
  assert.deepEqual(database.calls[1].params.slice(0, 2), ["SKU_3%", "SKU_3%"]);
  assert.equal(database.calls[1].params[2], 1);
  assert.equal(database.calls[1].params.at(-2), 20);
  assert.equal(database.calls[1].params.at(-1), 20);
  assert.equal(Object.hasOwn(page.items[0], "internal_cost"), false);
});

test("TASK-016 Stock inquiry rejects non-allowlisted sorting before querying", async () => {
  const database = databaseWith();
  const service = new InventoryInquiryService({ database, time });
  await assert.rejects(
    service.listStocks({ sortBy: "(SELECT password FROM users)" }),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
  assert.equal(database.calls.length, 0);
});

test("TASK-016 pagination rejects an offset that cannot be represented safely", async () => {
  const database = databaseWith();
  const service = new InventoryInquiryService({ database, time });
  await assert.rejects(
    service.listStocks({ page: Number.MAX_SAFE_INTEGER, pageSize: 100 }),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
  assert.equal(database.calls.length, 0);
});

test("TASK-016 Stock summary keeps ATP and status quantities separate", async () => {
  const database = databaseWith([[
    {
      total_on_hand: "30", available_on_hand: "20", eligible_on_hand: "8",
      reserved_quantity: "12", quarantined_quantity: "6", damaged_quantity: "4"
    }
  ]]);
  const service = new InventoryInquiryService({ database, time });

  const summary = await service.getStockSummary({ skuId: 3, warehouseId: 1, minimumRemainingDays: 7 });
  assert.deepEqual(summary, {
    totalOnHand: 30, availableOnHand: 20, eligibleOnHand: 8, reserved: 12,
    atp: 0, uncoveredReserved: 4, quarantined: 6, damaged: 4, inTransit: 0
  });
  assert.match(database.calls[0].sql, /expiry_date >= \?/);
  assert.deepEqual(database.calls[0].params, ["2026-10-05", 3, 1, 3, 1]);
});

test("TASK-016 Stock detail returns one bucket and recent source-linked movements", async () => {
  const database = databaseWith([[stockRow()]], [[movementRow()]]);
  const service = new InventoryInquiryService({ database, time });
  const detail = await service.getStock(12);

  assert.equal(detail.balanceId, 12);
  assert.deepEqual(detail.allocationSummary, { allocated: 3 });
  assert.equal(detail.recentMovements.length, 1);
  assert.deepEqual(detail.recentMovements[0].source, {
    module: "PURCHASING_RECEIVING", documentType: "GOODS_RECEIPT",
    documentId: "GR-42", lineId: "1", eventId: "posted-1"
  });
  assert.match(database.calls[1].sql, /ORDER BY m\.posted_at DESC, m\.id DESC LIMIT 20/);
});

test("TASK-016 Lot inquiry applies expiry filters and reports current Base UOM totals", async () => {
  const database = databaseWith([[{ total: "1" }]], [[{
    id: "4", sku_id: "3", sku_code: "SKU-3", sku_name: "Widget", lot_number: "LOT-4",
    expiry_date: "2026-09-27", manufacture_date: "2026-01-01", first_receipt_date: "2026-02-01",
    base_uom_id: "5", base_uom_code: "EA", total_on_hand: "10", available_on_hand: "7",
    quarantined_quantity: "2", damaged_quantity: "1"
  }]]);
  const service = new InventoryInquiryService({ database, time });

  const page = await service.listLots({ skuId: 3, warehouseId: 1, expiryState: "EXPIRED" });
  assert.equal(page.items[0].isExpired, true);
  assert.equal(page.items[0].remainingLifeDays, -1);
  assert.deepEqual(page.items[0].baseUom, { uomId: 5, uomCode: "EA" });
  assert.match(database.calls[0].sql, /l\.expiry_date < \?/);
});

test("TASK-016 Movement inquiry keeps fixed history order and source snapshots", async () => {
  const database = databaseWith([[{ total: "1" }]], [[movementRow()]]);
  const service = new InventoryInquiryService({ database, time });

  const page = await service.listMovements({
    postedFrom: 100, postedTo: 200, movementType: "RECEIPT", sourceModule: "PURCHASING_RECEIVING",
    skuId: 3, warehouseId: 1, binId: 2, lotId: 4, actorId: 7
  });
  assert.equal(page.items[0].sku.code, "SKU-3");
  assert.equal(page.items[0].source.documentId, "GR-42");
  assert.match(database.calls[1].sql, /ORDER BY m\.posted_at DESC, m\.id DESC/);
  assert.equal(Object.hasOwn(page.items[0], "request_hash"), false);
});

test("TASK-016 Movement detail returns group legs and both reversal links", async () => {
  const database = databaseWith(
    [[movementRow({ reversal_of_movement_id: "9", reversed_by_movement_id: "25" })]],
    [[movementRow(), movementRow({ id: "22", direction: "OUT" })]]
  );
  const service = new InventoryInquiryService({ database, time });

  const detail = await service.getMovement(21);
  assert.equal(detail.movement.movementId, 21);
  assert.deepEqual(detail.reversal, { reversalOfMovementId: 9, reversedByMovementId: 25 });
  assert.deepEqual(detail.groupLegs.map((leg) => leg.movementId), [21, 22]);
  assert.deepEqual(database.calls[1].params, ["group-1"]);
});

test("TASK-016 exact operation source lookup delegates without enumeration", async () => {
  let received;
  const operationService = {
    async findBySource(executor, input) {
      received = { executor, input };
      return { operationId: 31, resultType: "RECEIPT", resultId: "21", resultSummary: {}, completedAt: 1 };
    }
  };
  const database = databaseWith();
  const service = new InventoryInquiryService({ database, time, operationService });
  const source = { module: "RETURNS", documentType: "CUSTOMER_RETURN", documentId: "R-1", lineId: "", eventId: "posted" };

  const result = await service.findOperationBySource({ source });
  assert.equal(result.operationId, 31);
  assert.equal(received.executor, database);
  assert.deepEqual(received.input, { source });
});
