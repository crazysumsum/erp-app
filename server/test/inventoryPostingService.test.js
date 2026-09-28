import assert from "node:assert/strict";
import test from "node:test";

import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";
import { createFakeInventoryDatabase, INVENTORY_FAILURE_POINTS } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const NOW = Date.parse("2026-09-28T04:00:00.000Z");

function command(payload = {}, overrides = {}) {
  return inventoryCommandFixture({
    actor: {
      claimedPermissions: ["inventory.operation", ...(overrides.overridePermission ? ["receiving.expiry.override"] : [])]
    },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    correlationId: "request-1",
    payload: {
      skuId: 12,
      quantity: 2,
      uomId: 8,
      warehouseId: 2,
      binId: 35,
      stockStatus: "AVAILABLE",
      ...payload
    },
    source: overrides.source
  });
}

function setup({ failAt = null, profile = {}, uom = {}, initialState = {} } = {}) {
  const state = {
    warehouse: { id: 2, warehouse_code: "WH-1", status: "ACTIVE" },
    bin: { id: 35, warehouse_id: 2, bin_code: "A-01", status: "ACTIVE" },
    binLocks: [],
    balance: {
      id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
      stock_status: "AVAILABLE", on_hand_quantity: 5, allocated_quantity: 0, version: 3
    },
    lots: [], movements: [], audits: [], completed: null,
    ...structuredClone(initialState)
  };
  const database = createFakeInventoryDatabase({
    initialState: state,
    failAt,
    async query({ sql, params, state: draft }) {
      if (sql.includes("FROM inventory_lots")) {
        const row = draft.lots.find((lot) => lot.sku_id === params[0] && lot.normalized_lot_number === params[1]);
        return [[row].filter(Boolean)];
      }
      return [[]];
    },
    async execute({ sql, params, state: draft }) {
      assert.equal((sql.match(/\?/gu) ?? []).length, params.length, sql);
      if (sql.includes("INSERT INTO inventory_lots")) {
        let lot = draft.lots.find((value) => value.sku_id === params[0] && value.normalized_lot_number === params[2]);
        if (!lot) {
          lot = {
            id: 601, sku_id: params[0], lot_number: params[1], normalized_lot_number: params[2],
            expiry_date: params[3], manufacture_date: params[4], first_receipt_date: params[5]
          };
          draft.lots.push(lot);
        }
        return [{ insertId: lot.id, affectedRows: 1 }];
      }
      if (sql.includes("UPDATE inventory_stock_balances")) {
        draft.balance.on_hand_quantity += params[0];
        draft.balance.version += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        draft.movements.push({ id: 701, params });
        return [{ insertId: 701, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  });
  const itemProfile = {
    skuId: 12, skuCode: "SKU-12", skuName: "Widget", skuStatus: "active", itemStatus: "active",
    inventoryTracked: true, trackingPolicy: "none", shelfLifeDays: null,
    minimumReceiptLifeDays: 0, minimumSaleLifeDays: 0,
    baseUom: { uomId: 5, uomCode: "EA" }, usable: true, reasons: [],
    ...profile
  };
  const itemLookup = {
    async getInventoryProfileInTransaction() { return structuredClone(itemProfile); },
    async resolveUomInTransaction() {
      return { skuId: 12, uomId: 8, uomCode: "CASE", toBaseFactor: 12, isBase: false, ...uom };
    }
  };
  const operations = {
    async claim(transaction, input) {
      if (transaction.state.completed && transaction.state.operation?.source.eventId === input.source.eventId) {
        if (JSON.stringify(transaction.state.operation.payload) !== JSON.stringify(input.payload)) {
          throw Object.assign(new Error("source conflict"), { code: "INVENTORY_SOURCE_CONFLICT" });
        }
        return { operationId: 91, replay: { resultSummary: transaction.state.completed } };
      }
      transaction.state.operation = input;
      transaction.state.completed = null;
      return { operationId: 91, replay: null };
    },
    async complete(transaction, input) { transaction.state.completed = input.resultSummary; }
  };
  const locks = {
    async lockForCommand(transaction) {
      return {
        warehouses: [transaction.state.warehouse].filter(Boolean),
        stockControls: [{ id: 401, warehouse_id: 2, sku_id: 12 }],
        bins: [transaction.state.bin].filter(Boolean),
        binLocks: transaction.state.binLocks,
        lots: transaction.state.lots
      };
    },
    async lockBalancesAfterLot(transaction, input) {
      transaction.state.balance.lot_id = input.balances[0].lotId;
      return [transaction.state.balance];
    }
  };
  const audit = {
    async recordSucceeded(transaction, input) { transaction.state.audits.push(input); }
  };
  const service = new InventoryPostingService({
    database,
    time: { nowMs: () => NOW, fileDate: () => "2026-09-28" },
    itemLookup,
    operations,
    locks,
    audit,
    authorize: async (_transaction, input) => ({
      id: input.actorId,
      username: "sam",
      permissions: [...input.claimedPermissions]
    }),
    createMovementGroupId: () => "11111111-1111-4111-8111-111111111111"
  });
  return { service, database };
}

test("TASK-014 Receipt converts Pack UOM and atomically updates Balance, Movement, Audit and operation", async () => {
  const { service, database } = setup();

  const result = await service.postReceipt(command());

  assert.deepEqual(result.inputUom, { id: 8, code: "CASE" });
  assert.deepEqual(result.baseUom, { id: 5, code: "EA" });
  assert.equal(result.inputQuantity, 2);
  assert.equal(result.baseQuantity, 24);
  assert.deepEqual(result.balance, { id: 501, onHandQuantity: 29, allocatedQuantity: 0, version: 4 });
  assert.equal(database.state.movements.length, 1);
  assert.equal(database.state.audits.length, 1);
  assert.equal(database.state.completed.movementId, 701);
});

test("TASK-014 completed source replays without another quantity effect", async () => {
  const { service, database } = setup();
  const first = await service.postReceipt(command());
  const replay = await service.postReceipt(command());

  assert.deepEqual(replay, first);
  assert.equal(database.state.balance.on_hand_quantity, 29);
  assert.equal(database.state.movements.length, 1);
  assert.equal(database.state.audits.length, 1);
});

test("TASK-014 same source with different receipt content conflicts", async () => {
  const { service, database } = setup();
  await service.postReceipt(command());

  await assert.rejects(
    () => service.postReceipt(command({ quantity: 3 })),
    (error) => error.code === "INVENTORY_SOURCE_CONFLICT"
  );
  assert.equal(database.state.balance.on_hand_quantity, 29);
  assert.equal(database.state.movements.length, 1);
});

test("TASK-014 posts each allowlisted manual stock status", async () => {
  for (const stockStatus of ["AVAILABLE", "QUARANTINED", "DAMAGED"]) {
    const { service } = setup({ initialState: { balance: {
      id: 501, warehouse_id: 2, bin_id: 35, sku_id: 12, lot_id: null,
      stock_status: stockStatus, on_hand_quantity: 0, allocated_quantity: 0, version: 1
    } } });
    const result = await service.postReceipt(command({ stockStatus }));
    assert.equal(result.stockStatus, stockStatus);
  }
});

test("TASK-014 injected failures leave no partial current state, Movement, Audit or operation", async () => {
  for (const failAt of INVENTORY_FAILURE_POINTS) {
    const { service, database } = setup({ failAt });
    await assert.rejects(() => service.postReceipt(command()), { faultPoint: failAt });
    assert.equal(database.state.balance.on_hand_quantity, 5, failAt);
    assert.equal(database.state.movements.length, 0, failAt);
    assert.equal(database.state.audits.length, 0, failAt);
    assert.equal(database.state.completed, null, failAt);
  }
});

test("TASK-014 fails closed for unusable, untracked and serial SKUs and inactive locations", async () => {
  for (const [options, code] of [
    [{ profile: { usable: false, reasons: ["NOT_ACTIVE"] } }, "INVENTORY_INPUT_INVALID"],
    [{ profile: { inventoryTracked: false } }, "SKU_NOT_INVENTORY_TRACKED"],
    [{ profile: { trackingPolicy: "serial" } }, "SERIAL_TRACKING_UNSUPPORTED"],
    [{ initialState: { warehouse: { id: 2, warehouse_code: "WH-1", status: "INACTIVE" } } }, "WAREHOUSE_INVALID"],
    [{ initialState: { bin: { id: 35, warehouse_id: 2, bin_code: "A-01", status: "INACTIVE" } } }, "BIN_INVALID"]
  ]) {
    const { service, database } = setup(options);
    await assert.rejects(() => service.postReceipt(command()), (error) => error.code === code);
    assert.equal(database.state.movements.length, 0);
  }
});

test("TASK-014 records exact minimum-life override evidence and rejects conflicting Lot data", async () => {
  const { service, database } = setup({
    profile: { trackingPolicy: "batch_expiry", minimumReceiptLifeDays: 60 }
  });
  const payload = {
    lotNumber: "LOT-A", expiryDate: "2026-11-12", manufactureDate: "2026-09-01",
    minimumLifeOverride: {
      permission: "receiving.expiry.override",
      reason: "Approved short-dated receipt",
      minimumLifeDaysApplied: 60,
      actualRemainingLifeDays: 45,
      actorId: 7,
      receiptId: "receipt-42",
      requestId: "request-1"
    }
  };

  const { minimumLifeOverride: _override, ...withoutOverride } = payload;
  await assert.rejects(
    () => service.postReceipt(command(withoutOverride)),
    (error) => error.code === "LOT_MINIMUM_LIFE_FAILED"
  );
  const result = await service.postReceipt(command(payload, { overridePermission: true }));
  assert.equal(result.lotId, 601);
  assert.equal(database.state.audits[0].afterSummary.minimumLifeDaysApplied, 60);
  assert.equal(database.state.audits[0].afterSummary.actualRemainingLifeDays, 45);

  await assert.rejects(
    () => service.postReceipt(command(
      {
        ...payload,
        expiryDate: "2026-11-13",
        minimumLifeOverride: { ...payload.minimumLifeOverride, actualRemainingLifeDays: 46 }
      },
      { overridePermission: true, source: { eventId: "posted-2" } }
    )),
    (error) => error.code === "LOT_DATA_CONFLICT"
  );
});

test("TASK-014 never overrides expired Lots and rejects mismatched override evidence", async () => {
  const options = { profile: { trackingPolicy: "batch_expiry", minimumReceiptLifeDays: 60 } };
  const expired = setup(options).service;
  await assert.rejects(
    () => expired.postReceipt(command({ lotNumber: "LOT-X", expiryDate: "2026-09-27" })),
    (error) => error.code === "LOT_EXPIRED"
  );

  const invalid = setup(options).service;
  await assert.rejects(
    () => invalid.postReceipt(command({
      lotNumber: "LOT-X",
      expiryDate: "2026-11-12",
      minimumLifeOverride: {
        permission: "receiving.expiry.override",
        reason: "Approved short-dated receipt",
        minimumLifeDaysApplied: 60,
        actualRemainingLifeDays: 44,
        actorId: 7,
        receiptId: "receipt-42",
        requestId: "request-1"
      }
    }, { overridePermission: true })),
    (error) => error.code === "INVENTORY_INPUT_INVALID"
  );
});
