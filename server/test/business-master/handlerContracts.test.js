import assert from "node:assert/strict";
import test from "node:test";

import * as currencyHandlers from "../../src/handlers/business-master/currencyHandlers.js";
import * as paymentTermHandlers from "../../src/handlers/business-master/paymentTermHandlers.js";
import { ListBusinessMasterAuditHandler } from "../../src/handlers/business-master/auditHandler.js";

function handlersFrom(module) {
  return Object.values(module).filter((value) => typeof value === "function" && value.api);
}

test("TC-012 admin routes enforce view/mgmt permission boundaries", () => {
  const handlers = [...handlersFrom(currencyHandlers), ...handlersFrom(paymentTermHandlers), ListBusinessMasterAuditHandler];
  assert.equal(handlers.length, 18);
  for (const Handler of handlers) {
    const permission = Handler.api.authorizationPolicies[0].options.permissions[0];
    assert.equal(permission, Handler.api.method === "GET" || Handler.handlerName === "calculatePaymentTerm"
      ? "business_master.view"
      : "business_master.mgmt");
  }
});

test("TC-013 all request object schemas are strict and protected fields have no PATCH path", () => {
  const handlers = [...handlersFrom(currencyHandlers), ...handlersFrom(paymentTermHandlers), ListBusinessMasterAuditHandler];
  for (const Handler of handlers) {
    for (const schema of Object.values(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, `${Handler.handlerName} request schema must be strict`);
    }
  }
  assert.deepEqual(currencyHandlers.UpdateCurrencyHandler.api.requestSchema.body.required, ["name", "version"]);
  assert.deepEqual(Object.keys(currencyHandlers.UpdateCurrencyHandler.api.requestSchema.body.properties).sort(), ["name", "version"]);
  assert.deepEqual(paymentTermHandlers.UpdatePaymentTermHandler.api.requestSchema.body.required, ["name", "description", "version"]);
  assert.deepEqual(Object.keys(paymentTermHandlers.UpdatePaymentTermHandler.api.requestSchema.body.properties).sort(), ["description", "name", "version"]);
  assert.equal(currencyHandlers.PreviewCurrencyImpactHandler.api.responseSchema[200].properties.proposedChange.oneOf.length, 3);
  assert.equal(paymentTermHandlers.CalculatePaymentTermHandler.api.responseSchema[200].properties.term.additionalProperties, false);
  assert.equal(ListBusinessMasterAuditHandler.api.responseSchema[200].properties.items.items.additionalProperties, false);
});

test("TC-015 every non-GET Business Master route enables framework idempotency", () => {
  const handlers = [...handlersFrom(currencyHandlers), ...handlersFrom(paymentTermHandlers)];
  for (const Handler of handlers.filter((candidate) => candidate.api.method !== "GET")) {
    assert.deepEqual(Handler.api.idempotency, { enabled: true }, Handler.handlerName);
  }
});
