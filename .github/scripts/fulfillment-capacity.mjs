import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Existing cases only. Exact names keep ordinary cases in these same files in coverage.
export const cases = [
  ["fulfillmentQueueCapacity", "P1 Queue returns 100 SKU lines backed by 5000 native Reservations within the original two-second inquiry budget"],
  ["fulfillmentDraftCapacity", "Maximum100-line/5000-member Create and Update retain all Claims and roll back the last failed Claim batch"],
  ["fulfillmentCandidates", "HD018 100-line/5000-Claim advisory shares each SKU budget without changing owner quantities"],
  ["fulfillmentAllocationApi", "P1 full Allocate 100-line/5000-Reservation capacity retains the original20-second transaction limit"],
  ["fulfillmentReallocationApi", "P1 full5000-member Reallocate retains20s and restores the final projection batch before same-event recovery"],
  ["fulfillmentPickingApi", "P1 full5000-member Pick retains20s, releases4999 Short members and restores final projection and audit batches before recovery"],
  ["fulfillmentCancellationCapacity", "P1 Cancel5000 picked Allocations retains20s and every picked fact through final projection, Claim and audit rollback"],
  ["fulfillmentCancellationCapacity", "P1 DRAFT Cancel5000 Claims preserves20s and no Inventory DML through final Claim rollback and recovery"],
  ["fulfillmentHttpCapacity", "Full5000 actualHTTP Allocate/Reallocate/Pick retain20s, strict permissions, late rollback and exact replay"],
  ["fulfillmentPrintCapacity", "Pick List retains all100lines/5000current Allocations within original3s preview budget and20s transactions"],
  ...[100, 5000].flatMap(balances => [
    ["fulfillmentReallocationCandidateCapacity", `HD020 full100lines/5000members over ${balances} balances share all own credits with zeroDML and unchanged20s`],
    ["fulfillmentAllocationPreviewCapacity", `HD024 full100lines/5000members over ${balances} balances preview actual selections and all own credits with zeroDML and unchanged20s`]
  ])
];

export const pattern = `^(?:${cases.map(([, name]) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})$`;

export function checkReport(report) {
  for (const [key, count] of [["tests", cases.length], ["pass", cases.length], ["fail", 0], ["cancelled", 0], ["skipped", 0], ["todo", 0]]) {
    assert.match(report, new RegExp(`^# ${key} ${count}$`, "mu"), `Capacity ${key} must be ${count}`);
  }
  for (const [, name] of cases) {
    assert.ok(report.split("\n").some(line => /^ok \d+ - /u.test(line) && line.replace(/^ok \d+ - /u, "") === name),
      `Missing capacity PASS: ${name}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "pattern") {
    process.stdout.write(pattern);
  } else {
    assert.equal(process.argv[2], "run", "Expected pattern or run");
    assert.equal(process.env.DB_INTEGRATION_TESTS, "1", "Capacity requires the native database");
    assert.ok(!process.env.NODE_V8_COVERAGE, "Timed capacity must run without coverage instrumentation");
    const files = [...new Set(cases.map(([file]) => `test/integration/${file}.integration.test.js`))];
    // Stream results and stop the whole runner process group on the first failure.
    // CI is Linux; detached gives the Node runner and its test children one owned group.
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--import", "./test-support/testEnv.js",
      "--test-reporter=tap", `--test-name-pattern=${pattern}`, ...files], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let report = "", stopped = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      report += chunk;
      process.stdout.write(chunk);
      if (!stopped && /^\s*not ok \d+ - /mu.test(report)) {
        stopped = true;
        try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal }));
    });
    writeFileSync("fulfillment-capacity.tap", report);
    assert.ok(!stopped, "Capacity batch stopped after its first failure; do not retry without Sam's decision");
    assert.equal(result.status, 0, `Capacity process failed (${result.signal ?? result.status})`);
    checkReport(report);
  }
}
