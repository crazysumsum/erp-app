import assert from "node:assert/strict";
import test from "node:test";
import { JwtAuthStrategy } from "../src/services/auth/jwtAuthStrategy.js";
import { JwtService } from "../src/services/auth/JwtService.js";

/**
 * mcp（must change password）強制擋。設計說明見 docs/user_management/design_spec.md §3.5。
 *
 * 這支 strategy 其餘的行為（撤銷、快照熔斷、絕對 session 上限）已經分別在
 * tokenRevocation.test.js、sessionMaxAge.test.js 測過，這裡只管新加的這一段：
 * 排在撤銷檢查之後、豁免清單放行、非豁免一律 403。
 */

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
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
        sessionMaxAge: "8h",
        clockToleranceSeconds: 5,
        headerName: "Authorization",
        authScheme: "Bearer"
      }
    }
  });
}

function createStrategy({ revoked = false, snapshotUsable = true } = {}) {
  const jwt = createJwtService();
  const logger = collectingLogger();
  const available = {
    jwt,
    tokenRevocation: {
      isRevoked: () => revoked,
      snapshotUsable: () => snapshotUsable,
      snapshotAgeSeconds: () => 0
    },
    time: { nowMs: () => Date.now() },
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

  return { strategy, jwt, logger };
}

function fakeRequest({ token, method, path }) {
  return {
    requestId: "req-1",
    method,
    path,
    get: (name) => (String(name).toLowerCase() === "authorization" ? `Bearer ${token}` : undefined)
  };
}

function issueToken(jwt, { mustChangePassword }) {
  const claims = {};
  if (mustChangePassword) {
    claims.mcp = true;
  }
  return jwt.issue(claims, { subject: "7", version: 0, authTime: Math.floor(Date.now() / 1000) });
}

test("a token without mcp is never blocked, on any route", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt, { mustChangePassword: false });

  const result = await strategy.authenticate(
    fakeRequest({ token, method: "GET", path: "/api/v1/users" })
  );

  assert.equal(result.claims.sub, "7");
});

test("a token with mcp is blocked on a route that is not exempt", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt, { mustChangePassword: true });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, method: "GET", path: "/api/v1/users" })),
    (error) => {
      assert.equal(error.code, "PASSWORD_CHANGE_REQUIRED");
      assert.equal(error.statusCode, 403);
      return true;
    }
  );
});

test("a token with mcp is allowed through on every exempt route", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt, { mustChangePassword: true });

  const exempt = [
    ["POST", "/api/v1/user/password/change"],
    ["GET", "/api/v1/user/me"],
    ["POST", "/api/v1/user/token/refresh"],
    ["POST", "/api/v1/user/logout"]
  ];

  for (const [method, path] of exempt) {
    const result = await strategy.authenticate(fakeRequest({ token, method, path }));
    assert.equal(result.claims.sub, "7", `${method} ${path} should have been exempt`);
  }
});

test("mcp is checked with the request's own method and path, not a substring match", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt, { mustChangePassword: true });

  // GET 對這條路徑是豁免的，POST 不是——同一個 path 换個 method 不該一起放行。
  await assert.rejects(() =>
    strategy.authenticate(fakeRequest({ token, method: "POST", path: "/api/v1/user/me" }))
  );

  // 路徑多一段前綴也不該被當成同一條豁免路徑。
  await assert.rejects(() =>
    strategy.authenticate(
      fakeRequest({ token, method: "GET", path: "/api/v1/admin/user/me" })
    )
  );
});

test("a revoked token is rejected before the mcp check ever runs", async () => {
  const { strategy, jwt } = createStrategy({ revoked: true });
  const token = issueToken(jwt, { mustChangePassword: true });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, method: "GET", path: "/api/v1/users" })),
    (error) => {
      // 撤銷比 mcp 更早判定，回應要是撤銷的那個籠統錯誤，不是 PASSWORD_CHANGE_REQUIRED。
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );
});

test("an unusable revocation snapshot is reported as unavailable, not as a password-change gate", async () => {
  const { strategy, jwt } = createStrategy({ snapshotUsable: false });
  const token = issueToken(jwt, { mustChangePassword: true });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, method: "GET", path: "/api/v1/users" })),
    (error) => {
      assert.equal(error.code, "REVOCATION_UNAVAILABLE");
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
});
