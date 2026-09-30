import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "csv-parse/sync";

import supplierConfig from "../config/supplier.js";
import {
  DownloadSupplierImportTemplateHandler, UploadSupplierImportHandler
} from "../src/handlers/supplier-imports/importTemplateUploadHandlers.js";
import { SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";

/** TASK-043：template 同 upload 兩條 route 嘅 contract 同 handler 行為（service 用替身）。 */
function services({ preparedRoot = "/srv/imports/real" } = {}) {
  return {
    config: { supplier: { import: { maxFileBytes: 1024 } } },
    get(name) {
      return name === "job.supplierImportWorker" ? { preparedRoot } : undefined;
    },
    require(name) {
      if (name === "logging") return { logger: {} };
      return {};
    }
  };
}

function request(buffer) {
  return {
    files: buffer ? [{ buffer }] : [],
    input: { body: { mode: "upsert" } },
    auth: { claims: { sub: "12", roles: ["buyer"], permissions: ["supplier.mgmt"] } },
    requestId: "req-1",
    ip: "10.0.0.1"
  };
}

test("both routes need supplier.mgmt; upload is idempotent, memory-only, CSV-only and bounded by the configured size", () => {
  for (const handler of [DownloadSupplierImportTemplateHandler, UploadSupplierImportHandler]) {
    assert.deepEqual(handler.api.authorizationPolicies[0].options.permissions, ["supplier.mgmt"], handler.handlerName);
  }
  const { api } = UploadSupplierImportHandler;
  assert.deepEqual([api.method, api.path], ["POST", "/api/v1/supplier-imports/upload"]);
  assert.equal(api.idempotency.enabled, true);
  assert.equal(api.upload.memoryOnly, true, "the upload never lands in the framework's temp directory");
  assert.equal(api.upload.maxFiles, 1);
  assert.deepEqual(api.upload.allowedMimeTypes, ["text/csv"]);
  assert.equal(api.upload.maxFileSizeBytes, supplierConfig.import.maxFileBytes);
  assert.deepEqual(api.requestSchema.body.properties.mode.enum, ["create_only", "upsert"]);
  const job = api.responseSchema[201];
  assert.equal(job.additionalProperties, false);
  for (const hidden of ["sourceStoredName", "sourceSha256", "path", "leaseOwner"]) {
    assert.equal(Object.hasOwn(job.properties, hidden), false, `${hidden} is not part of the response`);
  }
});

test("the template download is the v1 CSV with its version header", async () => {
  const headers = {};
  const handler = new DownloadSupplierImportTemplateHandler(services());
  const file = await handler.execute({}, { setHeader: (name, value) => { headers[name] = value; } });
  assert.equal(headers["X-Supplier-Import-Template-Version"], "v1");
  const body = file.buffer ?? file.body?.buffer ?? file.file?.buffer;
  assert.deepEqual(parse(body.toString("utf8"), { bom: true })[0], SUPPLIER_IMPORT_COLUMN_NAMES);
});

test("upload hands the prepared real root and the actor to the service, then wipes the buffer", async () => {
  const handler = new UploadSupplierImportHandler(services());
  let received;
  handler.imports = { async createFromUpload(input) { received = { ...input, content: Buffer.from(input.content) }; return { id: 5 }; } };
  const buffer = Buffer.from("supplierCode\r\nSUP-1\r\n");
  const response = await handler.execute(request(buffer));
  assert.equal(response.statusCode ?? response.status, 201);
  assert.equal(received.root, "/srv/imports/real");
  assert.deepEqual([received.actorId, received.mode, received.maxFileBytes], [12, "upsert", 1024]);
  assert.deepEqual(received.claimedPermissions, ["supplier.mgmt"]);
  assert.equal(received.content.toString(), "supplierCode\r\nSUP-1\r\n");
  assert.ok(buffer.every((byte) => byte === 0), "the upload buffer is zeroed after use");
});

test("without a prepared root the upload answers 503 and without a file 400, and the buffer is still wiped", async () => {
  const handler = new UploadSupplierImportHandler(services({ preparedRoot: null }));
  const buffer = Buffer.from("x");
  await assert.rejects(() => handler.execute(request(buffer)), { publicCode: "SUPPLIER_IMPORT_UNAVAILABLE", statusCode: 503 });
  assert.ok(buffer.every((byte) => byte === 0));
  const noWorker = new UploadSupplierImportHandler({ ...services(), get: () => undefined });
  await assert.rejects(() => noWorker.execute(request(Buffer.from("x"))), { publicCode: "SUPPLIER_IMPORT_UNAVAILABLE" },
    "an environment without the worker service is simply not deployed");
  await assert.rejects(() => new UploadSupplierImportHandler(services()).execute(request(null)),
    { publicCode: "SUPPLIER_IMPORT_FILE_REQUIRED", statusCode: 400 });
});
