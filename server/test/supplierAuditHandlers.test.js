import assert from "node:assert/strict";
import test from "node:test";

import { ListSupplierAuditLogsHandler } from "../src/handlers/supplier-audit/auditHandlers.js";

test("Supplier audit query API is read-only, permission protected and schema bounded", () => {
  assert.equal(ListSupplierAuditLogsHandler.api.method, "GET");
  assert.equal(ListSupplierAuditLogsHandler.api.path, "/api/v1/supplier-audit/logs");
  assert.deepEqual(ListSupplierAuditLogsHandler.api.authorizationPolicies[0].options.permissions, ["supplier.view"]);
  assert.equal(ListSupplierAuditLogsHandler.api.requestSchema.query.additionalProperties, false);
  assert.equal(ListSupplierAuditLogsHandler.api.requestSchema.query.properties.pageSize.maximum, 100);
  assert.equal(ListSupplierAuditLogsHandler.api.responseSchema[200].properties.items.items.additionalProperties, false);
});
