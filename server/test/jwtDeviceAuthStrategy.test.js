import assert from "node:assert/strict";
import test from "node:test";
import { JwtDeviceAuthStrategy } from "../src/services/auth/jwtDeviceAuthStrategy.js";
import { JwtService } from "../src/services/auth/JwtService.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 這支 strategy 是「JWT + 設備簽章」這個模式的身份層——JWT 有效嗎、沒被撤銷、
// 這個簽章是不是這個 token 綁定的那台設備發出的。跟哪個 handler 在用它無關，
// 所以測試也不透過任何 handler，直接對 strategy 本身送請求。目前唯一的消費者
// 是 refreshTokenHandler，它自己的測試（authHandlers.test.js）只管「拿到一個
// 通過身份驗證的請求之後，該不該真的換發」這件事，不重覆測這裡。

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
  verified = [],
  calls = { findBinding: 0 }
} = {}) {
  return {
    verified,
    calls,
    bodyHash: () => "body-hash",
    async findBinding() {
      calls.findBinding += 1;
      return binding;
    },
    async verifyRequest(request) {
      verified.push(request);
      return verification;
    }
  };
}

function createStrategy({
  jwt = createJwtService(),
  tokenRevocation = fakeTokenRevocation(),
  deviceBinding = fakeDeviceBinding(),
  logger = collectingLogger()
} = {}) {
  const available = {
    jwt,
    tokenRevocation,
    deviceBinding,
    // 繼承來的 JwtAuthStrategy 用它判斷絕對 session 上限。真時鐘：這個檔案
    // 驗的是設備簽章，token 都是當場簽的，上限那條路有自己的測試。
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

  return { strategy: new JwtDeviceAuthStrategy({ config: {}, services }), jwt, logger };
}

function fakeRequest({ token, headers = {}, body = {}, requestId = "req-1" } = {}) {
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
    path: "/api/v1/user/token/refresh",
    rawBody: Buffer.from(JSON.stringify(body)),
    get: (name) => all[String(name).toLowerCase()]
  };
}

function issueToken(jwt, { subject = "7", version = 1, did = DEVICE_ID } = {}) {
  return jwt.issue({ did }, { subject, version, authTime: Math.floor(Date.now() / 1000) });
}

test("a valid JWT with a matching device signature authenticates and hands back the binding", async () => {
  const { strategy, jwt } = createStrategy();
  const token = issueToken(jwt);

  const result = await strategy.authenticate(fakeRequest({ token }));

  assert.equal(result.type, "jwt-device");
  assert.equal(result.claims.sub, "7");
  assert.equal(result.claims.did, DEVICE_ID);
  // handler 要靠這個直接拿到 binding，不必自己再查一次資料庫。
  assert.equal(result.deviceBinding.id, 11);
});

test("an invalid JWT never reaches the device check", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { strategy } = createStrategy({ deviceBinding });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token: "not-a-jwt" })),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );

  assert.equal(deviceBinding.calls.findBinding, 0);
});

test("a revoked JWT never reaches the device check", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { strategy, jwt } = createStrategy({
    tokenRevocation: fakeTokenRevocation({ revoked: true }),
    deviceBinding
  });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "JWT_INVALID");
      return true;
    }
  );

  assert.equal(deviceBinding.calls.findBinding, 0);
});

test("missing device signature headers are refused before anything is looked up", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { strategy, jwt } = createStrategy({ deviceBinding });
  const token = issueToken(jwt);

  await assert.rejects(
    () =>
      strategy.authenticate(
        fakeRequest({ token, headers: { "x-device-signature": "" } })
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_REQUIRED");
      return true;
    }
  );

  assert.equal(deviceBinding.calls.findBinding, 0);
});

test("a signature from a device other than the one in the token is refused", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { strategy, jwt } = createStrategy({ deviceBinding });
  // token 說它發給了另一台設備，但簽名的是 DEVICE_ID 這一台。
  const token = issueToken(jwt, { did: "b".repeat(64) });

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      // 少了這一步，任何一台已審批的設備都能替任何一個 token 通過驗證——
      // 包括用自己的金鑰去用一個偷來的 token。
      assert.equal(error.statusCode, 403);
      assert.equal(error.publicCode, "DEVICE_MISMATCH");
      return true;
    }
  );

  // did 對不上在查綁定之前就擋下了，沒有理由多查一次資料庫。
  assert.equal(deviceBinding.calls.findBinding, 0);
});

test("a token with no did claim at all is a mismatch too, and the log falls back cleanly", async () => {
  const { strategy, jwt, logger } = createStrategy();
  // 手工造一個沒有 did 的 token——理論上簽發端一律會帶，但這裡要確認少了它
  // 不會讓比對意外通過，也不會讓記錄那行自己先炸掉。
  const token = jwt.issue({}, { subject: "7", version: 1, authTime: Math.floor(Date.now() / 1000) });

  await assert.rejects(
    // requestId 也留空：跟 tokenDeviceId 一樣，用同一個 "?? null" / "|| null"
    // 兜底，缺席不該讓記錄那行自己先炸掉。
    () => strategy.authenticate(fakeRequest({ token, headers: {}, body: {}, requestId: null })),
    (error) => {
      assert.equal(error.publicCode, "DEVICE_MISMATCH");
      return true;
    }
  );

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const entry = logger.entries.find((item) => item.event === "auth.device.mismatch");
  assert.equal(entry.context.tokenDeviceId, null);
  assert.equal(entry.context.requestId, null);
});

test("the signature rejection log carries through an optional detail when one is given", async () => {
  const deviceBinding = fakeDeviceBinding({
    verification: { ok: false, reason: "nonce_replayed", detail: "seen twice" }
  });
  const { strategy, jwt, logger } = createStrategy({ deviceBinding });
  const token = issueToken(jwt);

  await assert.rejects(() => strategy.authenticate(fakeRequest({ token })));

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const entry = logger.entries.find(
    (item) => item.event === "auth.device.signature_rejected"
  );
  assert.equal(entry.context.detail, "seen twice");
});

test("the request stops working once the device is no longer approved", async () => {
  for (const [status, expected] of [
    ["revoked", "DEVICE_REVOKED"],
    ["rejected", "DEVICE_REJECTED"],
    ["pending", "DEVICE_PENDING_APPROVAL"]
  ]) {
    const { strategy, jwt } = createStrategy({
      deviceBinding: fakeDeviceBinding({
        binding: { id: 11, device_id: DEVICE_ID, public_key: Buffer.from("k"), status }
      })
    });
    const token = issueToken(jwt);

    await assert.rejects(
      () => strategy.authenticate(fakeRequest({ token })),
      (error) => {
        assert.equal(error.statusCode, 403, status);
        assert.equal(error.publicCode, expected, status);
        return true;
      }
    );
  }
});

test("the request is refused when the binding is gone entirely", async () => {
  const { strategy, jwt } = createStrategy({
    deviceBinding: fakeDeviceBinding({ binding: null })
  });
  const token = issueToken(jwt);

  // 綁定被刪掉（例如清理工作掃走了一台很久沒用的設備）與被撤銷，對持有 token
  // 的人來說是同一件事：這台機器不再被信任。
  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      assert.equal(error.publicCode, "DEVICE_REVOKED");
      return true;
    }
  );
});

test("verifies against the stored key and refuses a bad signature", async () => {
  const deviceBinding = fakeDeviceBinding({
    verification: { ok: false, reason: "nonce_replayed" }
  });
  const { strategy, jwt, logger } = createStrategy({ deviceBinding });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_INVALID");
      return true;
    }
  );

  assert.deepEqual(deviceBinding.verified[0].publicKeyDer, Buffer.from("stored-key"));

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(
    logger.entries.some((entry) => entry.event === "auth.device.signature_rejected")
  );
});

test("a clock skew rejection is told apart, because only the user can fix that one", async () => {
  const deviceBinding = fakeDeviceBinding({
    verification: { ok: false, reason: "timestamp_stale" }
  });
  const { strategy, jwt } = createStrategy({ deviceBinding });
  const token = issueToken(jwt);

  await assert.rejects(
    () => strategy.authenticate(fakeRequest({ token })),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_STALE");
      return true;
    }
  );
});

test("authType and service metadata are declared correctly", () => {
  assert.equal(JwtDeviceAuthStrategy.authType, "jwt-device");
  // time 是繼承來的需求（JwtAuthStrategy 用它算絕對 session 上限），但 service
  // discovery 讀的是每個類別自己的 static metadata，所以子類別漏列它就會在啟動
  // 時炸——這一條把那個容易漏的地方釘住。
  assert.deepEqual(JwtDeviceAuthStrategy.service.dependencies, [
    "jwt",
    "tokenRevocation",
    "deviceBinding",
    "time",
    "logging"
  ]);
});
