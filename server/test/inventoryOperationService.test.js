import assert from "node:assert/strict";
import test from "node:test";

import {
  InventoryOperationService,
  inventoryOperationHash
} from "../src/modules/inventory/InventoryOperationService.js";

const SOURCE = Object.freeze({
  module: "RECEIVING",
  documentType: "PURCHASE_RECEIPT",
  documentId: "receipt-42",
  eventId: "posted-1"
});

function input(overrides = {}) {
  return {
    commandType: "RECEIPT_POST",
    source: SOURCE,
    payload: { quantity: 3, skuId: 12 },
    actorUserId: 7,
    actorLabel: "sam",
    requestId: "request-1",
    correlationId: "correlation-1",
    createdAt: 1_700_000_000_000,
    ...overrides
  };
}

test("InventoryOperationService claims the source tuple atomically", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ insertId: 91 }];
    }
  };

  const result = await new InventoryOperationService().claim(connection, input());

  assert.deepEqual(result, { operationId: 91, replay: null });
  assert.match(calls[0].sql, /INSERT INTO inventory_operation_requests/);
  assert.deepEqual(calls[0].params.slice(0, 7), [
    "RECEIPT_POST",
    "RECEIVING",
    "PURCHASE_RECEIPT",
    "receipt-42",
    "",
    "posted-1",
    inventoryOperationHash({ commandType: "RECEIPT_POST", payload: { quantity: 3, skuId: 12 } })
  ]);
});

test("InventoryOperationService replays only a completed matching source claim", async () => {
  const matchingHash = inventoryOperationHash({
    commandType: "RECEIPT_POST",
    payload: { quantity: 3, skuId: 12 }
  });
  const connection = {
    async execute() {
      const error = new Error("duplicate");
      error.code = "ER_DUP_ENTRY";
      throw error;
    },
    async query(sql, params) {
      assert.match(String(sql), /FOR UPDATE/);
      assert.deepEqual(params, ["RECEIVING", "PURCHASE_RECEIPT", "receipt-42", "", "posted-1"]);
      return [[{
        id: 91,
        command_type: "RECEIPT_POST",
        request_hash: matchingHash,
        result_type: "MOVEMENT_GROUP",
        result_id: "44",
        result_summary: { status: "POSTED", version: 1 },
        completed_at: 1_700_000_000_010
      }]];
    }
  };

  const result = await new InventoryOperationService().claim(connection, input());

  assert.deepEqual(result, {
    operationId: 91,
    replay: {
      resultType: "MOVEMENT_GROUP",
      resultId: "44",
      resultSummary: { status: "POSTED", version: 1 },
      completedAt: 1_700_000_000_010
    }
  });
});

test("InventoryOperationService distinguishes source conflict from an in-flight duplicate", async () => {
  const service = new InventoryOperationService();
  let row = {
    id: 91,
    request_hash: inventoryOperationHash({ commandType: "RECEIPT_POST", payload: { quantity: 4 } }),
    completed_at: 1_700_000_000_010
  };
  const connection = {
    async execute() {
      const cause = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      throw Object.assign(new Error("wrapped"), { cause });
    },
    async query() { return [[row]]; }
  };

  await assert.rejects(
    () => service.claim(connection, input()),
    (error) => error.code === "INVENTORY_SOURCE_CONFLICT"
  );

  row = {
    id: 91,
    request_hash: inventoryOperationHash({
      commandType: "RECEIPT_POST",
      payload: { quantity: 3, skuId: 12 }
    }),
    completed_at: null
  };
  await assert.rejects(
    () => service.claim(connection, input()),
    (error) => error.code === "CONCURRENT_OPERATION"
  );
});

test("InventoryOperationService completes and finds a safe result by exact source", async () => {
  const calls = [];
  const connection = {
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [{ affectedRows: 1 }];
    },
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{
        id: 91,
        result_type: "MOVEMENT_GROUP",
        result_id: "44",
        result_summary: JSON.stringify({ status: "POSTED", version: 1 }),
        completed_at: 1_700_000_000_010
      }]];
    }
  };
  const service = new InventoryOperationService();

  await service.complete(connection, {
    operationId: 91,
    resultType: "MOVEMENT_GROUP",
    resultId: "44",
    resultSummary: { status: "POSTED", version: 1 },
    completedAt: 1_700_000_000_010
  });
  const found = await service.findBySource(connection, { source: SOURCE });

  assert.equal(calls[0].params[2], JSON.stringify({ status: "POSTED", version: 1 }));
  assert.doesNotMatch(calls[1].sql, /FOR UPDATE/);
  assert.deepEqual(found, {
    operationId: 91,
    resultType: "MOVEMENT_GROUP",
    resultId: "44",
    resultSummary: { status: "POSTED", version: 1 },
    completedAt: 1_700_000_000_010
  });
});

test("InventoryOperationService refuses secrets in durable result summaries", async () => {
  const connection = { async execute() { return [{ affectedRows: 1 }]; } };

  await assert.rejects(
    () => new InventoryOperationService().complete(connection, {
      operationId: 91,
      resultType: "MOVEMENT_GROUP",
      resultId: "44",
      resultSummary: { status: "POSTED", password: "not-allowed" },
      completedAt: 1
    }),
    /Unsupported Inventory result summary field password/
  );
});

test("InventoryOperationService accepts the scalar Receipt replay projection", async () => {
  let summary;
  const connection = {
    async execute(_sql, params) {
      summary = JSON.parse(params[2]);
      return [{ affectedRows: 1 }];
    }
  };

  await new InventoryOperationService().complete(connection, {
    operationId: 91,
    resultType: "MOVEMENT_GROUP",
    resultId: "11111111-1111-4111-8111-111111111111",
    resultSummary: {
      status: "POSTED", operationId: 91, movementGroupId: "11111111-1111-4111-8111-111111111111",
      movementId: 701, balanceId: 501, balanceVersion: 4, onHandQuantity: 29,
      allocatedQuantity: 0, skuId: 12, skuCode: "SKU-12", skuName: "Widget",
      warehouseId: 2, warehouseCode: "WH-1", binId: 35, binCode: "A-01", lotId: null,
      lotNumber: null, expiryDate: null, stockStatus: "AVAILABLE", inputQuantity: 2,
      inputUomId: 8, inputUomCode: "CASE", baseQuantity: 24, baseUomId: 5,
      baseUomCode: "EA", postedAt: 1_700_000_000_000
    },
    completedAt: 1_700_000_000_000
  });

  assert.equal(summary.movementId, 701);
  assert.equal(summary.skuName, "Widget");
});

test("InventoryOperationService refuses a second completion and hides incomplete lookup rows", async () => {
  const service = new InventoryOperationService();
  const connection = {
    async execute() { return [{ affectedRows: 0 }]; },
    async query() { return [[{ id: 91, completed_at: null }]]; }
  };

  await assert.rejects(
    () => service.complete(connection, {
      operationId: 91,
      resultType: "MOVEMENT_GROUP",
      resultId: "44",
      completedAt: 1
    }),
    (error) => error.code === "CONCURRENT_OPERATION"
  );
  assert.equal(await service.findBySource(connection, { source: SOURCE }), null);
});

test("Sales batch member staging is immutable and reads current bounded pages with explicit NULL completion", async () => {
  const calls = [];
  const connection = { async execute(sql, params) { calls.push({ sql, params }); return [{ affectedRows: 1 }]; },
    async query(sql, params) { calls.push({ sql, params }); return [[{ id: 9, command_type: "SALES_LINE_RELEASE", source_line_id: "reservation:1",
      request_hash: "h", result_summary: { rootOperationId: 8, sourceLineId: 1, releaseQuantity: 2 }, completed_at: null }]]; } };
  const s = new InventoryOperationService();
  await s.stageSalesBatchMember(connection, { operationId: 9, resultSummary: { rootOperationId: 8, sourceLineId: 1, releaseQuantity: 2 } });
  assert.match(calls[0].sql, /command_type = 'SALES_LINE_RELEASE'.*completed_at IS NULL AND result_summary IS NULL/u);
  const page = await s.listSalesBatchMembers(connection, { source: { module: "SALES", documentType: "SALES_ORDER", documentId: "42", eventId: "release" }, afterId: 8 });
  assert.equal(page[0].completedAt, null);
  assert.match(calls[1].sql, /ORDER BY id LIMIT 100 FOR SHARE/u);
  assert.deepEqual(calls[1].params, ["SALES", "SALES_ORDER", "42", "release", 8]);
  await assert.rejects(() => s.listSalesBatchMembers(connection, { source: SOURCE }), TypeError);
  await assert.rejects(() => s.listSalesBatchMembers(connection, { source: { module: "SALES", documentType: "SALES_ORDER", documentId: "42", eventId: "release" }, afterId: -1 }), TypeError);
  await assert.rejects(() => s.stageSalesBatchMember({ async execute() { return [{ affectedRows: 0 }]; } }, { operationId: 9, resultSummary: {} }), { code: "CONCURRENT_OPERATION" });
});
