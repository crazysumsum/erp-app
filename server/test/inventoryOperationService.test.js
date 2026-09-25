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
