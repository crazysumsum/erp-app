import assert from "node:assert/strict";
import test from "node:test";
import { chmod, link, lstat, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SupplierImportWorkerService } from "../src/services/supplierImport/SupplierImportWorkerService.js";
import {
  prepareSupplierImportRoot, SUPPLIER_IMPORT_JOB_NAMES, writeSupplierImportSource
} from "../src/services/supplierImport/supplierImportFiles.js";
import { SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";

/**
 * TASK-042：worker 嘅生命週期（領取、逐列、停低）同 import root 嘅準備。資料庫嘅部分喺
 * test/integration/supplierImportExecution.integration.test.js。
 */
function worker({ root = "/srv/imports", applyRow = async () => 1, logger = { info() {} }, businessMaster } = {}) {
  const registered = [];
  const services = {
    require(name) {
      if (name === "scheduler") return { register: (instance) => registered.push(instance) };
      if (name === "logging") return { logger };
      if (name === "time") return { nowMs: () => 1 };
      if (name === "mysqldatabase") return { async query() { return [[]]; } };
      return {};
    }
  };
  const instance = new SupplierImportWorkerService({
    config: { supplier: { import: { root, maxFileBytes: 1_000_000, maxRows: 100 } } }, services, options: { applyRow, businessMaster }
  });
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

test("the worker hands its logger to the import service, so row failures reach the system log", () => {
  const logger = { info() {}, error() {} };
  const services = { require: (name) => (name === "logging" ? { logger } : name === "time" ? { nowMs: () => 1 } : { register() {} }) };
  const instance = new SupplierImportWorkerService({ config: { supplier: { import: { root: null } } }, services });
  assert.equal(instance.importService.logger, logger);
});

test("the worker's scheduled jobs carry the names T41 reserved for them", () => {
  assert.deepEqual(SupplierImportWorkerService.jobs.map((job) => job.name),
    [SUPPLIER_IMPORT_JOB_NAMES.precheck, SUPPLIER_IMPORT_JOB_NAMES.worker]);
  for (const job of SupplierImportWorkerService.jobs) {
    assert.equal(typeof SupplierImportWorkerService.prototype[job.method], "function", job.name);
  }
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
  const baseReal = await realpath(base);   // root 之後一律按真實路徑檢查（REV-063 L-10）
  const root = path.join(base, "supplier");
  await prepareSupplierImportRoot(root);
  for (const directory of [root, path.join(root, "source"), path.join(root, "result")]) {
    assert.equal((await stat(directory)).mode & 0o777, 0o700, directory);
  }

  const loose = path.join(base, "loose");
  await mkdir(loose, { mode: 0o777 });
  await chmod(loose, 0o777);
  await assert.rejects(() => prepareSupplierImportRoot(loose), /must not be writable by group or others/u, "a /tmp-like root");
  // 擁有者、filesystem 同 dev/ino 要真機先整得出，所以注入 lstat：只改被測嗰一個 path 嘅答案。
  const reporting = (target, patch) => async (candidate) => {
    const info = await lstat(candidate);
    return candidate === target ? Object.assign(Object.create(info), patch(info)) : info;
  };
  const owned = path.join(base, "owned");
  await assert.rejects(() => prepareSupplierImportRoot(owned, [], { lstat: reporting(path.join(baseReal, "owned"), (i) => ({ uid: i.uid + 1 })) }),
    /root must be owned by the service user/u);
  await assert.rejects(() => prepareSupplierImportRoot(owned, [],
    { lstat: reporting(path.join(baseReal, "owned", "source"), (i) => ({ uid: i.uid + 1 })) }),
  /owned by the service user/u, "a kind directory owned by someone else");
  await assert.rejects(() => prepareSupplierImportRoot(owned, [],
    { lstat: reporting(path.join(baseReal, "owned", "result"), (i) => ({ dev: i.dev + 1 })) }),
  /on the root's filesystem/u, "a kind directory mounted from another filesystem");
  const bound = path.join(base, "bound");
  await mkdir(bound);
  const ownedInfo = await lstat(owned);
  const boundReal = await realpath(bound);   // 比較用真實路徑：macOS 嘅 /var 其實係 /private/var
  await assert.rejects(() => prepareSupplierImportRoot(owned, [bound],
    { lstat: reporting(boundReal, () => ({ dev: ownedInfo.dev, ino: ownedInfo.ino })) }),
  /overlaps another module's file directory/u, "the same directory under another path (a bind mount)");

  // 已經存在而且太鬆嘅 root 同 kind 目錄會收緊到 0700，唔係照舊保留。
  const existing = path.join(base, "existing");
  await mkdir(path.join(existing, "source"), { recursive: true });
  await chmod(existing, 0o750);
  await chmod(path.join(existing, "source"), 0o770);
  await prepareSupplierImportRoot(existing);
  assert.equal((await stat(existing)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(existing, "source"))).mode & 0o777, 0o700);

  // 上層目錄人人寫得入又冇 sticky bit：其他 user 可以將 root 換走（REV-061 L-4）。
  const shared = path.join(base, "shared");
  await mkdir(shared);
  await chmod(shared, 0o777);
  const replaceable = /ancestor .* must not be replaceable by other users/u;
  await assert.rejects(() => prepareSupplierImportRoot(path.join(shared, "imports")), replaceable, "a 0777 parent");
  await assert.rejects(() => prepareSupplierImportRoot(path.join(shared, "deeper", "imports")), replaceable, "a 0777 grandparent");
  await symlink(shared, path.join(base, "linked-shared"));
  await assert.rejects(() => prepareSupplierImportRoot(path.join(base, "linked-shared", "via-link")), replaceable,
    "a symlinked parent is judged by the directory it points at (REV-062 L-7)");
  await chmod(shared, 0o770);
  await assert.rejects(() => prepareSupplierImportRoot(path.join(shared, "imports")), replaceable, "a group-writable parent");
  await chmod(shared, 0o1777);
  assert.ok(await prepareSupplierImportRoot(path.join(shared, "imports")), "control: a sticky shared parent such as /tmp is fine");
  const foreignParent = path.join(base, "foreign-parent");
  await mkdir(foreignParent);
  const foreignReal = await realpath(foreignParent);
  await assert.rejects(() => prepareSupplierImportRoot(path.join(foreignParent, "imports"), [],
    { lstat: reporting(foreignReal, (i) => ({ uid: i.uid + 1 })) }), replaceable,
  "a parent owned by another user");

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
  await mkdir(path.join(base, "real"));
  await symlink(path.join(base, "real"), path.join(base, "alias"));
  const deployed = worker({ root: path.join(base, "alias", "imports") });
  await deployed.instance.initialize();
  assert.equal((await stat(path.join(base, "real", "imports", "source"))).mode & 0o777, 0o700);
  assert.equal(deployed.instance.root, await realpath(path.join(base, "real", "imports")),
    "the worker keeps the real path, so swapping the symlink later cannot redirect it (REV-063 L-10)");
  assert.equal(deployed.registered.length, 1);

  assert.equal(deployed.instance.preparedRoot, deployed.instance.root, "upload writes only under the prepared real root");

  const warnings = [];
  const undeployed = worker({ root: null, logger: { info() {}, warn: (event) => warnings.push(event) } });
  assert.equal(undeployed.instance.preparedRoot, null);
  await undeployed.instance.initialize();
  assert.equal(undeployed.registered.length, 1);
  assert.equal(undeployed.instance.preparedRoot, null, "no root: upload answers 503 (HD-050)");
  assert.deepEqual(warnings, ["supplier.import.disabled"], "and startup says so instead of refusing to start");
});

/** Precheck 嘅 import service 替身：記低 worker 叫咗乜同交咗咩。 */
function precheckScript(job) {
  const calls = [];
  return {
    calls,
    async claimForPrecheck() { calls.push(["claim"]); return job; },
    async appendPrecheckRows({ rows }) { calls.push(["append", rows.map((row) => [row.rowNumber, row.status])]); },
    async completePrecheck({ jobLevelError }) {
      calls.push(["complete", jobLevelError]);
      return { status: jobLevelError ? "failed" : "ready", lastErrorCode: jobLevelError?.code ?? "", totalCount: 1 };
    }
  };
}

const readyCatalog = () => ({
  async assertReady() {},
  async listCurrencies({ page }) { return page === 1 ? [{ code: "HKD" }] : []; },
  async listPaymentTerms() { return []; }
});

async function preparedWorker(t, options = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "supplier-import-precheck-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const built = worker({ root: path.join(base, "imports"), businessMaster: readyCatalog(), ...options });
  await built.instance.initialize();
  return { ...built, base };
}

const oneRowCsv = () => Buffer.from(`${SUPPLIER_IMPORT_COLUMN_NAMES.join(",")}\r\n${SUPPLIER_IMPORT_COLUMN_NAMES
  .map((name) => ({ supplierCode: "SUP-1", supplierName: "Acme", defaultCurrencyCode: "HKD" })[name] ?? "").join(",")}\r\n`);

test("precheck reads the stored source, writes its rows and completes the job", async (t) => {
  const { instance } = await preparedWorker(t);
  const stored = await writeSupplierImportSource(instance.root, oneRowCsv());
  instance.importService = precheckScript({ id: 9, mode: "create_only", sourceStoredName: stored.storedName, sourceSha256: stored.sha256 });
  assert.deepEqual(await instance.runPrecheck(new AbortController().signal), { claimed: true, jobId: 9, status: "ready" });
  assert.deepEqual(instance.importService.calls, [["claim"], ["append", [[1, "valid"]]], ["complete", null]]);
});

test("a missing, altered, hard-linked or symlinked source fails the job instead of being read", async (t) => {
  const { instance, base } = await preparedWorker(t);
  const outside = path.join(base, "outside.csv");
  await writeFile(outside, oneRowCsv());
  const cases = {
    missing: async () => ({ storedName: "a".repeat(64), sha256: Buffer.alloc(32) }),
    altered: async () => ({ ...(await writeSupplierImportSource(instance.root, oneRowCsv())), sha256: Buffer.alloc(32) }),
    "hard link to a file outside the root": async () => {
      const storedName = "b".repeat(64);
      await link(outside, path.join(instance.root, "source", storedName));
      return { storedName, sha256: (await writeSupplierImportSource(instance.root, oneRowCsv())).sha256 };
    },
    symlink: async () => {
      // 另一個檔：上面嗰個 hard link 令 outside 嘅 nlink 變 2，會喺 O_NOFOLLOW 之前就被 nlink 擋住。
      const target = path.join(base, "outside-for-symlink.csv");
      await writeFile(target, oneRowCsv());
      const storedName = "c".repeat(64);
      await symlink(target, path.join(instance.root, "source", storedName));
      return { storedName, sha256: (await writeSupplierImportSource(instance.root, oneRowCsv())).sha256 };
    }
  };
  for (const [label, make] of Object.entries(cases)) {
    const source = await make();
    instance.importService = precheckScript({ id: 3, mode: "create_only", sourceStoredName: source.storedName, sourceSha256: source.sha256 });
    await instance.runPrecheck(new AbortController().signal);
    assert.deepEqual(instance.importService.calls.at(-1),
      ["complete", { code: "SUPPLIER_IMPORT_SOURCE_UNAVAILABLE", message: "匯入來源檔案無法讀取，請重新上載" }], label);
    assert.equal(instance.importService.calls.some(([call]) => call === "append"), false, label);
  }
});

test("precheck that cannot finish for another reason keeps the lease for a retry and does not fail the job", async (t) => {
  const errors = [];
  const { instance } = await preparedWorker(t, {
    logger: { info() {}, error: (event, _message, context) => errors.push([event, context.code]) },
    businessMaster: { ...readyCatalog(), async assertReady() { throw Object.assign(new Error("not ready"), { code: "BUSINESS_MASTER_NOT_READY" }); } }
  });
  const stored = await writeSupplierImportSource(instance.root, oneRowCsv());
  instance.importService = precheckScript({ id: 4, mode: "create_only", sourceStoredName: stored.storedName, sourceSha256: stored.sha256 });
  await assert.rejects(() => instance.runPrecheck(new AbortController().signal), (error) =>
    error.code === "BUSINESS_MASTER_NOT_READY" && !error.message.includes("not ready"),
  "the scheduler gets the code only, never the original message (REV-064 H-1)");
  assert.deepEqual(instance.importService.calls, [["claim"]]);
  assert.deepEqual(errors, [["supplier.import.precheck_interrupted", "BUSINESS_MASTER_NOT_READY"]]);
});

test("a directory or an oversized file at the stored name fails the job instead of being retried", async (t) => {
  const { instance } = await preparedWorker(t);
  const directory = "d".repeat(64);
  await mkdir(path.join(instance.root, "source", directory));
  instance.importService = precheckScript({ id: 11, mode: "create_only", sourceStoredName: directory, sourceSha256: Buffer.alloc(32) });
  await instance.runPrecheck(new AbortController().signal);
  assert.deepEqual(instance.importService.calls.at(-1),
    ["complete", { code: "SUPPLIER_IMPORT_SOURCE_UNAVAILABLE", message: "匯入來源檔案無法讀取，請重新上載" }]);

  // 上載之後上限調低咗：讀嗰陣就拒絕，唔會讀晒入記憶體。
  const stored = await writeSupplierImportSource(instance.root, Buffer.alloc(2_000, 0x41));
  instance.limits.maxFileBytes = 1_000;
  instance.importService = precheckScript({ id: 12, mode: "create_only", sourceStoredName: stored.storedName, sourceSha256: stored.sha256 });
  await instance.runPrecheck(new AbortController().signal);
  assert.deepEqual(instance.importService.calls.at(-1), ["complete", { code: "SUPPLIER_IMPORT_FILE_TOO_LARGE", message: "CSV 檔案超過大小上限" }]);
});

test("every page of the Business Master catalogue is read, not just the first hundred", async (t) => {
  const currencies = Array.from({ length: 100 }, (_, index) => ({ code: `C${String(index).padStart(2, "0")}` }));
  const { instance } = await preparedWorker(t, { businessMaster: {
    async assertReady() {},
    async listCurrencies({ page }) { return page === 1 ? currencies : page === 2 ? [{ code: "HKD" }] : []; },
    async listPaymentTerms() { return []; }
  } });
  const stored = await writeSupplierImportSource(instance.root, oneRowCsv());
  instance.importService = precheckScript({ id: 13, mode: "create_only", sourceStoredName: stored.storedName, sourceSha256: stored.sha256 });
  await instance.runPrecheck(new AbortController().signal);
  assert.deepEqual(instance.importService.calls[1], ["append", [[1, "valid"]]], "HKD is on the second page");
});

test("shutdown during a precheck stops before the next batch is written and leaves the job to the lease", async (t) => {
  const { instance } = await preparedWorker(t);
  const stored = await writeSupplierImportSource(instance.root, oneRowCsv());
  instance.importService = precheckScript({ id: 6, mode: "create_only", sourceStoredName: stored.storedName, sourceSha256: stored.sha256 });
  const claim = instance.importService.claimForPrecheck;
  instance.importService.claimForPrecheck = async (input) => { const job = await claim(input); await instance.shutdown(); return job; };
  await assert.rejects(() => instance.runPrecheck(new AbortController().signal), { code: "SUPPLIER_IMPORT_STOPPING" });
  assert.deepEqual(instance.importService.calls, [["claim"]], "nothing appended, nothing completed");
});

test("precheck claims nothing without a root, after shutdown or when aborted", async (t) => {
  const none = worker({ root: null });
  none.instance.importService = precheckScript(null);
  assert.deepEqual(await none.instance.runPrecheck(), { claimed: false });
  const { instance } = await preparedWorker(t);
  instance.importService = precheckScript(null);
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await instance.runPrecheck(aborted.signal), { claimed: false });
  await instance.shutdown();
  assert.deepEqual(await instance.runPrecheck(new AbortController().signal), { claimed: false });
  assert.deepEqual(none.instance.importService.calls.concat(instance.importService.calls), []);
});
