import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function requiresCapacity(event, files) {
  if (event !== "pull_request" || files.length === 0) return true;
  return files.some(file => {
    if (file.startsWith(".github/")) return true;
    if (/^(docs\/.*|[^/]+)\.md$/u.test(file)) return false;
    if (file.startsWith("client/")) {
      return /^client\/(package(?:-lock)?\.json|src\/framework\/)/u.test(file)
        || /\/sales/iu.test(file);
    }
    // Only established independent Supplier code/tests are exempt; new paths run.
    return !/^server\/(src\/(modules\/supplier|handlers\/suppliers)\/|test\/(supplier\/|(?:integration\/)?supplier[^/]*\.test\.js$))/u.test(file);
  });
}

export function requiresFulfillmentCapacity(event, files) {
  if (event !== "pull_request" || files.length === 0) return true;
  // Only prose and established independent Supplier code/tests are exempt.
  // Fulfillment, Sales/Inventory providers, DB, framework, CI and unknown paths run.
  return files.some(file => !/^(docs\/.*|[^/]+)\.md$/u.test(file)
    && !/^server\/(src\/(modules\/supplier|handlers\/suppliers)\/|test\/(supplier\/|(?:integration\/)?supplier[^/]*\.test\.js$))/u.test(file));
}

export function checkResults(needs) {
  for (const job of ["changes", "regression", "audit", "lint", "build", "e2e"]) {
    assert.equal(needs[job]?.result, "success", `${job} must succeed`);
  }
  const required = needs.changes.outputs?.required;
  assert.ok(required === "true" || required === "false", "Missing capacity decision");
  assert.equal(needs["sales-import-capacity"]?.result, required === "true" ? "success" : "skipped",
    "Capacity must pass when required, or be explicitly inapplicable");
  const fulfillmentRequired = needs.changes.outputs?.fulfillment_required;
  assert.ok(fulfillmentRequired === "true" || fulfillmentRequired === "false", "Missing Fulfillment capacity decision");
  assert.equal(needs["fulfillment-capacity"]?.result, fulfillmentRequired === "true" ? "success" : "skipped",
    "Fulfillment capacity must pass when required, or be explicitly inapplicable");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "check") {
    checkResults(JSON.parse(process.env.CI_RESULTS));
  } else {
    let required = true;
    let fulfillmentRequired = true;
    let reason = "Full validation outside pull requests";
    if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      try {
        const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
        for (const sha of [pr.base.sha, pr.head.sha]) assert.match(sha, /^[a-f0-9]{40}$/u);
        const gitOptions = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
        const base = execFileSync("git", ["merge-base", pr.base.sha, pr.head.sha], gitOptions).trim();
        // Keep deleted/old rename paths so moving a dependency cannot hide it.
        const files = execFileSync("git", ["diff", "--name-only", "-z", "--no-renames", base, pr.head.sha, "--"], gitOptions)
          .split("\0").filter(Boolean);
        required = requiresCapacity("pull_request", files);
        fulfillmentRequired = requiresFulfillmentCapacity("pull_request", files);
        reason = required ? "Relevant, unknown or empty change set" : "Only known unrelated paths changed";
      } catch {
        reason = "Unable to determine PR impact; full validation required";
      }
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `fulfillment_required=${fulfillmentRequired}\n`);
    process.stdout.write(`Sales import capacity required=${required}: ${reason}\n`);
    process.stdout.write(`Fulfillment capacity required=${fulfillmentRequired}\n`);
  }
}
