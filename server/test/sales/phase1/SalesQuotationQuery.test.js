import assert from "node:assert/strict";
import test from "node:test";
import { validateQuotationQuery } from "../../../src/modules/sales/SalesQuotationService.js";
import { quotationListRequest, QUOTATION_LIST_RESPONSE, QUOTATION_READ_RESPONSE } from "../../../src/handlers/sales-quotations/salesQuotationSchemas.js";
import { ListSalesQuotationsHandler } from "../../../src/handlers/sales-quotations/listSalesQuotationsHandler.js";
import { GetSalesQuotationHandler } from "../../../src/handlers/sales-quotations/getSalesQuotationHandler.js";

test("TC-011 Quotation HTTP query coerces only query scalars and retains repeated statuses", () => {
  const req = { auth: { claims: { sub: "1", roles: ["viewer"], permissions: ["sales.view"] } },
    input: { query: { page: "2", pageSize: "10", customerId: "4", descending: "false", status: ["DRAFT", "EXPIRED"] } } };
  const result = quotationListRequest(req);
  assert.deepEqual(result.input, { page: 2, pageSize: 10, customerId: 4, descending: false, status: ["DRAFT", "EXPIRED"] });
  assert.equal(req.input.query.page, "2");
  assert.deepEqual(validateQuotationQuery({ status: "ISSUED" }).status, ["ISSUED"]);
});
test("TC-012 Quotation queries reject unknown fields, SQL sort fragments, unsafe offsets and invalid date ranges", () => {
  for (const input of [{ unexpected: "x" }, { sortBy: "constructor" }, { sortBy: "number DESC;" }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { page: 1.5 }, { customerId: 0 }, { status: [] }, { descending: "false" }, { q: "x".repeat(191) },
    { quotationDateFrom: "2026-02-30" }, { validUntilFrom: "2026-10-10", validUntilTo: "2026-10-01" }])
    assert.throws(() => validateQuotationQuery(input));
  for (const query of [{ pageSize: "101" }, { status: "UNKNOWN" }, { extra: "x" }])
    assert.throws(() => quotationListRequest({ auth: { claims: {} }, input: { query } }), { code: "SALES_INPUT_INVALID" });
});
test("TC-011/018 Read metadata requires view and exposes only bounded named list/detail contracts", () => {
  for (const Handler of [ListSalesQuotationsHandler, GetSalesQuotationHandler]) {
    assert.equal(Handler.api.method, "GET");
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions, ["sales.view"]);
  }
  assert.equal(QUOTATION_LIST_RESPONSE.properties.items.maxItems, 100);
  assert.equal(QUOTATION_LIST_RESPONSE.properties.items.items.additionalProperties, false);
  assert.equal(QUOTATION_READ_RESPONSE.additionalProperties, false);
  assert.ok(QUOTATION_READ_RESPONSE.required.includes("conversion"));
});
