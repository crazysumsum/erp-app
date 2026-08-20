import assert from "node:assert/strict";
import test from "node:test";
import { JwtPasswordAuthStrategy } from "../src/services/auth/jwtPasswordAuthStrategy.js";
import { JwtService } from "../src/services/auth/JwtService.js";
import { AUTH_FAILURE } from "../src/modules/user/UserService.js";

// 這支 strategy 是「JWT + 密碼再確認」這個模式的身份層。跟哪個 handler 在用它
// 無關，所以測試不透過任何 handler，直接對 strategy 送請求；密碼比對本身（含
// 鎖定、計次、時間旁路防護）在 userService.test.js 已經測過，這裡只管 strategy
// 怎麼編排——先驗 JWT、再驗密碼、失敗時回什麼。

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

function createJwtService() {
  return new JwtService({
    config: {
      jwt: {
        secret: "test-only-jwt-secret-with-at-least-32-characters",
        issuer: "erp-api",
        audience: "erp-client",
        algorithm: "HS256",
        expiresIn: "15m",
        clockToleranceSeconds: 5,
        headerName: "Authorization",
        authScheme: "Bearer"
      }
    }
  });
}

function fakeTokenRevocation({ revoked = false, snapshotUsable = true } = {}) {
  return {
    isRevoked: () => revoked,
    snapshotUsable: () => snapshotUsable,
    snapshotAgeSeconds: () => 0
  };
}

function createStrategy({
  jwt = createJwtService(),
  tokenRevocation = fakeTokenRevocation(),
  userService,
  logger = collectingLogger()
} = {}) {
  const available = {
    jwt,
    tokenRevocation,
    // UserService 在 constructor 裡就建了，這幾個只要存在即可——真正的驗證
    // 邏輯由下面覆寫掉的 strategy.userService 接手，不會走到這幾個假物件。
    mysqldatabase: {},
    time: {},
    logging: { logger, loggers: {} }
  };
  const services = {
    get(name) {
      return available[name];
    },
    require(name) {
      if (!(name in available)) {
        throw new Error(`Unexpected test service: ${name}`);
      }
      return available[name];
    }
  };

  const strategy = new JwtPasswordAuthStrategy({ config: {}, services });

  if (userService) {
    strategy.userService = userService;
  }

  return { strategy, jwt, logger };
}

function fakeRequest({ token, body = {} } = {}) {
  return {
    requestId: "req-1",
    body,
    get: (name) =>
      String(name).toLowerCase() === "authorization" ? `Bearer ${token}` : undefined
  };
}

function issueToken(jwt, { subject = "7", version = 1 } = {}) {
  return jwt.issue({}, { subject, version });
}

test("a valid JWT with the right password authenticates", async () => {
  const verified = [];
  const userService = {
    async verifyPasswordById(userId, password) {
      verified.push({ userId, password });
      return { ok: true };
    }
  };
  const { strategy, jwt } = createStrategy({ userService });
  const token = issueToken(jwt);

  const result = await strategy.authenticate(
    fakeRequest({ token, body: { password: "right-password" } })
  );

  assert.equal(result.type, "jwt-password");
  assert.equal(result.claims.sub, "7");
  assert.deepEqual(verified, [{ userId: 7, password: "right-password" }]);
});

test("an invalid JWT never reaches the password check", async () => {
  let called = false;
  const userService = {
    async verifyPasswordById() {
      called = true;
      return { ok: true };
    }
  };
  const { strategy } = createStrategy({ userService });

  await assert.rejects(
    () =>
      strategy.authenticate(
        fakeRequest({ token: "not-a-jwt", body: { password: "right-password" } })
      ),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );

  assert.equal(called, false);
});

test("a revoked JWT never reaches the password check", async () => {
  let called = false;
  const userService = {
    async verifyPasswordById() {
      called = true;
      return { ok: true };
    }
  };
  const { strategy, jwt } = createStrategy({
    tokenRevocation: fakeTokenRevocation({ revoked: true }),
    userService
  });
  const token = issueToken(jwt);

  await assert.rejects(
    () =>
      strategy.authenticate(fakeRequest({ token, body: { password: "right-password" } })),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );

  assert.equal(called, false);
});

test("a missing password is refused before anything is checked", async () => {
  let called = false;
  const userService = {
    async verifyPasswordById() {
      called = true;
      return { ok: true };
    }
  };
  const { strategy, jwt } = createStrategy({ userService });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, body: {} })),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "PASSWORD_REQUIRED");
      return true;
    }
  );

  assert.equal(called, false);
});

test("an empty string password is refused the same way a missing one is", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, body: { password: "" } })),
    (error) => {
      assert.equal(error.publicCode, "PASSWORD_REQUIRED");
      return true;
    }
  );
});

test("the wrong password, an unknown user and a locked account all collapse into one public code", async () => {
  for (const reason of [
    AUTH_FAILURE.BAD_PASSWORD,
    AUTH_FAILURE.UNKNOWN_USER,
    AUTH_FAILURE.LOCKED
  ]) {
    const { strategy, jwt, logger } = createStrategy({
      userService: {
        async verifyPasswordById() {
          return { ok: false, reason };
        }
      }
    });
    const token = issueToken(jwt);

    await assert.rejects(
      () =>
        strategy.authenticate(fakeRequest({ token, body: { password: "wrong-password" } })),
      (error) => {
        // 呼叫端已經握有這個帳號的有效 JWT，但不該從回應差異分辨出「密碼錯」
        // 跟「已被鎖定」——這對拿著偷來的 token 的人是校準策略用的資訊。
        assert.equal(error.statusCode, 401, reason);
        assert.equal(error.publicCode, "PASSWORD_INVALID", reason);
        return true;
      }
    );

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    const entry = logger.entries.find((item) => item.event === "auth.password.rejected");
    assert.equal(entry.context.reason, reason);
  }
});

test("a disabled account gets its own code, not the generic password-invalid one", async () => {
  const { strategy, jwt } = createStrategy({
    userService: {
      async verifyPasswordById() {
        return { ok: false, reason: AUTH_FAILURE.DISABLED };
      }
    }
  });
  const token = issueToken(jwt);

  await assert.rejects(
    () =>
      strategy.authenticate(fakeRequest({ token, body: { password: "right-password" } })),
    (error) => {
      // 停用對正常使用者是「找管理員」這種可行動的資訊，不是密碼猜測相關的
      // 洩漏，所以跟 refreshTokenHandler 一樣單獨給 USER_INACTIVE。
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "USER_INACTIVE");
      return true;
    }
  );
});

test("authType and service metadata are declared correctly", () => {
  assert.equal(JwtPasswordAuthStrategy.authType, "jwt-password");
  assert.deepEqual(JwtPasswordAuthStrategy.service.dependencies, [
    "jwt",
    "tokenRevocation",
    "mysqldatabase",
    "time",
    "logging"
  ]);
});
