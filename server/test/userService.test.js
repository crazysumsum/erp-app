import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_FAILURE, UserService } from "../src/module/user/UserService.js";
import { hashPassword } from "../src/module/user/passwordHash.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 登入的每一種錯法都不會有錯誤訊息浮現：鎖定沒生效、失敗次數沒歸零、停用的
// 帳號仍然登得進去——症狀全部都是「登入照常運作」。

const NOW_MS = Date.parse("2026-08-07T06:00:00.000Z");

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };

  return {
    entries,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };
}

/**
 * 只實作這個 service 真正下的那幾句 SQL。updates 記下每一次寫入，讓「失敗次數
 * 有沒有真的被寫回去」測得到。
 */
function fakeDatabase({ user = null, roles = [], permissions = [] } = {}) {
  const state = { updates: [], queries: [] };

  const query = async (sql, parameters = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    state.queries.push({ sql: text, parameters });

    if (text.includes("FROM users")) {
      return [user ? [{ ...user }] : []];
    }

    if (text.includes("FROM roles r")) {
      return [roles.map((name) => ({ name }))];
    }

    if (text.includes("FROM permissions p")) {
      return [permissions.map((name) => ({ name }))];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const execute = async (sql, parameters = []) => {
    state.updates.push({
      sql: sql.replace(/\s+/g, " ").trim(),
      parameters
    });
    return [{ affectedRows: 1 }];
  };

  return { state, query, execute };
}

function createService(database, { logger = collectingLogger() } = {}) {
  // 業務模組不認得 service container，所以測試直接給替身，不需要先架一個容器。
  return new UserService({
    database,
    logger,
    time: createTestTime({ clock: () => new Date(NOW_MS) })
  });
}

async function activeUser(overrides = {}) {
  return {
    id: 7,
    username: "alice",
    password_hash: await hashPassword("right-password"),
    display_name: "Alice",
    status: "active",
    failed_login_attempts: 0,
    locked_until: null,
    ...overrides
  };
}

test("authenticate accepts the right password and returns roles and permissions", async () => {
  const database = fakeDatabase({
    user: await activeUser(),
    roles: ["admin"],
    permissions: ["order.read", "order.write"]
  });
  const service = createService(database);

  const result = await service.authenticate("alice", "right-password");

  assert.equal(result.ok, true);
  assert.deepEqual(result.user, {
    id: 7,
    username: "alice",
    displayName: "Alice",
    roles: ["admin"],
    permissions: ["order.read", "order.write"]
  });
});

test("authenticate clears the failure counter after a successful login", async () => {
  const database = fakeDatabase({
    user: await activeUser({ failed_login_attempts: 3 })
  });
  const service = createService(database);

  await service.authenticate("alice", "right-password");

  // 不歸零的話，一個偶爾打錯密碼的人會在幾天之內累積到門檻，然後被自己鎖在外面。
  const [update] = database.state.updates;
  assert.match(update.sql, /failed_login_attempts = 0/);
  assert.match(update.sql, /locked_until = NULL/);
  assert.deepEqual(update.parameters, [NOW_MS, 7]);
});

test("authenticate rejects the wrong password and counts the attempt", async () => {
  const database = fakeDatabase({ user: await activeUser() });
  const service = createService(database);

  const result = await service.authenticate("alice", "wrong-password");

  assert.equal(result.ok, false);
  assert.equal(result.reason, AUTH_FAILURE.BAD_PASSWORD);
  assert.deepEqual(database.state.updates[0].parameters, [1, null, NOW_MS, 7]);
});

test("authenticate locks the account on the fifth consecutive failure", async () => {
  const logger = collectingLogger();
  const database = fakeDatabase({
    user: await activeUser({ failed_login_attempts: 4 })
  });
  const service = createService(database, { logger });

  await service.authenticate("alice", "wrong-password");

  const [attempts, lockedUntil] = database.state.updates[0].parameters;
  assert.equal(attempts, 5);
  assert.equal(lockedUntil, NOW_MS + 15 * 60 * 1000);
  assert.ok(logger.entries.some((entry) => entry.event === "auth.login.locked"));
});

test("authenticate rejects a locked account even with the right password", async () => {
  const database = fakeDatabase({
    user: await activeUser({
      failed_login_attempts: 5,
      locked_until: NOW_MS + 60_000
    })
  });
  const service = createService(database);

  const result = await service.authenticate("alice", "right-password");

  assert.equal(result.ok, false);
  assert.equal(result.reason, AUTH_FAILURE.LOCKED);
});

test("authenticate accepts the right password once the lock has expired", async () => {
  const database = fakeDatabase({
    user: await activeUser({
      failed_login_attempts: 5,
      locked_until: NOW_MS - 1
    })
  });
  const service = createService(database);

  // 鎖定會自己到期：需要人工解鎖的話，一次密碼輸入錯誤就變成一張工單。
  const result = await service.authenticate("alice", "right-password");

  assert.equal(result.ok, true);
});

test("authenticate rejects a disabled account", async () => {
  const database = fakeDatabase({
    user: await activeUser({ status: "disabled" })
  });
  const service = createService(database);

  const result = await service.authenticate("alice", "right-password");

  assert.equal(result.ok, false);
  assert.equal(result.reason, AUTH_FAILURE.DISABLED);
});

test("authenticate rejects an unknown user", async () => {
  const database = fakeDatabase({ user: null });
  const service = createService(database);

  const result = await service.authenticate("nobody", "any-password");

  assert.equal(result.ok, false);
  assert.equal(result.reason, AUTH_FAILURE.UNKNOWN_USER);
  assert.deepEqual(database.state.updates, []);
});

test("authenticate spends the same work on an unknown user as on a wrong password", async () => {
  const knownDatabase = fakeDatabase({ user: await activeUser() });
  const unknownDatabase = fakeDatabase({ user: null });

  const knownStart = process.hrtime.bigint();
  await createService(knownDatabase).authenticate("alice", "wrong-password");
  const knownNs = Number(process.hrtime.bigint() - knownStart);

  const unknownStart = process.hrtime.bigint();
  await createService(unknownDatabase).authenticate("nobody", "wrong-password");
  const unknownNs = Number(process.hrtime.bigint() - unknownStart);

  // 沒有這個補償，「使用者不存在」會快兩個數量級，回應時間本身就是一個帳號
  // 存在與否的探測器。門檻放得很鬆：這裡要抓的是「補償整個不見了」，不是量
  // 測抖動。
  const ratio = unknownNs / knownNs;
  assert.ok(
    ratio > 0.25,
    `unknown-user path was ${(1 / ratio).toFixed(1)}x faster than the wrong-password path`
  );
});

test("findActiveById returns the user with roles and permissions", async () => {
  const database = fakeDatabase({
    user: await activeUser(),
    roles: ["staff"],
    permissions: ["order.read"]
  });
  const service = createService(database);

  const user = await service.findActiveById(7);

  assert.deepEqual(user, {
    id: 7,
    username: "alice",
    displayName: "Alice",
    roles: ["staff"],
    permissions: ["order.read"]
  });
});

test("findActiveById returns null when the user is gone or disabled", async () => {
  const service = createService(fakeDatabase({ user: null }));

  assert.equal(await service.findActiveById(7), null);
});

test("findActiveById only matches active users", async () => {
  const database = fakeDatabase({ user: await activeUser() });
  const service = createService(database);

  await service.findActiveById(7);

  // 停用的過濾必須在 SQL 裡：把它留給呼叫端，遲早會有一個呼叫端忘記。
  assert.match(database.state.queries[0].sql, /status = 'active'/);
});
