import assert from "node:assert/strict";
import test from "node:test";

import { ExportSuppliersHandler, SUPPLIER_EXPORT_BODY_SCHEMA } from "../src/handlers/supplier-exports/supplierExportHandler.js";
import { SUPPLIER_LIST_QUERY_SCHEMA } from "../src/handlers/suppliers/supplierSchemas.js";

/** TASK-047：匯出 route contract（HD-067 1A）。真 HTTP 喺整合測試。 */
function services() {
  return { require(name) { return name === "logging" ? { logger: {} } : {}; } };
}

test("the export route is a password-confirmed supplier.mgmt POST download", () => {
  const { api } = ExportSuppliersHandler;
  assert.deepEqual([api.method, api.path, api.authType, api.download.enabled], ["POST", "/api/v1/supplier-exports", "jwt-password", true]);
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
  assert.equal(api.idempotency, undefined, "an export changes nothing, so no Idempotency-Key");
});

test("the body takes the password and the list's filters, without paging", () => {
  assert.deepEqual(SUPPLIER_EXPORT_BODY_SCHEMA.required, ["password"]);
  const filters = SUPPLIER_EXPORT_BODY_SCHEMA.properties.filters;
  assert.equal(filters.additionalProperties, false);
  const listNames = Object.keys(SUPPLIER_LIST_QUERY_SCHEMA.properties).filter((name) => !["page", "pageSize"].includes(name));
  assert.deepEqual(Object.keys(filters.properties), listNames);
});

test("the handler passes the actor and filters through and serves the CSV uncached", async () => {
  const handler = new ExportSuppliersHandler(services());
  let received;
  handler.exports = { async exportCsv(input) { received = input; return { fileName: "suppliers-x.csv", content: "﻿a\r\n" }; } };
  const headers = {};
  const file = await handler.execute({
    auth: { claims: { sub: "12", roles: ["r"], permissions: ["supplier.mgmt"] } }, input: { body: { filters: { q: "x" } } },
    requestId: "req-9", ip: "10.0.0.1"
  }, { setHeader: (name, value) => { headers[name] = value; } });
  assert.deepEqual(received, {
    actorId: 12, claimedRoles: ["r"], claimedPermissions: ["supplier.mgmt"], filters: { q: "x" }, requestId: "req-9", ip: "10.0.0.1"
  });
  assert.deepEqual([headers["Cache-Control"], headers.Pragma], [undefined, "no-cache"]);
  const body = file.buffer ?? file.body?.buffer ?? file.file?.buffer;
  assert.equal(body.toString("utf8"), "﻿a\r\n");
  assert.equal(file.fileName ?? file.file?.fileName ?? file.body?.fileName, "suppliers-x.csv");
});
