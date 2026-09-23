import assert from "node:assert/strict";
import test from "node:test";

import { CustomerAttachmentRecoveryJob } from "../src/services/customerFile/CustomerAttachmentRecoveryJob.js";

test("Customer attachment recovery job is bounded, cluster-scoped and safe when the capability is disabled", async () => {
  const scheduler = { register(value) { this.registered = value; } };
  const services = { require(name) {
    if (name === "scheduler") return scheduler;
    if (name === "time") return { nowMs: () => 1000 };
    throw new Error(`unexpected dependency ${name}`);
  } };
  const job = new CustomerAttachmentRecoveryJob({ config: { customer: { attachment: null } }, services });
  await job.initialize();
  assert.equal(scheduler.registered, job);
  assert.deepEqual(await job.run(), { processed: 0, activated: 0, failed: 0, lastId: 0, stageProcessed: 0, stageCleaned: 0, stageFailed: 0, abandonedOperations: 0 });
  assert.deepEqual(CustomerAttachmentRecoveryJob.jobs[0], {
    name: "customerAttachment.recover", method: "run", scope: "cluster", intervalMs: 60_000, timeoutMs: 30_000
  });
});
