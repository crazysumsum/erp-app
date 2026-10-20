import assert from "node:assert/strict";
import test from "node:test";
import { constants, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const runtimeIdentity = () => ({ commit: process.env.GITHUB_SHA, node: process.version, cwd: process.cwd() });
function validateIdentity(identity) {
  for (const key of ["commit", "node", "cwd"]) assert.ok(typeof identity[key] === "string" && identity[key].length > 0, `Missing coverage ${key}`);
}
function reportsIn(directory) {
  const entries = readdirSync(path.join(directory, "raw"), { withFileTypes: true });
  assert.ok(entries.length > 0, "Raw coverage is missing");
  return entries.map(entry => {
    assert.ok(entry.isFile() && /^coverage-\d+-\d{13}-\d+\.json$/u.test(entry.name), "Unexpected coverage entry");
    return path.join(directory, "raw", entry.name);
  }).sort();
}

export function recordShard(directory, shard, total, identity = runtimeIdentity()) {
  assert.ok(Number.isSafeInteger(shard) && Number.isSafeInteger(total) && shard >= 1 && shard <= total);
  validateIdentity(identity);
  const reports = reportsIn(directory);
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ ...identity, shard, total, reports: reports.length }));
}

export function collectShards(root, total, identity = runtimeIdentity()) {
  assert.ok(Number.isSafeInteger(total) && total > 0, "Invalid shard count");
  validateIdentity(identity);
  const names = Array.from({ length: total }, (_, index) => `server-coverage-${index + 1}`);
  assert.deepEqual(readdirSync(root).sort(), [...names].sort(), "Coverage shards missing or unexpected");
  return names.flatMap((name, index) => {
    const directory = path.join(root, name);
    const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
    for (const [key, expected] of Object.entries({ ...identity, shard: index + 1, total })) {
      assert.equal(manifest[key], expected, `Mismatched coverage ${name}:${key}`);
    }
    const reports = reportsIn(directory);
    assert.equal(reports.length, manifest.reports, "Coverage report missing after recording");
    for (const report of reports) {
      const raw = JSON.parse(readFileSync(report, "utf8"));
      assert.ok(Array.isArray(raw.result) && raw.result.length > 0, "Invalid raw V8 coverage");
    }
    return reports;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "record") {
    recordShard(path.resolve("coverage/shard"), Number(process.argv[3]), Number(process.argv[4]));
  } else {
    test("assemble all shard reports for native Node coverage and unchanged thresholds", () => {
      assert.ok(process.env.NODE_V8_COVERAGE, "Run with --experimental-test-coverage");
      const reports = collectShards(process.env.COVERAGE_SHARD_ROOT, Number(process.env.COVERAGE_SHARD_TOTAL));
      mkdirSync(process.env.NODE_V8_COVERAGE, { recursive: true });
      reports.forEach((source, index) => {
        // Node reads these raw files and merges source ranges itself; no LCOV averaging.
        const destination = path.join(process.env.NODE_V8_COVERAGE, `coverage-${index + 1}-1234567890123-0.json`);
        copyFileSync(source, destination, constants.COPYFILE_EXCL);
      });
    });
  }
}
