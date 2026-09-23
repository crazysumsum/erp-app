import assert from "node:assert/strict";
import test from "node:test";

import { precheckCustomerImportJob } from "../src/services/customerImport/jobs/precheckCustomerImportJob.js";

test("Customer import precheck worker records deterministic source failures and releases the job", async () => {
  const recorded = [];
  const result = await precheckCustomerImportJob({
    importService: {
      async claimForPrecheck() { return { id: 9, mode: "upsert" }; },
      async readSource() { throw new Error("private path must not leak"); },
      async recordPrecheck(input) { recorded.push(input); return { status: "failed", totalCount: 0, validCount: 0, warningCount: 0, invalidCount: 0 }; }
    },
    database: {}, leaseOwner: "worker", leaseDurationMs: 1000, maxRows: 10_000,
    maxBytes: 20 * 1024 * 1024, rowBatchSize: 100
  });
  assert.deepEqual(result, { claimed: true, jobId: 9, status: "failed" });
  assert.equal(recorded[0].jobLevelError.code, "SOURCE_FILE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(recorded), /private path/u);
});

test("Customer import precheck worker is idle when no job is claimable", async () => {
  const result = await precheckCustomerImportJob({
    importService: { async claimForPrecheck() { return null; } }, leaseOwner: "worker", leaseDurationMs: 1000
  });
  assert.deepEqual(result, { claimed: false });
});
