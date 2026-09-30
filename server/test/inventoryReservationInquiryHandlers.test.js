import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import {
  GetInventoryReservationHandler,
  ListInventoryReservationsHandler
} from "../src/handlers/inventory/reservationInquiryHandlers.js";

test("TASK-023 Reservation list and detail expose read-only inventory.view contracts", async () => {
  const services = { require(name) {
    if (name === "mysqldatabase") return { query() {} };
    if (name === "time") return { fileDate: () => "2026-09-29" };
    throw new Error(name);
  } };
  for (const [Handler, method, input, expected] of [
    [ListInventoryReservationsHandler, "listReservations", { query: { warehouseId: 2, uncovered: true }, params: {} },
      { warehouseId: 2, uncovered: true }],
    [GetInventoryReservationHandler, "getReservation", { query: {}, params: { id: 7 } }, 7]
  ]) {
    const api = Handler.api;
    assert.equal(api.method, "GET");
    assert.equal(api.idempotency, undefined);
    assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
    new RequestValidator().compile(api.requestSchema, api.path);
    new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
    const handler = new Handler(services);
    let received;
    handler.inventory = { async [method](value) { received = value; return { id: 7 }; } };
    await handler.execute({ input });
    assert.deepEqual(received, expected);
  }
});
