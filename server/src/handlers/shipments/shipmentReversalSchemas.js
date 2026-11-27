const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const id = { type: "string", pattern: "^[1-9][0-9]{0,15}$", maxLength: 16 };
const uuid = { type: "string", format: "uuid" };
const version = { type: "integer", minimum: 1, maximum: 4294967295 };

export const SHIPMENT_REVERSE_BODY = object({
  eventId: uuid,
  version,
  reason: { type: "string", minLength: 5, maxLength: 500 },
  goodsUnderCompanyControl: { const: true },
  goodsReturnedToOriginalBins: { const: true }
});

export const SHIPMENT_REVERSE_RESPONSE = object({
  outcome: { const: "REVERSED" },
  shipment: object({
    id,
    number: { type: "string", pattern: "^SHP-[0-9]{6}-[0-9]{6,13}$", maxLength: 24 },
    status: { const: "REVERSED" },
    version
  })
});

export const SHIPMENT_REVERSE_PENDING = object({
  outcome: { const: "REVERSING" },
  operationId: id,
  eventId: uuid,
  correlationId: uuid,
  statusUrl: { type: "string", pattern: "^/api/v1/fulfillment-operations/by-event/[0-9a-f-]{36}$", maxLength: 76 },
  retryAfterSeconds: { const: 2 },
  reversal: object({ id, number: { type: "string", pattern: "^REV-[0-9]{6}-[0-9]{6,13}$", maxLength: 24 }, version }),
  shipmentVersion: version
});
