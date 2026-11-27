import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_FAILURE, UserService } from "../src/modules/user/UserService.js";
import { hashPassword } from "../src/modules/user/passwordHash.js";
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
 * 只實作這個 service 真正下的那幾句 SQL。updates 記下每一次寫入。
 *
 * user 是可變狀態而不是靜態快照：#recordFailedAttempt 現在是兩句獨立的
 * UPDATE——先原子遞增，再用一句以 `failed_login_attempts >= ?` 為條件的 UPDATE
 * 決定要不要鎖定，靠 affectedRows 判斷條件有沒有命中。假資料庫必須真的套用
 * 第一句對 state.user 的影響，第二句的條件判斷才測得出「鎖定邏輯本身對不對」，
 * 不會只測到「SQL 有沒有被呼叫」。
 */
function fakeDatabase({ user = null, roles = [], permissions = [] } = {}) {
  const state = { updates: [], queries: [], user: user ? { ...user } : null };

  const query = async (sql, parameters = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    state.queries.push({ sql: text, parameters });

    if (text.includes("FROM users")) {
      return [state.user ? [{ ...state.user }] : []];
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
    const text = sql.replace(/\s+/g, " ").trim();
    state.updates.push({ sql: text, parameters });

    if (text.includes("failed_login_attempts = failed_login_attempts + 1")) {
      state.user.failed_login_attempts += 1;
      return [{ affectedRows: 1 }];
    }

    if (text.includes("SET locked_until = ?") && text.includes("failed_login_attempts >=")) {
      const [lockedUntil, , maxAttempts] = parameters;

      if (state.user.failed_login_attempts >= maxAttempts) {
        state.user.locked_until = lockedUntil;
        return [{ affectedRows: 1 }];
      }

      return [{ affectedRows: 0 }];
    }

    if (text.includes("failed_login_attempts = 0")) {
      state.user.failed_login_attempts = 0;
      state.user.locked_until = null;
    }

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

test("S-03 starts a fresh attempt count after lock expiry", async () => {
  const database = fakeDatabase({ user: await activeUser({ failed_login_attempts: 5, locked_until: NOW_MS - 1 }) });
  const result = await createService(database).authenticate("alice", "wrong-password");
  assert.equal(result.reason, AUTH_FAILURE.BAD_PASSWORD);
  assert.equal(database.state.user.failed_login_attempts, 1);
  assert.equal(database.state.user.locked_until, null);
});
