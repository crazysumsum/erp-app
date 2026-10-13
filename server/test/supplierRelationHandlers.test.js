import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateSupplierSkuRelationHandler, ListSupplierSkuRelationsHandler, UpdateSupplierSkuRelationHandler
} from "../src/handlers/suppliers/supplierSkuRelationHandlers.js";

const permissions = (Handler) => Handler.api.authorizationPolicies.flatMap((policy) => policy.options.permissions);

test("TASK-038: the SKU relation routes and their permissions follow design §6.8", () => {
  assert.deepEqual([ListSupplierSkuRelationsHandler, CreateSupplierSkuRelationHandler, UpdateSupplierSkuRelationHandler]
    .map((Handler) => [Handler.api.method, Handler.api.path, permissions(Handler)]), [
    ["GET", "/api/v1/suppliers/:id/sku-relations", ["supplier.view"]],
    ["POST", "/api/v1/suppliers/:id/sku-relations/create", ["supplier.mgmt"]],
    ["POST", "/api/v1/suppliers/:id/sku-relations/:relationId/update", ["supplier.mgmt"]]
  ]);
});

test("TASK-038 (SKU-007, FR-SKU-006): no request or response carries a price, and unknown fields are refused", () => {
  for (const Handler of [CreateSupplierSkuRelationHandler, UpdateSupplierSkuRelationHandler]) {
    const body = Handler.api.requestSchema.body;
    assert.equal(body.additionalProperties, false, Handler.handlerName);
    assert.ok(!Object.keys(body.properties).some((name) => /price|cost|amount|quote|contract/iu.test(name)), Handler.handlerName);
    const response = Object.values(Handler.api.responseSchema)[0];
    assert.equal(response.additionalProperties, false);
    assert.ok(!Object.keys(response.properties).some((name) => /price|cost|amount|quote|contract/iu.test(name)));
  }
  assert.deepEqual(CreateSupplierSkuRelationHandler.api.requestSchema.body.properties.minimumOrderQty.minimum, 1);
  assert.deepEqual(UpdateSupplierSkuRelationHandler.api.requestSchema.body.properties.standardLeadTimeDays.maximum, 3650);
});
