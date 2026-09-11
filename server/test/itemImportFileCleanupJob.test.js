import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ItemImportFileCleanupJob } from "../src/services/itemImport/ItemImportFileCleanupJob.js";
import { createTestTime } from "../test-support/createTestTime.js";

// ItemImportFileCleanupJob 嘅核心係「掃 retention 候選 job、跟受控目錄比對、
// 刪檔」，唔係 SQL——所以呢度唔用真 MySQL：注入一個假嘅
// ItemImportService-shaped object，直接控制 listRetentionCandidateJobs()／
// markImportFilesPurged() 嘅回傳值，等測試專注喺檔案系統呢一半嘅行為
// （UTC 週年計算、symlink、部分刪除失敗、compare-and-set 撞期）。SQL 嗰一半
// 由 test/integration/itemImportFileCleanup.integration.test.js 對真 MySQL 驗。

const NOW_MS = Date.UTC(2026, 5, 1); // 2026-06-01T00:00:00Z
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function silentLogger() {
  const events = [];
  const record = (level) => (event, message, context) => {
    events.push({ level, event, message, context });
    return Promise.resolve();
  };
  return {
    logger: { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") },
    events
  };
}

function fakeImportService({ candidates = [], markResult = true } = {}) {
  const purgedCalls = [];
  return {
    async listRetentionCandidateJobs() {
      return candidates;
    },
    async markImportFilesPurged({ jobId, purgedAtMs }) {
      purgedCalls.push({ jobId, purgedAtMs });
      return typeof markResult === "function" ? markResult(jobId) : markResult;
    },
    purgedCalls
  };
}

function createJob({ importDirectory, nowMs = NOW_MS, importService }) {
  const time = createTestTime({ clock: () => new Date(nowMs) });
  const { logger, events } = silentLogger();
  const registered = [];
  const scheduler = { register: (instance) => registered.push(instance) };
  const job = new ItemImportFileCleanupJob({
    config: { item: { importDirectory } },
    services: {
      require: (name) => ({ scheduler, mysqldatabase: {}, logging: { logger }, time })[name]
    }
  });
  // ItemImportService 由 constructor 內部 new 出嚟，用假嘅頂替番。
  job.importService = importService;
  return { job, events, registered };
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "item-import-cleanup-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the job submits itself with cluster scope, since the import volume is shared across instances", async () => {
  const { job, registered } = createJob({ importDirectory: "/nonexistent", importService: fakeImportService() });

  await job.initialize();

  assert.deepEqual(registered, [job]);

  const [declared] = ItemImportFileCleanupJob.jobs;
  assert.equal(declared.name, "itemImport.fileCleanup");
  assert.equal(declared.scope, "cluster");
  assert.equal(typeof job[declared.method], "function");
});

test("the job is discovered by the ordinary service mechanism", async () => {
  const { discoverServiceDefinitions } = await import("../src/framework/services/serviceDiscovery.js");
  const definitions = await discoverServiceDefinitions();
  const found = definitions.find(({ name }) => name === "job.itemImportFileCleanup");

  assert.ok(found, "src/services/itemImport/ 底下的 job 應由既有的 service 自發現載入");
  assert.deepEqual([...found.dependencies], ["scheduler", "mysqldatabase", "logging", "time"]);
});

test("no candidates: 清一次乜都冇做", async () => {
  const { job } = createJob({ importDirectory: "/nonexistent", importService: fakeImportService({ candidates: [] }) });

  const result = await job.cleanup();

  assert.deepEqual(result, { purged: 0, notYetDue: 0, failed: 0, racedAway: 0, candidateCount: 0 });
});

test("未過 1 年保留期嘅 job 唔會被刪", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "not-due.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS / 2;

    const importService = fakeImportService({
      candidates: [{ id: 1, fileStoredName, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.deepEqual(result, { purged: 0, notYetDue: 1, failed: 0, racedAway: 0, candidateCount: 1 });
    assert.equal(importService.purgedCalls.length, 0);
    await assert.doesNotReject(writeFile(path.join(directory, fileStoredName), "content", { flag: "r+" }));
  });
});

test("啱好過咗 UTC 週年日：原始檔＋結果檔都刪，並標記 files_purged_at", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "due-source.csv";
    const resultStoredName = "due-result.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    await writeFile(path.join(directory, resultStoredName), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 7, fileStoredName, resultStoredName, status: "completed", completedAt, updatedAt: completedAt }]
    });
    const { job, events } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.deepEqual(result, { purged: 1, notYetDue: 0, failed: 0, racedAway: 0, candidateCount: 1 });
    assert.deepEqual(importService.purgedCalls, [{ jobId: 7, purgedAtMs: NOW_MS }]);
    await assert.rejects(writeFile(path.join(directory, fileStoredName), "content", { flag: "r+" }), { code: "ENOENT" });
    await assert.rejects(writeFile(path.join(directory, resultStoredName), "content", { flag: "r+" }), { code: "ENOENT" });

    const purgedEvent = events.find((event) => event.event === "item.import_files_purged");
    assert.ok(purgedEvent);
    assert.equal(purgedEvent.context.jobId, 7);
    assert.equal(purgedEvent.context.fileCount, 2);
  });
});

test("resultStoredName 係 NULL：只刪原始檔一個", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "only-source.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 3, fileStoredName, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.equal(result.purged, 1);
    await assert.rejects(writeFile(path.join(directory, fileStoredName), "content", { flag: "r+" }), { code: "ENOENT" });
  });
});

test("completedAt 係 null：跌返用 updatedAt 計到期日", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "no-completed-at.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    const updatedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 9, fileStoredName, resultStoredName: null, status: "invalid", completedAt: null, updatedAt }]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.equal(result.purged, 1);
  });
});

test("symlink 唔會被跟隨或刪除，計做刪除失敗，唔標記 files_purged_at", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "real-target.csv");
    const linkName = "a-symlink.csv";
    await writeFile(targetPath, "content");
    await symlink(targetPath, path.join(directory, linkName));
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 5, fileStoredName: linkName, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }]
    });
    const { job, events } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.deepEqual(result, { purged: 0, notYetDue: 0, failed: 1, racedAway: 0, candidateCount: 1 });
    assert.equal(importService.purgedCalls.length, 0, "任何一個檔刪唔到都唔可以標記 files_purged_at");
    assert.ok(events.some((event) => event.event === "item.import_file_purge_failed"));
    // symlink 本身冇被跟隨刪走，目標檔亦冇被跟蹤刪走。
    await assert.doesNotReject(writeFile(targetPath, "content", { flag: "r+" }));
  });
});

test("其中一個檔案刪唔到：files_purged_at 唔會被標記，容許安全重跑", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "deletable.csv";
    const resultStoredName = "undeletable.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    await writeFile(path.join(directory, resultStoredName), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 11, fileStoredName, resultStoredName, status: "failed", completedAt, updatedAt: completedAt }]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    await chmod(directory, 0o500);
    try {
      if (process.getuid?.() === 0) {
        return;
      }
      const result = await job.cleanup();

      assert.equal(result.failed, 1);
      assert.equal(result.purged, 0);
      assert.equal(importService.purgedCalls.length, 0);
    } finally {
      await chmod(directory, 0o700);
    }
  });
});

test("markImportFilesPurged 回 false（另一個 instance 已經搶先標記）：計做 racedAway，唔算失敗", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "raced.csv";
    await writeFile(path.join(directory, fileStoredName), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 13, fileStoredName, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }],
      markResult: false
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.deepEqual(result, { purged: 0, notYetDue: 0, failed: 0, racedAway: 1, candidateCount: 1 });
    // 檔案本身已經被呢一輪刪走（unlink 對已經唔存在嘅檔案係安全 no-op，下一輪重跑唔會再出錯）。
    await assert.rejects(writeFile(path.join(directory, fileStoredName), "content", { flag: "r+" }), { code: "ENOENT" });
  });
});

test("重跑一次（檔案已經唔存在）：unlink 視為成功，唔會拋錯", async () => {
  await withTempDirectory(async (directory) => {
    const fileStoredName = "already-gone.csv";
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [{ id: 17, fileStoredName, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const result = await job.cleanup();

    assert.deepEqual(result, { purged: 1, notYetDue: 0, failed: 0, racedAway: 0, candidateCount: 1 });
  });
});

test("路徑逃出受控 import root：拒絕刪除，計做失敗", async () => {
  await withTempDirectory(async (directory) => {
    const outsideFile = path.join(os.tmpdir(), `item-import-outside-${Date.now()}.csv`);
    await writeFile(outsideFile, "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    try {
      const importService = fakeImportService({
        candidates: [
          {
            id: 21,
            fileStoredName: `../${path.basename(outsideFile)}`,
            resultStoredName: null,
            status: "completed",
            completedAt,
            updatedAt: completedAt
          }
        ]
      });
      const { job, events } = createJob({ importDirectory: directory, importService });

      const result = await job.cleanup();

      assert.equal(result.failed, 1);
      assert.equal(importService.purgedCalls.length, 0);
      assert.ok(events.some((event) => event.event === "item.import_file_purge_failed"));
      await assert.doesNotReject(writeFile(outsideFile, "content", { flag: "r+" }), "受控 root 之外嘅檔案完全唔應該被觸碰");
    } finally {
      await rm(outsideFile, { force: true });
    }
  });
});

test("signal 已經 aborted：中途停低，唔再處理之後嘅 candidate", async () => {
  await withTempDirectory(async (directory) => {
    const fileA = "a.csv";
    const fileB = "b.csv";
    await writeFile(path.join(directory, fileA), "content");
    await writeFile(path.join(directory, fileB), "content");
    const completedAt = NOW_MS - ONE_YEAR_MS - 1000;

    const importService = fakeImportService({
      candidates: [
        { id: 1, fileStoredName: fileA, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt },
        { id: 2, fileStoredName: fileB, resultStoredName: null, status: "completed", completedAt, updatedAt: completedAt }
      ]
    });
    const { job } = createJob({ importDirectory: directory, importService });

    const controller = new AbortController();
    controller.abort();

    const result = await job.cleanup(controller.signal);

    assert.equal(result.purged, 0);
    assert.equal(importService.purgedCalls.length, 0);
  });
});
