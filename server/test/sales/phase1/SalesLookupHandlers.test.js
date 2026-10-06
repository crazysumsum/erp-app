import assert from "node:assert/strict";
import test from "node:test";
import { validateSalesLookupQuery } from "../../../src/modules/sales/SalesLookupService.js";
import { salesLookupQuery, SALES_LOOKUP_RESPONSE } from "../../../src/handlers/sales/salesSchemas.js";
import { SalesCustomerLookupHandler, SalesSkuLookupHandler, SalesWarehouseLookupHandler, SalesChannelLookupHandler } from "../../../src/handlers/sales-lookups/salesLookupHandlers.js";

test("TC-018 Sales lookup schemas coerce bounded query scalars without mutating the original input", () => {
  const req = { input: { query: { page: "2", pageSize: "10", q: "probe", currencyCode: "HKD" } } };
  assert.deepEqual(salesLookupQuery(req, "skus"), { page: 2, pageSize: 10, q: "probe", currencyCode: "HKD" });
  assert.equal(req.input.query.page, "2");
  for (const query of [{ pageSize: "101" }, { credentials: "x" }, { barcode: "x" }])
    assert.throws(() => salesLookupQuery({ input: { query } }, "customers"), { code: "SALES_INPUT_INVALID" });
});
test("TC-018 Sales lookup domain guards reject unsafe input and cross-purpose fields", () => {
  for (const query of [{ page: 0 }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }, { q: "\n" }, { barcode: "x".repeat(191) },
    { currencyCode: ["HKD"] }, { currencyCode: "hkd" }, { token: "x" }])
    assert.throws(() => validateSalesLookupQuery(query, "skus"), { code: "SALES_INPUT_INVALID" });
});
test("TC-018 Purpose lookup routes require view and their corresponding write permission", () => {
  for (const Handler of [SalesCustomerLookupHandler, SalesSkuLookupHandler, SalesWarehouseLookupHandler])
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["sales.view", "sales.mgmt"]);
  assert.deepEqual(SalesChannelLookupHandler.api.authorizationPolicies[0].options.permissions, ["sales.view", "sales.import"]);
  assert.equal(SALES_LOOKUP_RESPONSE.customers.properties.items.items.additionalProperties, false);
  assert.equal(Object.hasOwn(SALES_LOOKUP_RESPONSE.customers.properties.items.items.properties, "bankAccounts"), false);
  assert.deepEqual(Object.keys(SALES_LOOKUP_RESPONSE.channels.properties.items.items.properties), ["code", "name"]);
});
