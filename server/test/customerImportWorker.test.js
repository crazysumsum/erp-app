import assert from "node:assert/strict";
import test from "node:test";

import { precheckCustomerImportJob } from "../src/services/customerImport/jobs/precheckCustomerImportJob.js";
import { CUSTOMER_IMPORT_COLUMN_NAMES } from "../src/modules/customer/import/customerCsvSchema.js";

function csv(rows) {
  return Buffer.from(`${CUSTOMER_IMPORT_COLUMN_NAMES.join(",")}\r\n${rows.map((row) => CUSTOMER_IMPORT_COLUMN_NAMES.map((name) => row[name] ?? "").join(",")).join("\r\n")}\r\n`);
}

test("Customer import precheck worker records deterministic source failures and releases the job", async () => {
  const recorded = [];
  const result = await precheckCustomerImportJob({
    importService: {
      async claimForPrecheck() { return { id: 9, mode: "upsert" }; },
      async preparePrecheck() {},
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

test("Customer import precheck worker persists bounded batches before final summary", async () => {
  const batches = []; const completed = [];
  const rows = Array.from({ length: 5 }, (_, index) => ({
    customerCode: `C-${index + 1}`, legalName: `Customer ${index + 1}`, defaultCurrencyCode: "HKD"
  }));
  const database = {
    async query(sql) {
      if (String(sql).includes("FROM currencies")) return [[{ code: "HKD", status: "ACTIVE" }]];
      return [[]];
    }
  };
  const result = await precheckCustomerImportJob({
    importService: {
      async claimForPrecheck() { return { id: 9, mode: "upsert" }; },
      async preparePrecheck() {},
      async readSource() { return csv(rows); },
      async appendPrecheckRows(input) { batches.push(input.rows.length); },
      async recordPrecheck(input) {
        completed.push(input);
        return { status: "ready", totalCount: input.counts.total, validCount: input.counts.valid, warningCount: 0, invalidCount: 0 };
      }
    },
    database, leaseOwner: "worker", leaseDurationMs: 1000, maxRows: 10_000,
    maxBytes: 20 * 1024 * 1024, rowBatchSize: 2
  });
  assert.deepEqual(batches, [2, 2, 1]);
  assert.equal(completed[0].rows, undefined);
  assert.deepEqual(result, { claimed: true, jobId: 9, status: "ready" });
});

test("Customer import precheck worker is idle when no job is claimable", async () => {
  const result = await precheckCustomerImportJob({
    importService: { async claimForPrecheck() { return null; } }, leaseOwner: "worker", leaseDurationMs: 1000
  });
  assert.deepEqual(result, { claimed: false });
});
