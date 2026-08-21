import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationError } from "../src/framework/auth/AuthenticationError.js";
import { JwtAuthStrategy } from "../src/services/auth/jwtAuthStrategy.js";
import { JwtService } from "../src/services/auth/JwtService.js";

// 絕對 session 上限：一條 session 從登入那一刻起最多能活多久，不管中間續期過
// 幾次。這是唯一一個「不需要任何人介入、session 也一定會結束」的機制，而它壞掉
// 的方式完全沒有症狀——沒有錯誤、沒有失敗的請求，只是本來該被登出的人一直
// 留在系統裡。
//
// 這裡用真的 JwtService 加真的 JwtAuthStrategy，只有時鐘是假的：要驗的正是
// 「簽發時寫進去的 auth_time」與「八小時後的現在」之間的關係，把任何一端換成
// 替身，這條關係就測不到了。

const SECOND = 1000;
const HOUR = 3600 * SECOND;
const LOGIN_AT = Date.parse("2026-08-07T06:00:00.000Z");

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

function createJwtService(sessionMaxAge = "8h") {
  return new JwtService({
    config: {
      jwt: {
        secret: "test-only-jwt-secret-with-at-least-32-characters",
        issuer: "erp-api",
        audience: "erp-client",
        algorithm: "HS256",
        // token 本身的壽命放得很長，這樣測試裡過期的一定是 session 而不是
        // token——兩者是不同的機制，混在一起就分不出是哪一個把人踢出去。
        expiresIn: "1w",
        sessionMaxAge,
        clockToleranceSeconds: 5,
        headerName: "Authorization",
        authScheme: "Bearer"
      }
    }
  });
}

/**
 * 一個可以往前撥的時鐘，加上一支照著它跑的 JwtAuthStrategy。
 */
function createHarness({ sessionMaxAge = "8h", snapshotUsable = true, revoked = false } = {}) {
  const clock = { nowMs: LOGIN_AT };
  const logger = collectingLogger();
  const jwt = createJwtService(sessionMaxAge);
  const available = {
    jwt,
    tokenRevocation: {
      isRevoked: () => revoked,
      snapshotUsable: () => snapshotUsable,
      snapshotAgeSeconds: () => 0
    },
    time: { nowMs: () => clock.nowMs },
    logging: { logger, loggers: {} }
  };

  const strategy = new JwtAuthStrategy({
    config: {},
    services: {
      get: (name) => available[name],
      require: (name) => {
        if (!(name in available)) {
          throw new Error(`Unexpected test service: ${name}`);
        }
        return available[name];
      }
    }
  });

  return {
    strategy,
    jwt,
    logger,
    clock,
    advance(ms) {
      clock.nowMs += ms;
    },
    /** 模擬一次登入：起算點就是此刻。 */
    login() {
      return jwt.issue(
        { roles: ["staff"] },
        { subject: "7", version: 0, authTime: Math.floor(clock.nowMs / 1000) }
      );
    },
    /** 模擬一次續期：原封不動沿用舊 token 的起算點。 */
    refresh(token) {
      const claims = jwt.verify(token);
      return jwt.issue(
        { roles: ["staff"] },
        { subject: "7", version: 0, authTime: claims.auth_time }
      );
    },
    request(token) {
      return {
        requestId: "req-1",
        get: (name) =>
          String(name).toLowerCase() === "authorization" ? `Bearer ${token}` : undefined
      };
    }
  };
}

test("a session inside the cap is accepted", async () => {
  const harness = createHarness();
  const token = harness.login();

  harness.advance(7 * HOUR);

  const result = await harness.strategy.authenticate(harness.request(token));
  assert.equal(result.type, "jwt");
  assert.equal(result.claims.sub, "7");
});

test("the boundary is exact: at the cap still works, one second past it does not", async () => {
  const harness = createHarness();
  const token = harness.login();

  // 剛好八小時：還沒「超過」，所以仍然可用。把比較寫成 >= 的話，會少給
  // 使用者一整秒，而且沒有人會發現寫錯了邊。
  harness.advance(8 * HOUR);
  await harness.strategy.authenticate(harness.request(token));

  harness.advance(1 * SECOND);
  await assert.rejects(
    () => harness.strategy.authenticate(harness.request(token)),
    (error) => {
      assert.ok(error instanceof AuthenticationError);
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "SESSION_EXPIRED");
      return true;
    }
  );
});

test("refreshing does not extend the cap: the session dies at the same wall-clock moment", async () => {
  const harness = createHarness();
  let token = harness.login();

  // 背景續期每 15 分鐘跑一次，八小時內會跑三十幾次。這裡跑七次、每次隔一
  // 小時，效果一樣：如果續期會重設起算點，第七次之後就再也不會到期了。
  for (let hour = 0; hour < 7; hour += 1) {
    harness.advance(1 * HOUR);
    token = harness.refresh(token);
    // 每一次續期完的當下，token 都還是好的。
    await harness.strategy.authenticate(harness.request(token));
  }

  // 現在是登入後第七小時，手上這個 token 是一分鐘前才簽出來的。它自己很新，
  // 但它繼承的起算點沒動過。
  harness.advance(1 * HOUR + 1 * SECOND);

  await assert.rejects(
    () => harness.strategy.authenticate(harness.request(token)),
    (error) => {
      assert.equal(error.code, "SESSION_EXPIRED");
      return true;
    }
  );
});

test("an over-age session is rejected even while the revocation snapshot is unusable", async () => {
  // 快照不可用時，撤銷檢查會回 503「稍後再試」。但一條超過上限的 session 是
  // 死的，跟快照健不健康無關——回 503 會讓客戶端留著憑證等下去，而它永遠不會
  // 再變成有效的。所以上限這道檢查必須排在前面。
  const harness = createHarness({ snapshotUsable: false });
  const token = harness.login();

  harness.advance(9 * HOUR);

  await assert.rejects(
    () => harness.strategy.authenticate(harness.request(token)),
    (error) => {
      assert.equal(error.statusCode, 401, "an expired session must not be reported as 503");
      assert.equal(error.code, "SESSION_EXPIRED");
      return true;
    }
  );
});

test("hitting the cap is logged as info, not warn", async () => {
  const harness = createHarness();
  const token = harness.login();

  harness.advance(9 * HOUR);
  await assert.rejects(() => harness.strategy.authenticate(harness.request(token)));

  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  const entry = harness.logger.entries.find(
    ({ event }) => event === "auth.jwt.session_expired"
  );
  // 每個使用者每天都會撞到一次——這是設計要求的行為，不是異常。記成 warn
  // 只會把真正需要有人看的 warn 淹掉。
  assert.equal(entry.level, "info");
  assert.equal(entry.context.sessionMaxAgeSeconds, 8 * 3600);
  assert.equal(entry.context.sessionAgeSeconds, 9 * 3600);
  assert.equal(entry.context.subject, "7");
});

test("the cap is a parameter, not a hardcoded eight hours", async () => {
  const harness = createHarness({ sessionMaxAge: "30m" });
  const token = harness.login();

  harness.advance(29 * 60 * SECOND);
  await harness.strategy.authenticate(harness.request(token));

  harness.advance(2 * 60 * SECOND);
  await assert.rejects(
    () => harness.strategy.authenticate(harness.request(token)),
    (error) => {
      assert.equal(error.code, "SESSION_EXPIRED");
      return true;
    }
  );
});

test("the client cannot tell an expired session from any other auth failure", async () => {
  const harness = createHarness();
  const token = harness.login();

  harness.advance(9 * HOUR);

  await assert.rejects(
    () => harness.strategy.authenticate(harness.request(token)),
    (error) => {
      // 對外一律是同一句話。客戶端要做的事情本來就一樣——清掉憑證、回登入頁
      // ——而區分出「這是絕對上限」只會多一個分支，換不到任何東西。
      assert.equal(error.publicCode, "Unauthorized Access");
      assert.equal(error.publicMessage, "Unauthorized Access");
      assert.doesNotMatch(error.publicMessage, /session|hour|expire/i);
      return true;
    }
  );
});
