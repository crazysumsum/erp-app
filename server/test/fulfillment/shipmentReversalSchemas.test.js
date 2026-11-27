import assert from "node:assert/strict";
import test from "node:test";
import { RequestValidator } from "../../src/framework/validation/requestValidator.js";
import {
  SHIPMENT_REVERSE_BODY,
  SHIPMENT_REVERSE_PENDING,
  SHIPMENT_REVERSE_RESPONSE
} from "../../src/handlers/shipments/shipmentReversalSchemas.js";

const eventId = "ca0704c7-113b-4bb0-b2c9-873af9bd120f";
const correlationId = "b5e03d47-e9fc-4b17-9d78-d19f06897a6e";
const request = {
  eventId, version: 3, reason: "錯誤確認出貨",
  goodsUnderCompanyControl: true, goodsReturnedToOriginalBins: true
};

function validator(schema, title) {
  const validate = new RequestValidator({ config: { enabled: true, coerceTypes: false } }).compile({ body: schema }, title);
  return body => validate({ body });
}

test("Shipment Reverse command accepts only one whole shipment and both confirmations", () => {
  const validate = validator(SHIPMENT_REVERSE_BODY, "Reverse request");
  assert.doesNotThrow(() => validate(request));
  for (const field of ["lineId", "quantity", "binId", "actorId"]) {
    assert.throws(() => validate({ ...request, [field]: 1 }));
  }
  assert.throws(() => validate({ ...request, goodsUnderCompanyControl: false }));
  assert.throws(() => validate({ ...request, goodsReturnedToOriginalBins: false }));
  assert.throws(() => validate({ ...request, reason: "短" }));
  assert.throws(() => validate({ ...request, version: "3" }));
});

test("Shipment Reverse uses a strict original-event pending response and terminal summary", () => {
  const pending = validator(SHIPMENT_REVERSE_PENDING, "Reverse pending");
  const response = validator(SHIPMENT_REVERSE_RESPONSE, "Reverse completed");
  const original = {
    outcome: "REVERSING", operationId: "1", eventId, correlationId,
    statusUrl: `/api/v1/fulfillment-operations/by-event/${eventId}`, retryAfterSeconds: 2,
    reversal: { id: "2", number: "REV-202611-000002", version: 1 }, shipmentVersion: 4
  };
  const completed = {
    outcome: "REVERSED",
    shipment: { id: "3", number: "SHP-202611-000003", status: "REVERSED", version: 5 }
  };
  assert.doesNotThrow(() => pending(original));
  assert.doesNotThrow(() => response(completed));
  assert.throws(() => pending({ ...original, statusUrl: "/api/v1/shipments/3/reverse" }));
  assert.throws(() => pending({ ...original, owner: "private" }));
  assert.throws(() => response({ ...completed, shipment: { ...completed.shipment, status: "SHIPPED" } }));
  assert.throws(() => response({ ...completed, shipment: { ...completed.shipment, stockCost: "12" } }));
});
