import assert from "node:assert/strict";
import test from "node:test";

import {
  movementProjection,
  stockBucketProjection,
  stockSummaryProjection
} from "../src/modules/inventory/inventoryProjections.js";

test("Stock bucket projection keeps each quantity meaning explicit", () => {
  assert.deepEqual(stockBucketProjection({
    id: "12",
    warehouse_id: "1",
    bin_id: "2",
    sku_id: "3",
    lot_id: "4",
    stock_status: "AVAILABLE",
    is_expired: "0",
    on_hand_quantity: "10",
    allocated_quantity: "3",
    base_uom_id: "5",
    base_uom_code: "EA",
    version: "6",
    internal_cost: "99.00"
  }), {
    balanceId: 12,
    warehouseId: 1,
    binId: 2,
    skuId: 3,
    lotId: 4,
    stockStatus: "AVAILABLE",
    isExpired: false,
    onHand: 10,
    allocated: 3,
    bucketFree: 7,
    baseUom: { uomId: 5, uomCode: "EA" },
    version: 6
  });
});

test("Stock bucket projection fails closed on impossible quantity state", () => {
  assert.throws(() => stockBucketProjection({
    id: 1,
    warehouse_id: 1,
    bin_id: 1,
    sku_id: 1,
    lot_id: null,
    stock_status: "AVAILABLE",
    is_expired: 0,
    on_hand_quantity: 2,
    allocated_quantity: 3,
    base_uom_id: 1,
    base_uom_code: "EA",
    version: 1
  }), /allocated quantity exceeds on hand/);
});

test("Stock summary projection separates on-hand, reserved, ATP, status and transit quantities", () => {
  const projection = stockSummaryProjection({
    total_on_hand: "30",
    available_on_hand: "20",
    eligible_on_hand: "18",
    reserved_quantity: "7",
    atp: "11",
    uncovered_reserved: "0",
    quarantined_quantity: "6",
    damaged_quantity: "4",
    in_transit_quantity: "3",
    raw_row: "must not leak"
  });

  assert.deepEqual(projection, {
    totalOnHand: 30,
    availableOnHand: 20,
    eligibleOnHand: 18,
    reserved: 7,
    atp: 11,
    uncoveredReserved: 0,
    quarantined: 6,
    damaged: 4,
    inTransit: 3
  });
});

test("Stock summary projection fails closed when a required quantity alias is missing", () => {
  assert.throws(() => stockSummaryProjection({
    total_on_hand: 1,
    available_on_hand: 1,
    eligible_on_hand: 1,
    reserved_quantity: 0,
    atp: 1,
    uncovered_reserved: 0,
    quarantined_quantity: 0,
    damaged_quantity: 0
  }), /non-negative safe integer/);
});

test("Movement projection uses immutable snapshots instead of current master values", () => {
  const projection = movementProjection({
    id: "21",
    movement_group_id: "group-1",
    movement_type: "RECEIPT",
    location_kind: "BIN",
    warehouse_id: "1",
    bin_id: "2",
    sku_id: "3",
    lot_id: "4",
    stock_status: "AVAILABLE",
    direction: "IN",
    quantity: "8",
    balance_before: "2",
    balance_after: "10",
    balance_version_after: "5",
    sku_code_snapshot: "OLD-SKU",
    sku_name_snapshot: "Old name",
    warehouse_code_snapshot: "OLD-WH",
    bin_code_snapshot: "OLD-BIN",
    lot_number_snapshot: "OLD-LOT",
    expiry_date_snapshot: "2027-09-01",
    posted_at: "1700000000000",
    posted_by: "7",
    posted_by_label: "Sam",
    current_sku_code: "NEW-SKU",
    authentication_token: "must not leak"
  });

  assert.equal(projection.sku.code, "OLD-SKU");
  assert.equal(projection.warehouse.code, "OLD-WH");
  assert.equal(projection.bin.code, "OLD-BIN");
  assert.equal(projection.lot.number, "OLD-LOT");
  assert.equal(projection.quantity, 8);
  assert.equal(Object.hasOwn(projection, "authentication_token"), false);
  assert.equal(Object.hasOwn(projection, "current_sku_code"), false);
});
