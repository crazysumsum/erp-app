import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { recordShard, collectShards } from "./merge-server-coverage.test.mjs";

const temporary = t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ci-coverage-shards-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const identity = { commit: "synthetic-commit", node: process.version, cwd: "/synthetic/server" };
function artifact(root, shard, total = 2) {
  const directory = path.join(root, `server-coverage-${shard}`);
  mkdirSync(path.join(directory, "raw"), { recursive: true });
  writeFileSync(path.join(directory, "raw/coverage-1-1234567890123-0.json"), JSON.stringify({ result: [{ url: "file:///synthetic/source.js", functions: [] }] }));
  recordShard(directory, shard, total, identity);
  return directory;
}

test("coverage assembly requires every shard and keeps colliding report names distinct", t => {
  const root = temporary(t); artifact(root, 1); artifact(root, 2);
  const reports = collectShards(root, 2, identity);
  assert.equal(reports.length, 2);
  assert.notEqual(reports[0], reports[1]);
  rmSync(path.join(root, "server-coverage-2"), { recursive: true });
  assert.throws(() => collectShards(root, 2, identity));
});

test("wrong shard, total, candidate, runtime or source checkout fails closed", t => {
  const root = temporary(t), first = artifact(root, 1); artifact(root, 2);
  const manifestPath = path.join(first, "manifest.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [key, value] of Object.entries({ shard: 2, total: 3, commit: "another-commit", node: "another-node", cwd: "/other/server" })) {
    writeFileSync(manifestPath, JSON.stringify({ ...original, [key]: value }));
    assert.throws(() => collectShards(root, 2, identity), undefined, key);
  }
});

test("missing, empty and malformed raw coverage cannot satisfy the gate", t => {
  const root = temporary(t), first = artifact(root, 1); artifact(root, 2);
  const raw = path.join(first, "raw/coverage-1-1234567890123-0.json");
  for (const content of ["broken JSON", "{}", '{"result":[]}']) {
    writeFileSync(raw, content);
    assert.throws(() => collectShards(root, 2, identity));
  }
  rmSync(raw);
  assert.throws(() => collectShards(root, 2, identity));
});

test("the merged gate retains exactly the original global coverage thresholds", () => {
  const scripts = JSON.parse(readFileSync(new URL("../../server/package.json", import.meta.url), "utf8")).scripts;
  const thresholds = command => [...command.matchAll(/--test-coverage-(lines|branches|functions)=(\d+)/gu)].map(match => match[0]).sort();
  assert.equal(thresholds(scripts["test:coverage"]).length, 3);
  assert.deepEqual(thresholds(scripts["test:coverage:merge"]), thresholds(scripts["test:coverage"]));
  assert.match(scripts["test:coverage:merge"], /checkCoverageFloors\.js/u);
});

test("native sharded coverage equals the unsharded report and still rejects uncovered functions", t => {
  const root = temporary(t), artifacts = path.join(root, "artifacts");
  const source = path.join(root, "value.mjs"), files = [];
  writeFileSync(source, "export function choose(value) {\n  if (value === 1) return 'a';\n  if (value === 2) return 'b';\n  return 'c';\n}\nexport function unused() { return 'uncovered'; }\n");
  for (const [index, expected] of [[1, "a"], [2, "b"], [3, "c"], [4, "c"]]) {
    const file = path.join(root, `${index}.test.mjs`); files.push(file);
    writeFileSync(file, `import test from 'node:test';import assert from 'node:assert/strict';import {choose} from './value.mjs';test('case ${index}',()=>assert.equal(choose(${index}), '${expected}'));`);
  }
  const coverage = ["--test", "--test-concurrency=1", "--experimental-test-coverage"];
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_V8_COVERAGE;
  execFileSync(process.execPath, [...coverage, "--test-reporter=lcov", "--test-reporter-destination=baseline.lcov", ...files], { cwd: root, env: childEnv });
  const runtime = { commit: "synthetic-commit", node: process.version, cwd: root };
  const merge = fileURLToPath(new URL("./merge-server-coverage.test.mjs", import.meta.url));
  mkdirSync(artifacts);
  for (let shard = 1; shard <= 2; shard++) {
    const directory = path.join(artifacts, `server-coverage-${shard}`);
    execFileSync(process.execPath, [...coverage, `--test-shard=${shard}/2`, ...files], {
      cwd: root, env: { ...childEnv, NODE_V8_COVERAGE: path.join(root, "coverage/shard/raw") }
    });
    execFileSync(process.execPath, [merge, "record", String(shard), "2"], { cwd: root, env: { ...childEnv, GITHUB_SHA: runtime.commit } });
    renameSync(path.join(root, "coverage/shard"), directory);
  }
  const env = { ...childEnv, COVERAGE_SHARD_ROOT: artifacts, COVERAGE_SHARD_TOTAL: "2", GITHUB_SHA: runtime.commit };
  const command = JSON.parse(readFileSync(new URL("../../server/package.json", import.meta.url), "utf8")).scripts["test:coverage:merge"];
  const exclusions = [...command.matchAll(/--test-coverage-exclude=(?:'([^']+)'|(\S+))/gu)].map(match => match[1] ?? match[2]);
  assert.equal(exclusions.length, 2);
  const mergedCoverage = [...coverage, ...exclusions.map(pattern => `--test-coverage-exclude=${pattern.startsWith("../.github/") ? merge : pattern}`)];
  const merged = spawnSync(process.execPath, [...mergedCoverage, "--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=lcov", "--test-reporter-destination=merged.lcov", merge], { cwd: root, env, encoding: "utf8" });
  assert.equal(merged.status, 0, merged.stdout + merged.stderr);
  assert.equal(readFileSync(path.join(root, "merged.lcov"), "utf8"), readFileSync(path.join(root, "baseline.lcov"), "utf8"));
  const failed = spawnSync(process.execPath, [...mergedCoverage, "--test-coverage-functions=100", merge], { cwd: root, env, encoding: "utf8" });
  assert.notEqual(failed.status, 0, "An uncovered function must still fail the native threshold");
});
