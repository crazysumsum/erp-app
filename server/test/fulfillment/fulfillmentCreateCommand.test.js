import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentCreate } from "../../src/modules/fulfillment/fulfillmentCreateCommand.js";
const body = () => ({ eventId: "14d89307-0222-481c-b9e1-e53140b640ac", salesOrderId: 2, salesOrderVersion: 1, lines: [{ salesOrderLineId: 3, plannedBaseQuantity: "1" }] });
test("Create accepts only explicit positive Base quantities and returns an immutable canonical body", () => {
  const input = body(), output = normalizeFulfillmentCreate(input);
  assert.equal(output.notes, ""); assert.equal(output.lines[0].plannedBaseQuantity, "1");
  assert.ok(Object.isFrozen(output.lines[0])); assert.equal(input.notes, undefined);
  assert.deepEqual(normalizeFulfillmentCreate({ ...body(), lines: [{ salesOrderLineId: 4, plannedBaseQuantity: "9007199254740991" }, ...body().lines] }).lines.map(l => l.salesOrderLineId), [3,4]);
});
test("Create rejects unknown identity/status/snapshot fields, duplicates and unsafe or coercible quantities", () => {
  for (const patch of [{ status: "DRAFT" }, { salesOrderId: "2" }, { salesOrderVersion: 0 }, { eventId: "bad" }, { lines: [] }, { lines: Array(101).fill(body().lines[0]) }, { lines: [...body().lines, ...body().lines] }, { notes: "x".repeat(2001) }]) assert.throws(() => normalizeFulfillmentCreate({ ...body(), ...patch }), { code: "FULFILLMENT_INPUT_INVALID" });
  for (const quantity of [1, "0", "01", "-1", "1.0", "1e2", "9007199254740992"]) assert.throws(() => normalizeFulfillmentCreate({ ...body(), lines: [{ salesOrderLineId: 3, plannedBaseQuantity: quantity }] }), { code: "FULFILLMENT_INPUT_INVALID" });
  assert.throws(() => normalizeFulfillmentCreate({ ...body(), lines: [{ ...body().lines[0], skuId: 5 }] }), { code: "FULFILLMENT_INPUT_INVALID" });
});
