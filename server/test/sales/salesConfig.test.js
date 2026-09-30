import assert from "node:assert/strict";
import test from "node:test";
import defaults from "../../config/sales.js";
import { normalizeSalesConfig } from "../../src/modules/sales/normalizeSalesConfig.js";
import { SALES_ERROR_STATUS, salesError } from "../../src/modules/sales/salesErrors.js";

test("TC-007 Sales deployment config rejects invalid limits and timeout relationships", () => {
  const normalize = (input) => normalizeSalesConfig(input, { requestTimeoutMs: 60000 });
  assert.equal(normalize(defaults).importMaxBytes, 50 * 1024 * 1024);
  for (const changes of [{ importMaxBytes: 0 }, { importMaxBytes: 51 * 1024 * 1024 }, { importMaxRows: NaN },
    { importMaxOrders: 1.5 }, { importWorkerBatchSize: 10001 }, { manualConfirmationWaitMs: 60000 },
    { confirmationLeaseMs: 1000 }, { exportFileRetentionDays: 0 }, { importFileRetentionDays: 89 }, { intakePayloadRetentionDays: 89 }, { exportFileRetentionDays: 6 }, { archiveHourHkt: 24 }, { archiveDayOfMonth: 0 },
    { transactionTimeoutMs: 2147483648 }, { maxDocumentLines: 10 }]) assert.throws(() => normalize({ ...defaults, ...changes }));
  assert.throws(() => normalizeSalesConfig(defaults));
});

test("TC-007 error catalogue exposes stable codes and only safe field metadata", () => {
  assert.equal(SALES_ERROR_STATUS.SALES_PRICE_INVALID, 400);
  assert.equal(SALES_ERROR_STATUS.SALES_QUANTITY_INVALID, 400);
  assert.equal(SALES_ERROR_STATUS.SALES_DEPENDENCY_UNAVAILABLE, 503);
  assert.equal(SALES_ERROR_STATUS.TRANSACTION_OUTCOME_UNKNOWN, 500);
  assert.equal(Object.keys(SALES_ERROR_STATUS).length, 36);
  for (const [code, statusCode] of Object.entries(SALES_ERROR_STATUS)) {
    const error = salesError(code, { field: "lines[0].quantity" });
    assert.equal(error.publicCode, code); assert.equal(error.statusCode, statusCode);
    assert.deepEqual(error.publicDetails, { field: "lines[0].quantity" });
  }
  assert.throws(() => salesError("UNKNOWN"));
  assert.throws(() => salesError("SALES_INPUT_INVALID", { field: "SQL: synthetic" }));
});
