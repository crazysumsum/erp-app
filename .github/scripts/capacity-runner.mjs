import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { cases, escapePattern, nodePlan, routinePattern, validateCatalog } from "./capacity-cases.mjs";

export function checkNodeReport(report, expected) {
  for (const [key, count] of [["tests", expected.length], ["pass", expected.length], ["fail", 0], ["cancelled", 0], ["skipped", 0], ["todo", 0]]) {
    assert.match(report, new RegExp(`^# ${key} ${count}$`, "mu"), `Capacity ${key} must be ${count}`);
  }
  const passed = report.split("\n").filter(line => /^\s*ok \d+ - /u.test(line)).map(line => line.replace(/^\s*ok \d+ - /u, ""));
  assert.deepEqual(passed.sort(), [...expected].sort(), "Every selected case and required setup must pass exactly once");
}

export function checkClientReport(report, selected) {
  const assertions = report.testResults.flatMap(file => file.assertionResults);
  const passed = assertions.filter(test => test.status === "passed").map(test => test.title);
  assert.equal(report.success, true);
  assert.equal(report.numFailedTests, 0);
  assert.deepEqual(passed.sort(), selected.flatMap(c => c.names).sort(), "Every selected client case must actually pass");
}

async function run(command, args, { cwd, tapFile } = {}) {
  const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "inherit"] });
  let report = "", stopped = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    report += chunk;
    process.stdout.write(chunk);
    if (tapFile && !stopped && /^\s*not ok \d+ - /mu.test(report)) {
      stopped = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
  if (tapFile) writeFileSync(tapFile, report);
  assert.ok(!stopped, "Capacity batch stopped on first failure; report to Sam before retrying");
  assert.equal(result.status, 0, `Capacity process failed (${result.signal ?? result.status}); do not retry without Sam's decision`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  if (action === "server-pattern" || action === "client-pattern") {
    process.stdout.write(routinePattern(action === "client-pattern"));
  } else {
    assert.equal(action, "run");
    validateCatalog();
    assert.ok(!process.env.NODE_V8_COVERAGE, "Timed capacity must run without coverage instrumentation");
    const group = process.argv[3], ids = JSON.parse(process.env.CAPACITY_SELECTION);
    assert.ok(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, "Missing or duplicate capacity selection");
    for (const id of ids) assert.ok(cases.some(c => c.id === id), `Unknown capacity ID: ${id}`);
    const selected = cases.filter(c => c.group === group && ids.includes(c.id));
    assert.ok(selected.length > 0, `No selected cases for ${group}`);
    process.stdout.write(`Selected existing cases: ${JSON.stringify(selected.map(c => ({ id: c.id, names: c.names })))}\n`);
    if (group === "client") {
      const cwd = fileURLToPath(new URL("../../client/", import.meta.url));
      const reporter = fileURLToPath(new URL("../../client/capacity-client.json", import.meta.url));
      const pattern = `(?:^| )(?:${selected.flatMap(c => c.names).map(escapePattern).join("|")})$`;
      await run(process.execPath, [fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url)), "run",
        ...new Set(selected.map(c => c.file.slice("client/".length))), `--testNamePattern=${pattern}`,
        "--no-file-parallelism", "--maxWorkers=1", "--bail=1", "--coverage.enabled=false", "--reporter=default", "--reporter=json", `--outputFile.json=${reporter}`], { cwd });
      checkClientReport(JSON.parse(readFileSync(reporter, "utf8")), selected);
    } else {
      assert.equal(process.env.DB_INTEGRATION_TESTS, "1", "Native capacity requires the owned CI database");
      const plan = nodePlan(selected);
      const report = await run(process.execPath, ["--test", "--test-concurrency=1", "--import", "./test-support/testEnv.js", "--test-reporter=tap",
        `--test-name-pattern=${plan.pattern}`, `--test-skip-pattern=${plan.skip}`, ...plan.files],
      { cwd: fileURLToPath(new URL("../../server/", import.meta.url)), tapFile: `capacity-${group}.tap` });
      checkNodeReport(report, plan.expected);
    }
  }
}
