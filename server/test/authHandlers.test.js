import assert from "node:assert/strict";
import test from "node:test";
import { LoginHandler } from "../src/handlers/loginHandler.js";
import { LogoutHandler } from "../src/handlers/logoutHandler.js";
import { MeHandler } from "../src/handlers/meHandler.js";
import { AUTH_FAILURE } from "../src/services/user/UserService.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 這幾支 handler 決定「誰進得來、進來之後算是誰」。它們的錯法都不會有錯誤訊息
// 浮現：登入回應多帶了不該帶的東西、登出沒有真的撤銷、/me 回的是 token 裡的
// 舊快照而不是現在的狀態。

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

function createServices(overrides = {}) {
  const logger = overrides.logger || collectingLogger();
  const time = createTestTime();
  const available = {
    logging: { logger, loggers: {} },
    time,
    ...overrides.services
  };

  return {
    logger,
    services: {
      get(name) {
        return available[name];
      },
      require(name) {
        if (!(name in available)) {
          throw new Error(`Unexpected test service: ${name}`);
        }
        return available[name];
      }
    }
  };
}

const SAMPLE_USER = Object.freeze({
  id: 7,
  username: "alice",
  displayName: "Alice",
  roles: ["admin"],
  permissions: ["order.read"]
});

function fakeJwt({ issued = [] } = {}) {
  return {
    authScheme: "Bearer",
    expiresIn: "2h",
    issue(payload, options) {
      issued.push({ payload, options });
      return "signed.jwt.token";
    },
    issued
  };
}

function fakeTokenRevocation({ version = 3, revoked = [] } = {}) {
  return {
    revoked,
    async currentVersion() {
      return version;
    },
    async revoke(subject, options) {
      revoked.push({ subject, options });
      return version + 1;
    }
  };
}

test("login issues a token carrying the roles and permissions claims", async () => {
  const jwt = fakeJwt();
  const tokenRevocation = fakeTokenRevocation({ version: 3 });
  const { services } = createServices({
    services: {
      user: {
        async authenticate() {
          return { ok: true, user: SAMPLE_USER };
        }
      },
      jwt,
      tokenRevocation
    }
  });
  const handler = new LoginHandler(services);

  const response = await handler.execute({
    input: { body: { username: "alice", password: "right" } }
  });

  assert.deepEqual(response.data, {
    token: "signed.jwt.token",
    tokenType: "Bearer",
    expiresIn: "2h",
    user: SAMPLE_USER
  });

  // 授權策略 hasRole／hasPermission 直接讀這兩個 claim；漏掉它們的話每個要求
  // 權限的 API 都會回 403，而 token 本身看起來完全正常。
  const [issued] = jwt.issued;
  assert.deepEqual(issued.payload, {
    roles: ["admin"],
    permissions: ["order.read"]
  });
  // 版本號必須跟著簽進去，否則這個 token 對撤銷永久免疫。
  assert.deepEqual(issued.options, { subject: "7", version: 3 });
});

test("login answers every failure with the same message", async () => {
  for (const reason of Object.values(AUTH_FAILURE)) {
    const { services } = createServices({
      services: {
        user: {
          async authenticate() {
            return { ok: false, reason };
          }
        },
        jwt: fakeJwt(),
        tokenRevocation: fakeTokenRevocation()
      }
    });
    const handler = new LoginHandler(services);

    // 逐一區分的訊息會告訴攻擊者哪些帳號存在、哪些已被鎖定。
    await assert.rejects(
      () =>
        handler.execute({
          input: { body: { username: "alice", password: "whatever" } }
        }),
      (error) => {
        assert.equal(error.statusCode, 401);
        assert.equal(error.publicMessage, "Invalid username or password");
        assert.equal(error.publicCode, "Unauthorized Access");
        return true;
      }
    );
  }
});

test("login records the real failure reason in the log", async () => {
  const { services, logger } = createServices({
    services: {
      user: {
        async authenticate() {
          return { ok: false, reason: AUTH_FAILURE.LOCKED };
        }
      },
      jwt: fakeJwt(),
      tokenRevocation: fakeTokenRevocation()
    }
  });
  const handler = new LoginHandler(services);

  await assert.rejects(() =>
    handler.execute({
      input: { body: { username: "alice", password: "whatever" } }
    })
  );

  // 對外一句籠統的訊息，對內要分得出來——否則防守方看不出正在發生的是暴力
  // 破解還是使用者忘記密碼。
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const failure = logger.entries.find((entry) => entry.event === "auth.login.failed");
  assert.equal(failure.context.reason, AUTH_FAILURE.LOCKED);
});

test("login never puts the password in the log context", async () => {
  const { services, logger } = createServices({
    services: {
      user: {
        async authenticate() {
          return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
        }
      },
      jwt: fakeJwt(),
      tokenRevocation: fakeTokenRevocation()
    }
  });
  const handler = new LoginHandler(services);

  await assert.rejects(() =>
    handler.execute({
      input: { body: { username: "alice", password: "hunter2" } }
    })
  );

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(
    !JSON.stringify(logger.entries).includes("hunter2"),
    "the password reached the log"
  );
});

test("logout revokes every token for the subject", async () => {
  const tokenRevocation = fakeTokenRevocation();
  const { services } = createServices({ services: { tokenRevocation } });
  const handler = new LogoutHandler(services);

  const response = await handler.execute({
    auth: { claims: { sub: "7" } }
  });

  assert.deepEqual(response.data, { revoked: true });
  assert.deepEqual(tokenRevocation.revoked, [
    { subject: "7", options: { reason: "logout" } }
  ]);
});

test("me reads the current database state rather than the token claims", async () => {
  const queried = [];
  const { services } = createServices({
    services: {
      user: {
        async findActiveById(id) {
          queried.push(id);
          return SAMPLE_USER;
        }
      }
    }
  });
  const handler = new MeHandler(services);

  const response = await handler.execute({
    // claims 帶著一組過期的權限：token 是簽發當下的快照，回它等於讓已經被收回
    // 的權限繼續有效，直到 token 過期為止。
    auth: { claims: { sub: "7", roles: ["superuser"], permissions: ["*"] } }
  });

  assert.deepEqual(response.data, SAMPLE_USER);
  assert.deepEqual(queried, [7]);
});

test("me rejects a valid token whose account no longer exists", async () => {
  const { services } = createServices({
    services: {
      user: {
        async findActiveById() {
          return null;
        }
      }
    }
  });
  const handler = new MeHandler(services);

  // 401 而不是 403：憑證本身已經沒有意義，客戶端該回登入頁而不是以為權限不足。
  await assert.rejects(
    () => handler.execute({ auth: { claims: { sub: "7" } } }),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "USER_INACTIVE");
      return true;
    }
  );
});

test("auth routes declare the access they need", () => {
  // 登入必須是 public：預設是 jwt，而要求 token 才能登入是一個沒有出口的迴圈。
  assert.equal(LoginHandler.api.authType, "public");
  assert.deepEqual(LoginHandler.api.authorizationPolicies, [
    { name: "allowAll", options: {} }
  ]);

  // 登出與 /me 相反：兩者都不指定，沿用 config/api.js 的預設（jwt +
  // authenticated）。明確寫成 public 之外的任何值都不需要，但漏寫成 public
  // 會讓任何人撤銷別人的 token，所以這裡把「沒有覆寫」釘住。
  assert.equal(LogoutHandler.api.authType, undefined);
  assert.equal(LogoutHandler.api.authorizationPolicies, undefined);
  assert.equal(MeHandler.api.authType, undefined);
  assert.equal(MeHandler.api.authorizationPolicies, undefined);
});

test("login response schema does not leak the password hash", () => {
  const userSchema = LoginHandler.api.responseSchema[200].properties.user;

  // additionalProperties: false 是這個保證的實作——handler 多回一個欄位會被
  // 回應驗證擋下，而不是安靜地送出去。
  assert.equal(userSchema.additionalProperties, false);
  assert.ok(!("password_hash" in userSchema.properties));
  assert.ok(!("passwordHash" in userSchema.properties));
});
