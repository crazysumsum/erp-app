import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "csv-parse/sync";

import { DownloadSupplierImportResultHandler } from "../src/handlers/supplier-imports/importResultHandlers.js";
import {
  buildSupplierImportResult, guardSpreadsheetCell, SUPPLIER_IMPORT_RESULT_COLUMNS
} from "../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierImportService } from "../src/modules/supplier/SupplierImportService.js";

/** TASK-046：結果下載嘅 route contract、CSV 內容同公式注入防護。真 SQL 喺整合測試。 */
function services() {
  return { require(name) { return name === "logging" ? { logger: {} } : {}; } };
}

test("the result route is a supplier.mgmt download at /:id/result", () => {
  const { api } = DownloadSupplierImportResultHandler;
  assert.deepEqual([api.method, api.path, api.download.enabled], ["GET", "/api/v1/supplier-imports/:id/result", true]);
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"]);
  assert.equal(api.requestSchema.query.additionalProperties, false);
});

test("the handler serves the service's CSV under the server's file name, uncached", async () => {
  const handler = new DownloadSupplierImportResultHandler(services());
  let received;
  handler.imports = { async resultCsv(input) { received = input; return { fileName: "supplier-import-9-result.csv", content: "﻿a\r\n" }; } };
  const headers = {};
  const file = await handler.execute({ auth: { claims: { sub: "12", roles: ["r"], permissions: ["supplier.mgmt"] } }, input: { params: { id: 9 } } },
    { setHeader: (name, value) => { headers[name] = value; } });
  assert.deepEqual(received, { actorId: 12, claimedRoles: ["r"], claimedPermissions: ["supplier.mgmt"], id: 9 });
  assert.deepEqual([headers["Cache-Control"], headers.Pragma], ["no-store", "no-cache"]);
  const body = file.buffer ?? file.body?.buffer ?? file.file?.buffer;
  assert.equal(body.toString("utf8"), "﻿a\r\n");
  assert.equal(file.fileName ?? file.file?.fileName ?? file.body?.fileName, "supplier-import-9-result.csv");
});

test("a cell that a spreadsheet would run as a formula is turned into text", () => {
  for (const risky of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "\nx"]) assert.equal(guardSpreadsheetCell(risky), `'${risky}`, JSON.stringify(risky));
  for (const safe of ["SUP-1", "a=b", "", "1", "供應商"]) assert.equal(guardSpreadsheetCell(safe), safe);
  assert.equal(guardSpreadsheetCell(null), "");
  assert.equal(guardSpreadsheetCell(5), "5");
});

test("the result CSV has a BOM, one header and one record per row, joins issues and guards every cell", () => {
  const csv = buildSupplierImportResult([
    { rowNumber: 1, operation: "create", status: "applied", supplierCode: "S-1", appliedSupplierId: 41, errors: [], warnings: [{ code: "W1" }] },
    { rowNumber: 2, operation: "update", status: "failed", supplierCode: "=HYPERLINK(\"x\")", appliedSupplierId: null,
      errors: [{ code: "E1", message: "第一\n第二" }, { code: "E2", message: "-2" }], warnings: [] }
  ]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.endsWith("\r\n"));
  const records = parse(csv, { bom: true });
  assert.deepEqual(records, [
    [...SUPPLIER_IMPORT_RESULT_COLUMNS],
    ["1", "create", "applied", "S-1", "41", "", "", "W1"],
    ["2", "update", "failed", "'=HYPERLINK(\"x\")", "", "E1 | E2", "第一\n第二 | -2", ""]
  ]);
  assert.ok(!csv.split("\r\n").some((line) => line.startsWith("第二")), "a newline inside a cell never splits the record");
});

test("resultCsv refuses a malformed ID before touching the database", async () => {
  const database = { query() { throw new Error("must not be reached"); } };
  const importer = new SupplierImportService({ database, time: { nowMs: () => 1 }, authorize: () => { throw new Error("must not be reached"); } });
  await assert.rejects(() => importer.resultCsv({ actorId: 1, claimedRoles: [], claimedPermissions: [], id: 0 }), TypeError);
});
