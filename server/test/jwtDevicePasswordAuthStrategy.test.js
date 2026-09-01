import assert from "node:assert/strict";
import test from "node:test";
import { JwtDevicePasswordAuthStrategy } from "../src/services/auth/jwtDevicePasswordAuthStrategy.js";
import { JwtService } from "../src/services/auth/JwtService.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 這支 strategy 疊了兩層：JwtDeviceAuthStrategy 的身份層（JWT + 設備簽章），
// 加上密碼再確認。兩層各自的邏輯分別在 jwtDeviceAuthStrategy.test.js 與
// passwordReauth.js 的呼叫端（jwtPasswordAuthStrategy.test.js）測過，這裡只管
// 「疊起來的順序對不對」：設備先、密碼後，任一層失敗另一層完全不會跑。

const DEVICE_ID = "a".repeat(64);

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
        sessionMaxAge: "8h",
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

function fakeDeviceBinding({
  binding = {
    id: 11,
    device_id: DEVICE_ID,
    public_key: Buffer.from("stored-key"),
    status: "approved"
  },
  verification = { ok: true },
  calls = { findBinding: 0, verifyRequest: 0 }
} = {}) {
  return {
    calls,
    bodyHash: () => "body-hash",
    accessTokenHash: (token) => (token ? `hash(${token})` : ""),
    async findBinding() {
      calls.findBinding += 1;
      return binding;
    },
    async verifyRequest() {
      calls.verifyRequest += 1;
      return verification;
    }
  };
}

function createStrategy({
  jwt = createJwtService(),
  tokenRevocation = fakeTokenRevocation(),
  deviceBinding = fakeDeviceBinding(),
  userService,
  logger = collectingLogger()
} = {}) {
  const available = {
    jwt,
    tokenRevocation,
    deviceBinding,
    mysqldatabase: {},
    time: createTestTime({ clock: () => new Date() }),
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

  const strategy = new JwtDevicePasswordAuthStrategy({ config: {}, services });

  if (userService) {
    strategy.userService = userService;
  }

  return { strategy, jwt, logger, deviceBinding };
}

function fakeRequest({ token, headers = {}, body = { password: "right-password" }, requestId = "req-1" } = {}) {
  const all = {
    authorization: `Bearer ${token}`,
    "x-device-id": DEVICE_ID,
    "x-device-timestamp": String(Date.now()),
    "x-device-nonce": "11111111-1111-4111-8111-111111111111",
    "x-device-signature": Buffer.from("signature").toString("base64url"),
    ...headers
  };

  return {
    requestId,
    method: "POST",
    path: "/api/v1/users/create",
    rawBody: Buffer.from(JSON.stringify(body)),
    body,
    get: (name) => all[String(name).toLowerCase()]
  };
}

function issueToken(jwt, { subject = "7", version = 1, did = DEVICE_ID } = {}) {
  return jwt.issue({ did }, { subject, version, authTime: Math.floor(Date.now() / 1000) });
}

function alwaysCorrectPassword() {
  const verified = [];
  return {
    verified,
    userService: {
      async verifyPasswordById(userId, password) {
        verified.push({ userId, password });
        return { ok: true };
      }
    }
  };
}

test("authType and service metadata are declared correctly", () => {
  assert.equal(JwtDevicePasswordAuthStrategy.authType, "jwt-device-password");
  assert.equal(JwtDevicePasswordAuthStrategy.service.name, "auth.jwtDevicePassword");
  assert.deepEqual(
    [...JwtDevicePasswordAuthStrategy.service.dependencies].sort(),
    ["deviceBinding", "jwt", "logging", "mysqldatabase", "time", "tokenRevocation"].sort()
  );
});

test("a valid JWT, matching device signature and correct password all together authenticate", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const { strategy, jwt } = createStrategy({ userService });
  const token = issueToken(jwt);

  const result = await strategy.authenticate(fakeRequest({ token }));

  assert.equal(result.type, "jwt-device-password");
  assert.equal(result.claims.sub, "7");
  assert.equal(result.deviceBinding.id, 11);
  assert.deepEqual(verified, [{ userId: 7, password: "right-password" }]);
});

test("device mismatch is rejected before the password is ever checked", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const { strategy, jwt } = createStrategy({ userService });
  // did 跟簽章聲稱的設備不一樣。
  const token = issueToken(jwt, { did: "b".repeat(64) });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      assert.equal(error.code, "DEVICE_MISMATCH");
      return true;
    }
  );

  assert.deepEqual(verified, [], "password must not be checked when the device does not match");
});

test("an unapproved device is rejected before the password is ever checked", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const deviceBinding = fakeDeviceBinding({
    binding: { id: 11, device_id: DEVICE_ID, public_key: Buffer.from("x"), status: "pending" }
  });
  const { strategy, jwt } = createStrategy({ deviceBinding, userService });
  const token = issueToken(jwt);

  await assert.rejects(() => strategy.authenticate(fakeRequest({ token })));

  assert.deepEqual(verified, []);
});

test("a rejected device signature is rejected before the password is ever checked", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const deviceBinding = fakeDeviceBinding({ verification: { ok: false, reason: "signature_invalid" } });
  const { strategy, jwt } = createStrategy({ deviceBinding, userService });
  const token = issueToken(jwt);

  await assert.rejects(() => strategy.authenticate(fakeRequest({ token })));

  assert.deepEqual(verified, []);
  assert.equal(deviceBinding.calls.verifyRequest, 1);
});

test("an invalid JWT never reaches the device check or the password check", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const { strategy, deviceBinding } = createStrategy({ userService });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token: "not-a-jwt" })),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );

  assert.equal(deviceBinding.calls.findBinding, 0);
  assert.deepEqual(verified, []);
});

test("a revoked JWT never reaches the device check or the password check", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const { strategy, jwt, deviceBinding } = createStrategy({
    tokenRevocation: fakeTokenRevocation({ revoked: true }),
    userService
  });
  const token = issueToken(jwt);

  await assert.rejects(() => strategy.authenticate(fakeRequest({ token })));

  assert.equal(deviceBinding.calls.findBinding, 0);
  assert.deepEqual(verified, []);
});

test("the device signature passes but the password is wrong: PASSWORD_INVALID, not DEVICE_MISMATCH", async () => {
  const userService = {
    async verifyPasswordById() {
      return { ok: false, reason: "bad_password" };
    }
  };
  const { strategy, jwt } = createStrategy({ userService });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, body: { password: "wrong" } })),
    (error) => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "PASSWORD_INVALID");
      return true;
    }
  );
});

test("a missing password is refused after the device check passes", async () => {
  const { userService, verified } = alwaysCorrectPassword();
  const { strategy, jwt, deviceBinding } = createStrategy({ userService });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token, body: {} })),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "PASSWORD_REQUIRED");
      return true;
    }
  );

  // 設備檢查本身確實跑過了（否則測不到「先設備後密碼」這件事）。
  assert.equal(deviceBinding.calls.findBinding, 1);
  assert.deepEqual(verified, []);
});
