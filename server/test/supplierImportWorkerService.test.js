import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SupplierImportWorkerService } from "../src/services/supplierImport/SupplierImportWorkerService.js";
import { prepareSupplierImportRoot, SUPPLIER_IMPORT_JOB_NAMES } from "../src/services/supplierImport/supplierImportFiles.js";

/**
 * TASK-042：worker 嘅生命週期（領取、逐列、停低）同 import root 嘅準備。資料庫嘅部分喺
 * test/integration/supplierImportExecution.integration.test.js。
 */
function worker({ root = "/srv/imports", applyRow = async () => 1 } = {}) {
  const registered = [];
  const services = {
    require(name) {
      if (name === "scheduler") return { register: (instance) => registered.push(instance) };
      if (name === "logging") return { logger: { info() {} } };
      if (name === "time") return { nowMs: () => 1 };
      return {};
    }
  };
  const instance = new SupplierImportWorkerService({ config: { supplier: { import: { root } } }, services, options: { applyRow } });
  return { instance, registered };
}

/** 一個跟住腳本行嘅 import service：記低 worker 叫咗乜。 */
function scripted(rowsLeft, { onRow = () => {} } = {}) {
  const calls = [];
  return {
    calls,
    async claimForExecution() { calls.push("claim"); return { id: 7, resumed: false }; },
    async processNextRow() {
      calls.push("row");
      onRow();
      if (rowsLeft === 0) return null;
      rowsLeft -= 1;
      return { status: "applied" };
    },
    async finalizeExecution() { calls.push("finalize"); return { status: "completed", applied: 2, failed: 0, skipped: 0 }; }
  };
}

test("the worker's scheduled job carries the name T41 reserved for it", () => {
  assert.deepEqual(SupplierImportWorkerService.jobs.map((job) => job.name), [SUPPLIER_IMPORT_JOB_NAMES.worker]);
  const [job] = SupplierImportWorkerService.jobs;
  assert.equal(typeof SupplierImportWorkerService.prototype[job.method], "function");
});

test("with no import root or no row writer, the worker claims nothing", async () => {
  for (const [label, options] of [["no root (import not deployed)", { root: null }], ["no applyRow until T45", { applyRow: null }]]) {
    const { instance } = worker(options);
    instance.importService = scripted(2);
    assert.deepEqual(await instance.runExecution(), { claimed: false }, label);
    assert.deepEqual(instance.importService.calls, [], label);
  }
});

test("the worker processes rows in order until none are left, then finalizes", async () => {
  const { instance } = worker();
  instance.importService = scripted(2);
  const result = await instance.runExecution(new AbortController().signal);
  assert.deepEqual(instance.importService.calls, ["claim", "row", "row", "row", "finalize"]);
  assert.deepEqual(result, { claimed: true, jobId: 7, applied: 2, failed: 0, status: "completed" });
});

test("abort or shutdown stops the worker between rows and it claims nothing new", async () => {
  const aborting = new AbortController();
  const { instance } = worker();
  instance.importService = scripted(5, { onRow: () => aborting.abort() });
  const stopped = await instance.runExecution(aborting.signal);
  assert.deepEqual(instance.importService.calls, ["claim", "row"], "one row, then it stops; the lease lets another worker resume");
  assert.equal(stopped.status, "running");

  const second = worker();
  second.instance.importService = scripted(5, { onRow: () => { void second.instance.shutdown(); } });
  await second.instance.runExecution(new AbortController().signal);
  assert.deepEqual(second.instance.importService.calls, ["claim", "row"]);
  assert.deepEqual(await second.instance.runExecution(new AbortController().signal), { claimed: false }, "no new claim after shutdown");
});

test("the import root is prepared 0700 and refused when shared, loose or overlapping", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "supplier-import-root-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "supplier");
  await prepareSupplierImportRoot(root);
  for (const directory of [root, path.join(root, "source"), path.join(root, "result")]) {
    assert.equal((await stat(directory)).mode & 0o777, 0o700, directory);
  }

  const loose = path.join(base, "loose");
  await mkdir(loose, { mode: 0o777 });
  await chmod(loose, 0o777);
  await assert.rejects(() => prepareSupplierImportRoot(loose), /must not be writable by group or others/u, "a /tmp-like root");
  await assert.rejects(() => prepareSupplierImportRoot(path.join(base, "other-owner"), [], { uid: process.getuid() + 1 }),
    /owned by the service user/u);

  // 經 symlink 嘅上層目錄：字串唔同，真實路徑一樣 —— 開機檢查睇唔到，呢度要睇到。
  const customer = path.join(base, "customer");
  await mkdir(customer);
  await symlink(base, path.join(base, "alias"));
  await assert.rejects(() => prepareSupplierImportRoot(path.join(base, "alias", "customer", "supplier"), [customer]),
    /overlaps another module's file directory/u, "inside the Customer root through a symlinked parent");
  await assert.rejects(() => prepareSupplierImportRoot(root, [path.join(base, "alias", "supplier")]),
    /overlaps another module's file directory/u, "the same directory under another name");
  assert.ok(await prepareSupplierImportRoot(root, [customer, path.join(base, "not-created-yet")]), "control: disjoint roots pass");

  // 唔分大細階嘅 filesystem（macOS 預設）：換咗大細階都係同一個目錄。分大細階嘅 filesystem 冇呢個問題。
  const upper = path.join(base, "CUSTOMER", "supplier");
  if (await stat(path.join(base, "CUSTOMER")).then(() => true, () => false)) {
    await assert.rejects(() => prepareSupplierImportRoot(upper, [customer]), /overlaps another module's file directory/u, "case variant");
  }
});

test("the worker prepares its root before it registers, and registers even when import is not deployed", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "supplier-import-worker-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const deployed = worker({ root: path.join(base, "imports") });
  await deployed.instance.initialize();
  assert.equal((await stat(path.join(base, "imports", "source"))).mode & 0o777, 0o700);
  assert.equal(deployed.registered.length, 1);

  const undeployed = worker({ root: null });
  await undeployed.instance.initialize();
  assert.equal(undeployed.registered.length, 1);
});
