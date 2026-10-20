import assert from "node:assert/strict";
import test from "node:test";
import { FULFILLMENT_ERROR_STATUS, fulfillmentError } from "../../src/modules/fulfillment/fulfillmentErrors.js";
import { FULFILLMENT_STATUSES, SHIPMENT_STATUSES, REVERSAL_STATUSES } from "../../src/modules/fulfillment/fulfillmentConstants.js";
import { ERROR_CODE_MESSAGES } from "../../../client/src/framework/http/errorMessages.js";

test("Fulfillment errors expose stable status codes and Traditional Chinese next steps", () => {
  assert.equal(FULFILLMENT_ERROR_STATUS.FULFILLMENT_INPUT_INVALID, 400);
  assert.equal(FULFILLMENT_ERROR_STATUS.FULFILLMENT_PERMISSION_DENIED, 403);
  assert.equal(FULFILLMENT_ERROR_STATUS.SHIPMENT_NOT_FOUND, 404);
  assert.equal(FULFILLMENT_ERROR_STATUS.FULFILLMENT_SOURCE_CONFLICT, 409);
  assert.equal(FULFILLMENT_ERROR_STATUS.EXPORT_RESULT_EXPIRED, 410);
  assert.equal(FULFILLMENT_ERROR_STATUS.FULFILLMENT_DEPENDENCY_UNAVAILABLE, 503);
  for (const [code, status] of Object.entries(FULFILLMENT_ERROR_STATUS)) {
    const error = fulfillmentError(code, { field: "lines[0].baseQuantity" });
    assert.equal(error.statusCode, status);
    assert.equal(error.publicCode, code);
    assert.match(error.publicMessage, /[\u3400-\u9fff]/);
    assert.equal(typeof ERROR_CODE_MESSAGES[code], "string", code);
    assert.deepEqual(error.publicDetails, { field: "lines[0].baseQuantity" });
  }
});

test("Fulfillment public errors reject arbitrary payloads and unsafe detail values", () => {
  for (const details of [{ sql: "SELECT synthetic" }, { field: "/private/synthetic" },
    { currentVersion: -1 }, { statusUrl: "https://synthetic.invalid/secret" }, { correlationId: "private" }]) {
    assert.throws(() => fulfillmentError("VERSION_CONFLICT", details));
  }
  assert.throws(() => fulfillmentError("UNKNOWN"));
  assert.equal(fulfillmentError("VERSION_CONFLICT", { currentVersion: 2 }).publicDetails.currentVersion, 2);
  assert.equal(fulfillmentError("FULFILLMENT_NOT_FOUND").publicDetails, undefined);
});

test("the approved terminal and intermediate state catalogues are immutable", () => {
  assert.deepEqual(FULFILLMENT_STATUSES, ["DRAFT", "PICKING", "PICKED", "SHIPPED", "CANCELLED", "REVERSED"]);
  assert.deepEqual(SHIPMENT_STATUSES, ["DRAFT", "SHIPPING", "SHIPPED", "CANCELLED", "REVERSING", "REVERSED"]);
  assert.deepEqual(REVERSAL_STATUSES, ["REVERSING", "REVERSED", "FAILED"]);
  for (const states of [FULFILLMENT_STATUSES, SHIPMENT_STATUSES, REVERSAL_STATUSES]) assert.equal(Object.isFrozen(states), true);
});

test("global indeterminate transaction messaging also applies safely to non-Fulfillment callers", () => {
  assert.match(ERROR_CODE_MESSAGES.DATABASE_TRANSACTION_INDETERMINATE, /交易/);
  assert.doesNotMatch(ERROR_CODE_MESSAGES.DATABASE_TRANSACTION_INDETERMINATE, /履約|原操作識別碼/);
});
