import assert from "node:assert/strict";
import test from "node:test";

import { CustomerImportWorkerService } from "../src/services/customerImport/CustomerImportWorkerService.js";

function worker() {
  const registered = [];
  const values = {
    scheduler: { register(value) { registered.push(value); } },
    mysqldatabase: {}, logging: { logger: {} }, time: { nowMs: () => 1_000_000 }
  };
  const instance = new CustomerImportWorkerService({
    config: { customer: { import: { root: "/tmp/customer-import-worker", maxFileBytes: 1024, maxRows: 100, rowBatchSize: 10 } } },
    services: { require(name) { return values[name]; } }, options: { instanceId: "worker-1" }
  });
  return { instance, registered };
}

test("Customer import worker runs execution rows to a finalized result and keeps recovery bounded", async () => {
  const { instance, registered } = worker();
  await instance.initialize();
  assert.deepEqual(registered, [instance]);
  assert.deepEqual(CustomerImportWorkerService.jobs.map((job) => job.name), [
    "customer.import.precheck", "customer.import.execute", "customer.import.fileRecovery"
  ]);
  const rows = [{ status: "applied" }, { status: "failed" }, null]; const calls = [];
  instance.importService = {
    async claimForExecution(input) { calls.push(["claim", input]); return { id: 12 }; },
    async processNextRow(input) { calls.push(["row", input.jobId]); return rows.shift(); },
    async finalizeExecution(input) { calls.push(["finalize", input.jobId]); return { status: "completed_with_errors" }; },
    async recoverFiles(input) { calls.push(["recover", input]); return { recovered: 1, failed: 0 }; }
  };
  instance.exportService = { async recoverFiles(input) { calls.push(["export-recover", input]); return { recovered: 2, failed: 1 }; } };
  const result = await instance.runExecution();
  assert.deepEqual(result, { claimed: true, jobId: 12, applied: 1, failed: 1, status: "completed_with_errors" });
  assert.equal(calls.filter(([kind]) => kind === "row").length, 3);
  assert.deepEqual(await instance.runFileRecovery(), { recovered: 3, failed: 1 });
  assert.deepEqual(calls.slice(-2), [
    ["recover", { staleBefore: 700_000, limit: 10 }],
    ["export-recover", { staleBefore: 700_000, limit: 10 }]
  ]);
});

test("Customer import worker stays idle when disabled, aborted or without a claimed job", async () => {
  const { instance } = worker();
  instance.importService = null;
  assert.deepEqual(await instance.runExecution(), { claimed: false });
  assert.deepEqual(await instance.runFileRecovery(), { recovered: 0, failed: 0 });
  instance.importService = { async claimForExecution() { return null; } };
  assert.deepEqual(await instance.runExecution(), { claimed: false });
  assert.deepEqual(await instance.runExecution({ aborted: true }), { claimed: false });
});
