import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SupplierImportFilePurgeJob } from "../src/services/supplierImport/jobs/SupplierImportFilePurgeJob.js";
import { removeVerifiedSupplierImportFile, supplierImportDirectory } from "../src/services/supplierImport/supplierImportFiles.js";

/** TASK-048：刪檔前嘅檢查（REV-059 L-6）同 purge job 嘅流程。真檔案系統同 MySQL 喺 supplierImportRetention 整合測試。 */
const NAME = "a".repeat(64);

function tempRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "supplier-purge-unit-")));
  fs.mkdirSync(path.join(root, "source"), { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a verified delete removes a single-link regular file and is idempotent", async (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, "source", NAME), "x");
  const directory = await supplierImportDirectory(root, "source");
  assert.equal(await removeVerifiedSupplierImportFile(directory, NAME), "deleted");
  assert.equal(await removeVerifiedSupplierImportFile(directory, NAME), "missing");
  assert.equal(await supplierImportDirectory(root, "result"), null, "a kind directory not yet created has nothing to purge");
});

test("a verified delete refuses a changed directory, a symlink, a second hard link, another filesystem, or a bad name", async (t) => {
  const root = tempRoot(t);
  const file = path.join(root, "source", NAME);
  fs.writeFileSync(file, "x");
  const directory = await supplierImportDirectory(root, "source");
  const unsafe = { code: "SUPPLIER_IMPORT_PURGE_UNSAFE" };

  await assert.rejects(removeVerifiedSupplierImportFile({ ...directory, ino: directory.ino + 1 }, NAME), unsafe, "directory swapped");
  const faked = (patch) => async (target) => Object.assign(await lstat(target), target === file ? patch : {});
  await assert.rejects(removeVerifiedSupplierImportFile(directory, NAME, { lstat: faked({ nlink: 2 }) }), unsafe, "hard link");
  await assert.rejects(removeVerifiedSupplierImportFile(directory, NAME, { lstat: faked({ dev: directory.dev + 1 }) }), unsafe, "other fs");
  await assert.rejects(removeVerifiedSupplierImportFile(directory, NAME, { lstat: faked({ isFile: () => false }) }), unsafe, "not a file");
  await assert.rejects(removeVerifiedSupplierImportFile(directory, "../x"), TypeError);
  assert.ok(fs.existsSync(file), "nothing was removed");

  const target = path.join(root, "outside.txt");
  fs.writeFileSync(target, "keep");
  fs.symlinkSync(target, path.join(root, "source", "b".repeat(64)));
  await assert.rejects(removeVerifiedSupplierImportFile(directory, "b".repeat(64)), unsafe, "symlink");
  assert.equal(fs.readFileSync(target, "utf8"), "keep");

  const swapped = path.join(root, "source-old");
  fs.renameSync(path.join(root, "source"), swapped);
  fs.symlinkSync(swapped, path.join(root, "source"));
  await assert.rejects(removeVerifiedSupplierImportFile(directory, NAME), unsafe, "directory replaced by a symlink");
  assert.ok(fs.existsSync(path.join(swapped, NAME)));
});

test("a file changed after the cut-off is kept for an upload still inserting its job", async (t) => {
  const root = tempRoot(t);
  fs.writeFileSync(path.join(root, "source", NAME), "x");
  const directory = await supplierImportDirectory(root, "source");
  assert.equal(await removeVerifiedSupplierImportFile(directory, NAME, { notNewerThanMs: Date.now() - 86_400_000 }), "too_new");
  assert.equal(await removeVerifiedSupplierImportFile(directory, NAME, { notNewerThanMs: Date.now() + 1000 }), "deleted");
});

function purgeJob({ root, candidates = [], expire = (id) => [{ kind: "source", storedName: `${id}`.padStart(64, "0") }], referenced = [] } = {}) {
  const calls = { candidates: [], expired: [], marked: [] };
  const importService = {
    async purgeCandidates(input) { calls.candidates.push(input); return candidates.splice(0, input.limit); },
    async expireUnconfirmed({ id }) { calls.expired.push(id); return expire(id); },
    async markExecutedFilesPurged({ id }) { calls.marked.push(id); return expire(id); },
    async referencedStoredNames() { return new Set(referenced); }
  };
  const services = { require: (name) => ({
    scheduler: { register() {} }, logging: { logger: { info() {}, error() {} } }, time: { nowMs: () => 1_000 * 86_400_000 },
    "job.supplierImportWorker": { preparedRoot: root }, mysqldatabase: {}
  })[name] };
  const job = new SupplierImportFilePurgeJob({ config: { supplier: { import: { fileRetentionDays: 365, unconfirmedRetentionDays: 30 } } },
    services, options: { importService } });
  return { job, calls };
}

test("the job does nothing when import is not deployed", async () => {
  const { job, calls } = purgeJob({ root: null });
  assert.deepEqual(await job.purge(new AbortController().signal), { skipped: true });
  assert.equal(calls.candidates.length, 0);
});

test("the job routes executed and unconfirmed jobs, uses both cut-offs, and counts a lost race", async (t) => {
  const root = tempRoot(t);
  const { job, calls } = purgeJob({ root, expire: (id) => (id === 3 ? null : []),
    candidates: [{ id: 1, status: "completed" }, { id: 2, status: "ready" }, { id: 3, status: "uploaded" }, { id: 4, status: "failed" }] });
  const counts = await job.purge(new AbortController().signal);
  assert.deepEqual([calls.marked, calls.expired], [[1, 4], [2, 3]]);
  assert.deepEqual([counts.retained, counts.expired, counts.raced], [2, 1, 1]);
  assert.deepEqual([calls.candidates[0].executedBefore, calls.candidates[0].unconfirmedBefore],
    [(1_000 - 365) * 86_400_000, (1_000 - 30) * 86_400_000]);
});

test("the job pages through a backlog and stops at once when aborted", async (t) => {
  const root = tempRoot(t);
  const many = Array.from({ length: 450 }, (_, index) => ({ id: index + 1, status: "completed" }));
  const { job, calls } = purgeJob({ root, candidates: many, expire: () => [] });
  assert.equal((await job.purge(new AbortController().signal)).retained, 450);
  assert.deepEqual(calls.candidates.map((input) => input.limit), [200, 200, 200]);

  const aborted = new AbortController();
  aborted.abort();
  const stopped = purgeJob({ root, candidates: [{ id: 1, status: "completed" }], expire: () => [] });
  const counts = await stopped.job.purge(aborted.signal);
  assert.deepEqual([counts.retained, stopped.calls.marked, stopped.calls.candidates], [0, [], []], "not even a query once aborted");
});
