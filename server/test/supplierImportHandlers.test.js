import assert from "node:assert/strict";
import test from "node:test";

import {
  CancelSupplierImportHandler, GetSupplierImportHandler, ListSupplierImportsHandler
} from "../src/handlers/supplier-imports/jobHandlers.js";
import { CANCELLABLE_JOB_STATUSES, importJobSummary, SupplierImportService } from "../src/modules/supplier/SupplierImportService.js";

/** TASK-044：job list／get／cancel 嘅 route contract 同 handler 行為（service 用替身）。真 SQL 喺整合測試。 */
function services({ preparedRoot = "/srv/imports/real", worker = true } = {}) {
  return {
    get(name) {
      return worker && name === "job.supplierImportWorker" ? { preparedRoot } : undefined;
    },
    require(name) {
      if (name === "logging") return { logger: {} };
      return {};
    }
  };
}

const auth = { claims: { sub: "12", roles: ["buyer"], permissions: ["supplier.mgmt"] } };

test("the three routes need supplier.mgmt, and only cancel is idempotent", () => {
  const routes = [ListSupplierImportsHandler, GetSupplierImportHandler, CancelSupplierImportHandler]
    .map(({ api }) => [api.method, api.path, api.authorizationPolicies[0].options.permissions, api.idempotency?.enabled ?? false]);
  assert.deepEqual(routes, [
    ["GET", "/api/v1/supplier-imports", ["supplier.mgmt"], false],
    ["GET", "/api/v1/supplier-imports/:id", ["supplier.mgmt"], false],
    ["POST", "/api/v1/supplier-imports/:id/cancel", ["supplier.mgmt"], true]
  ]);
});

test("paging is bounded to 1-100 rows a page and every request schema is closed", () => {
  for (const handler of [ListSupplierImportsHandler, GetSupplierImportHandler]) {
    const { query } = handler.api.requestSchema;
    assert.equal(query.additionalProperties, false, handler.handlerName);
    assert.deepEqual([query.properties.pageSize.minimum, query.properties.pageSize.maximum, query.properties.pageSize.default], [1, 100, 20]);
    assert.equal(query.properties.page.minimum, 1);
  }
  const { params, body } = CancelSupplierImportHandler.api.requestSchema;
  assert.equal(params.additionalProperties, false);
  assert.deepEqual([body.additionalProperties, body.required], [false, ["version"]]);
});

test("responses carry no stored name, hash, lease, path or expected version", () => {
  const detail = GetSupplierImportHandler.api.responseSchema[200];
  const job = detail.properties.job;
  const row = detail.properties.rows.items;
  assert.deepEqual([job.additionalProperties, row.additionalProperties], [false, false]);
  for (const hidden of ["sourceStoredName", "resultStoredName", "sourceSha256", "leaseOwner", "leaseUntil", "path", "createdBy"]) {
    assert.equal(Object.hasOwn(job.properties, hidden), false, `job.${hidden}`);
  }
  for (const hidden of ["expectedSupplierVersion", "raw", "line"]) assert.equal(Object.hasOwn(row.properties, hidden), false, `row.${hidden}`);
  assert.equal(CancelSupplierImportHandler.api.responseSchema[200], job);
  assert.equal(ListSupplierImportsHandler.api.responseSchema[200].properties.items.items, job);
});

test("list and get hand the actor and the query to the service", async () => {
  const calls = [];
  const fake = { list: async (input) => { calls.push(["list", input]); return { items: [] }; },
    get: async (input) => { calls.push(["get", input]); return { job: {} }; } };
  const list = new ListSupplierImportsHandler(services());
  list.imports = fake;
  await list.execute({ auth, input: { query: { page: 2, pageSize: 50, status: "ready" } } });
  const get = new GetSupplierImportHandler(services());
  get.imports = fake;
  await get.execute({ auth, input: { params: { id: 9 }, query: { page: 1, pageSize: 20, rowStatus: "invalid" } } });
  const actor = { actorId: 12, claimedRoles: ["buyer"], claimedPermissions: ["supplier.mgmt"] };
  assert.deepEqual(calls, [
    ["list", { ...actor, page: 2, pageSize: 50, status: "ready" }],
    ["get", { ...actor, id: 9, page: 1, pageSize: 20, rowStatus: "invalid" }]
  ]);
});

test("cancel hands the prepared real root, or null when import is not deployed", async () => {
  for (const [options, root] of [[{}, "/srv/imports/real"], [{ preparedRoot: null }, null], [{ worker: false }, null]]) {
    const handler = new CancelSupplierImportHandler(services(options));
    let received;
    handler.imports = { async cancel(input) { received = input; return { id: 9 }; } };
    await handler.execute({ auth, input: { params: { id: 9 }, body: { version: 3 } }, requestId: "req-9", ip: "10.0.0.1" });
    assert.deepEqual(received, { actorId: 12, claimedRoles: ["buyer"], claimedPermissions: ["supplier.mgmt"], id: 9, version: 3,
      root, requestId: "req-9", ip: "10.0.0.1" });
  }
});

test("only jobs not yet prechecking or running can be cancelled (HD-058 2A)", () => {
  assert.deepEqual([...CANCELLABLE_JOB_STATUSES], ["uploaded", "ready", "ready_with_errors", "queued"]);
});

test("the summary says whether the files are gone, and maps nullable times", () => {
  const row = { id: "4", template_version: "v1", mode: "upsert", activation_mode: null, status: "cancelled", total_count: "3",
    valid_count: "2", warning_count: "0", invalid_count: "1", applied_count: "0", failed_count: "0", skipped_count: "0",
    last_error_code: "", error_summary: "", created_at: "10", updated_at: "20", confirmed_at: null, completed_at: "20",
    files_purged_at: "20", version: "2" };
  const summary = importJobSummary(row);
  assert.deepEqual([summary.filesPurged, summary.confirmedAt, summary.completedAt, summary.activationMode], [true, null, 20, null]);
  assert.equal(importJobSummary({ ...row, files_purged_at: null }).filesPurged, false);
});

test("list, get and cancel refuse malformed input before touching the database", async () => {
  const database = { query() { throw new Error("must not be reached"); }, withTransaction() { throw new Error("must not be reached"); } };
  const importer = new SupplierImportService({ database, time: { nowMs: () => 1 }, authorize: () => { throw new Error("must not be reached"); } });
  const actor = { actorId: 12, claimedRoles: [], claimedPermissions: [] };
  for (const input of [{ pageSize: 101 }, { pageSize: 0 }, { page: 0 }, { page: 1.5 }, { status: "nope" }, { page: Number.MAX_SAFE_INTEGER }]) {
    await assert.rejects(() => importer.list({ ...actor, ...input }), TypeError, JSON.stringify(input));
  }
  await assert.rejects(() => importer.get({ ...actor, id: 0 }), TypeError);
  await assert.rejects(() => importer.get({ ...actor, id: 1, rowStatus: "nope" }), TypeError);
  await assert.rejects(() => importer.cancel({ ...actor, id: 1, version: 0 }), TypeError);
  await assert.rejects(() => importer.cancel({ ...actor, id: "1", version: 1 }), TypeError);
});
