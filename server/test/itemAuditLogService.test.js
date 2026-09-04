import assert from "node:assert/strict";
import test from "node:test";
import { ItemAuditLogService } from "../src/modules/item/ItemAuditLogService.js";
import { createTestTime } from "../test-support/createTestTime.js";

const NOW_MS = 1_700_000_000_000;

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function fakeConnection() {
  const calls = [];
  return {
    calls,
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
  };
}

function createService({ logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const service = new ItemAuditLogService({ database: {}, logger, time });
  return { service, logger };
}

test("constructor requires database, logger and time", () => {
  assert.throws(() => new ItemAuditLogService({}), TypeError);
  assert.throws(() => new ItemAuditLogService({ database: {} }), TypeError);
});

test("record writes into item_audit_logs, defaulting reason and detail", async () => {
  const { service } = createService();
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: 3,
    actorUsername: "sam",
    action: "category.create",
    targetType: "category",
    targetId: 42,
    targetLabel: "Vitamins"
  });

  assert.equal(connection.calls.length, 1);
  const [{ sql, params }] = connection.calls;
  assert.match(sql, /INSERT INTO item_audit_logs/);
  assert.doesNotMatch(sql, /user_audit_logs/);
  assert.deepEqual(params, [
    NOW_MS,
    3,
    "sam",
    "category.create",
    "category",
    42,
    "Vitamins",
    "",
    null,
    "",
    ""
  ]);
});

test("record writes the caller's requestId and ip instead of the empty-string default", async () => {
  const { service } = createService();
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: 3,
    actorUsername: "sam",
    action: "category.update",
    targetType: "category",
    targetId: 42,
    targetLabel: "Vitamins",
    requestId: "3f6e9a10-abcd-4e12-9f00-1234567890ab",
    ip: "203.0.113.7"
  });

  const [{ params }] = connection.calls;
  assert.equal(params[9], "3f6e9a10-abcd-4e12-9f00-1234567890ab");
  assert.equal(params[10], "203.0.113.7");
});

test("record accepts a null actorUserId and targetId", async () => {
  const { service } = createService();
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: null,
    actorUsername: "deleted-user",
    action: "category.delete",
    targetType: "category",
    targetId: null,
    targetLabel: "Vitamins"
  });

  const [{ params }] = connection.calls;
  assert.equal(params[1], null);
  assert.equal(params[5], null);
});

test("record keeps the reason text verbatim", async () => {
  const { service } = createService();
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: 1,
    actorUsername: "admin",
    action: "category.status",
    targetType: "category",
    targetId: 5,
    targetLabel: "Vitamins",
    reason: "分類已停用不再需要"
  });

  const [{ params }] = connection.calls;
  assert.equal(params[7], "分類已停用不再需要");
});

test("record serializes detail as JSON", async () => {
  const { service } = createService();
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: 1,
    actorUsername: "admin",
    action: "category.update",
    targetType: "category",
    targetId: 5,
    targetLabel: "Vitamins",
    detail: { name: { before: "Vitamin", after: "Vitamins" } }
  });

  const [{ params }] = connection.calls;
  assert.equal(
    params[8],
    JSON.stringify({ name: { before: "Vitamin", after: "Vitamins" } })
  );
});

test("record uses the connection it was given, not the constructor's database", async () => {
  // 這是稽核與變更同一個交易那條規則的斷言：constructor 拿到的 database 從來
  // 沒有被叫過 execute，唯一被寫入的是傳進 record() 的那個連線。
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const untouchedDatabase = {
    execute: async () => {
      throw new Error("record() must not write through the constructor's database");
    }
  };
  const service = new ItemAuditLogService({
    database: untouchedDatabase,
    logger: collectingLogger(),
    time
  });
  const connection = fakeConnection();

  await service.record(connection, {
    actorUserId: 1,
    actorUsername: "admin",
    action: "category.create",
    targetType: "category",
    targetId: 5,
    targetLabel: "Vitamins"
  });

  assert.equal(connection.calls.length, 1);
});

test("record truncates a detail payload larger than 4KB and warns", async () => {
  const { service, logger } = createService();
  const connection = fakeConnection();
  const huge = { blob: "x".repeat(5000) };

  await service.record(connection, {
    actorUserId: 1,
    actorUsername: "admin",
    action: "category.update",
    targetType: "category",
    targetId: 9,
    targetLabel: "Vitamins",
    detail: huge
  });

  const [{ params }] = connection.calls;
  assert.equal(params[8], JSON.stringify({ truncated: true }));

  const warning = logger.entries.find(
    (entry) => entry.event === "item.audit_detail_truncated"
  );
  assert.ok(warning, "expected a warning about the truncated detail");
  assert.equal(warning.context.action, "category.update");
});

test("record keeps a detail payload right at the 4KB boundary untouched", async () => {
  const { service, logger } = createService();
  const connection = fakeConnection();
  // 先算出 {"blob":"..."} 的固定開銷，再補到剛好 4096 bytes——不猜測字面
  // 開銷是幾個字元，讓這個測試在 JSON.stringify 的行為改變時也不會算錯。
  const overhead = Buffer.byteLength(JSON.stringify({ blob: "" }), "utf8");
  const blob = "x".repeat(4096 - overhead);
  const detail = { blob };
  assert.equal(Buffer.byteLength(JSON.stringify(detail), "utf8"), 4096);

  await service.record(connection, {
    actorUserId: 1,
    actorUsername: "admin",
    action: "category.update",
    targetType: "category",
    targetId: 9,
    targetLabel: "Vitamins",
    detail
  });

  const [{ params }] = connection.calls;
  assert.equal(params[8], JSON.stringify(detail));
  assert.equal(
    logger.entries.some((entry) => entry.event === "item.audit_detail_truncated"),
    false
  );
});
