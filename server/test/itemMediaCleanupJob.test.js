import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ItemMediaCleanupJob } from "../src/services/itemMedia/ItemMediaCleanupJob.js";
import { createTestTime } from "../test-support/createTestTime.js";

// ItemMediaCleanupJob 的核心是「掃受控目錄、跟 DB 引用比對」，不是 SQL——所以
// 這裡不用真 MySQL：注入一個假的 database.query()，直接回傳 findStoredNames()
// 分頁查詢預期收到的形狀，讓測試只集中在檔案系統這一半的行為（symlink、grace
// period、orphan 判斷）。HTTP／DB 交易那一半由
// test/integration/itemMedia.integration.test.js 對真 MySQL 驗證。

const NOW_MS = 1_700_000_000_000;
const GRACE_MS = 60_000;

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

function fakeDatabaseWithStoredNames(names) {
  return {
    async query(_sql, [afterId, limit]) {
      const rows = names
        .map((name, index) => ({ id: index + 1, stored_name: name }))
        .filter((row) => row.id > afterId)
        .slice(0, limit);
      return [rows];
    }
  };
}

function createJob({ mediaDirectory, referencedNames = [], nowMs = NOW_MS, graceMs = GRACE_MS }) {
  const time = createTestTime({ clock: () => new Date(nowMs) });
  const { logger, events } = silentLogger();
  const registered = [];
  const scheduler = { register: (instance) => registered.push(instance) };
  const database = fakeDatabaseWithStoredNames(referencedNames);
  const job = new ItemMediaCleanupJob({
    config: {
      item: {
        mediaDirectory,
        mediaOrphanGraceMs: graceMs,
        imageMaxBytes: 5_242_880,
        attachmentMaxBytes: 10_485_760
      }
    },
    services: {
      require: (name) =>
        ({ scheduler, mysqldatabase: database, logging: { logger }, time })[name]
    }
  });

  return { job, events, registered };
}

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "item-media-cleanup-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the job submits itself with cluster scope, since the media volume is shared across instances", async () => {
  const { job, registered } = createJob({ mediaDirectory: "/nonexistent" });

  await job.initialize();

  assert.deepEqual(registered, [job]);

  const [declared] = ItemMediaCleanupJob.jobs;
  assert.equal(declared.name, "itemMedia.cleanupOrphans");
  assert.equal(declared.scope, "cluster");
  assert.equal(typeof job[declared.method], "function");
});

test("the job is discovered by the ordinary service mechanism", async () => {
  const { discoverServiceDefinitions } = await import("../src/framework/services/serviceDiscovery.js");
  const definitions = await discoverServiceDefinitions();
  const found = definitions.find(({ name }) => name === "job.itemMediaCleanup");

  assert.ok(found, "src/services/itemMedia/ 底下的 job 應由既有的 service 自發現載入");
  assert.deepEqual([...found.dependencies], ["scheduler", "mysqldatabase", "logging", "time"]);
});

test("a missing media directory is a clean no-op, not an error", async () => {
  const { job } = createJob({ mediaDirectory: path.join(os.tmpdir(), "item-media-does-not-exist-xyz") });

  const result = await job.cleanupOrphans();

  assert.deepEqual(result, { cleaned: 0, failed: 0, referencedCount: 0 });
});

test("a file still referenced by item_media is kept even though it is old", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "still-referenced.png");
    await writeFile(filePath, "content");
    await utimes(filePath, new Date(0), new Date(0));

    const { job } = createJob({ mediaDirectory: directory, referencedNames: ["still-referenced.png"] });
    const result = await job.cleanupOrphans();

    assert.deepEqual(result, { cleaned: 0, failed: 0, referencedCount: 1 });
    await assert.doesNotReject(writeFile(filePath, "content", { flag: "r+" }));
  });
});

test("an unreferenced file younger than the grace period is kept", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "just-uploaded.png");
    await writeFile(filePath, "content");
    // mtime 落在 NOW_MS 附近，遠未過 GRACE_MS。

    const { job } = createJob({ mediaDirectory: directory });
    const result = await job.cleanupOrphans();

    assert.deepEqual(result, { cleaned: 0, failed: 0, referencedCount: 0 });
    await assert.doesNotReject(writeFile(filePath, "content", { flag: "r+" }));
  });
});

test("an unreferenced file older than the grace period is removed and logged", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "orphan.png");
    await writeFile(filePath, "content");
    await utimes(filePath, new Date(NOW_MS - GRACE_MS * 2), new Date(NOW_MS - GRACE_MS * 2));

    const { job, events } = createJob({ mediaDirectory: directory });
    const result = await job.cleanupOrphans();

    assert.deepEqual(result, { cleaned: 1, failed: 0, referencedCount: 0 });
    await assert.rejects(writeFile(filePath, "content", { flag: "r+" }), { code: "ENOENT" });

    const cleanedEvent = events.find((event) => event.event === "item.media_orphan_cleaned");
    assert.ok(cleanedEvent, "should log a structured event for the removed orphan");
    assert.equal(cleanedEvent.context.fileName, "orphan.png");
  });
});

test("symlinks inside the media root are never followed or removed, even if unreferenced and old", async () => {
  await withTempDirectory(async (directory) => {
    const targetPath = path.join(directory, "real-file.png");
    const linkPath = path.join(directory, "a-symlink.png");
    await writeFile(targetPath, "content");
    await symlink(targetPath, linkPath);
    await utimes(targetPath, new Date(NOW_MS - GRACE_MS * 2), new Date(NOW_MS - GRACE_MS * 2));

    const { job, events } = createJob({ mediaDirectory: directory });
    const result = await job.cleanupOrphans();

    // real-file.png 本身係 orphan 兼過齡，會被清；symlink 本身唔會被跟隨或刪除。
    assert.equal(result.cleaned, 1);
    assert.equal(result.failed, 0);
    assert.ok(
      !events.some((event) => event.context?.fileName === "a-symlink.png"),
      "the symlink itself should never be inspected or removed"
    );
  });
});

test("an unlink failure is logged and counted, not thrown", { skip: process.getuid?.() === 0 }, async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "undeletable.png");
    await writeFile(filePath, "content");
    await utimes(filePath, new Date(NOW_MS - GRACE_MS * 2), new Date(NOW_MS - GRACE_MS * 2));
    await chmod(directory, 0o500);

    try {
      const { job, events } = createJob({ mediaDirectory: directory });
      const result = await job.cleanupOrphans();

      assert.deepEqual(result, { cleaned: 0, failed: 1, referencedCount: 0 });
      const failedEvent = events.find((event) => event.event === "item.media_delete_failed");
      assert.ok(failedEvent, "should log a structured error for the failed unlink");
      assert.equal(failedEvent.context.fileName, "undeletable.png");
    } finally {
      // rm(directory, { recursive: true }) 喺 withTempDirectory 嘅 finally 需要
      // 寫入權限先刪得走裡面嘅檔案。
      await chmod(directory, 0o700);
    }
  });
});
