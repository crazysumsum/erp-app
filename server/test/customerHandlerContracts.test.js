import assert from "node:assert/strict";
import test from "node:test";

import * as handlers from "../src/handlers/customers/customerHandlers.js";
import { GetCustomerOperationHandler } from "../src/handlers/customer-operations/getCustomerOperationHandler.js";

test("TC-012 Customer root APIs use strict schemas, route permissions and framework idempotency", () => {
  const values = [...Object.values(handlers), GetCustomerOperationHandler].filter((value) => typeof value === "function" && value.api);
  assert.equal(values.length, 6);
  for (const Handler of values) {
    for (const schema of Object.values(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, Handler.handlerName);
    }
  }
  for (const Handler of values.filter((Handler) => Handler.api.method === "POST")) {
    assert.deepEqual(Handler.api.idempotency, { enabled: true }, Handler.handlerName);
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["customer.view", "customer.mgmt"]);
  }
  assert.equal(handlers.ListCustomersHandler.api.authorizationPolicies[0].options.permissions[0], "customer.view");
  assert.equal(handlers.UpdateCustomerHandler.api.requestSchema.body.properties.customerCode, undefined);
});
