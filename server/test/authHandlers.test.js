import assert from "node:assert/strict";
import test from "node:test";
import { LoginHandler } from "../src/handlers/user/loginHandler.js";
import { LogoutHandler } from "../src/handlers/user/logoutHandler.js";
import { MeHandler } from "../src/handlers/user/meHandler.js";
import { RefreshTokenHandler } from "../src/handlers/user/refreshTokenHandler.js";
import { AUTH_FAILURE } from "../src/modules/user/UserService.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 這幾支 handler 決定「誰進得來、進來之後算是誰」。它們的錯法都不會有錯誤訊息
// 浮現：登入回應多帶了不該帶的東西、登出沒有真的撤銷、/me 回的是 token 裡的
// 舊快照而不是現在的狀態。

/**
 * 一對可以從測試外部控制何時 resolve 的 promise。用來在兩個 handler 呼叫之間
 * 逼出一個確定的交錯順序，而不是賭 setTimeout 的時間差——見下面幾個「A vs B」
 * 的競態測試。
 */
function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

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
    // handler 的 constructor 會拿它去建 UserService。這些測試不碰資料庫——建好
    // 之後那個 UserService 就被替身換掉了——所以這裡只要有個物件在就夠。
    mysqldatabase: {},
    // 預設放一個已審批的設備，讓「跟設備無關」的測試（密碼錯、節流）不必各自
    // 交代設備狀態。驗簽本身在 deviceBinding.test.js 用真的金鑰測。
    deviceBinding: fakeDeviceBinding(),
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

/**
 * 建一支 handler，再把它自己 new 出來的 UserService 換成替身。
 *
 * UserService 是業務模組，不經 service container，所以 handler 是自己 import
 * 再 new 的——測試沒辦法靠注入換掉它。這幾個測試要驗的是 handler 怎麼處理
 * UserService 的回覆（錯誤訊息一不一致、claims 有沒有簽進去），不是 UserService
 * 自己的判斷邏輯，那些在 userService.test.js。
 */
function createHandler(HandlerClass, { userService, ...overrides } = {}) {
  const { services, logger } = createServices(overrides);
  const handler = new HandlerClass(services);

  if (userService) {
    handler.userService = userService;
  }

  return { handler, logger };
}

// createTestTime() 的時鐘固定在 2026-08-07T06:00:00Z，所以登入蓋出來的
// auth_time 是可以直接寫死比對的。
const NOW_SECONDS = Math.floor(Date.parse("2026-08-07T06:00:00.000Z") / 1000);

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
    expiresInSeconds: 7200,
    sessionMaxAgeSeconds: 8 * 3600,
    issue(payload, options) {
      issued.push({ payload, options });
      return "signed.jwt.token";
    },
    issued
  };
}

function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    }
  };
}

const DEVICE_ID = "a".repeat(64);

/**
 * 設備綁定的替身。這幾個測試驗的是 loginHandler 怎麼編排——先驗密碼再驗設備、
 * 各種綁定狀態回什麼——而不是簽章本身對不對，那在 deviceBinding.test.js 用真的
 * Web Crypto 金鑰測。
 */
function fakeDeviceBinding({
  binding = { id: 11, device_id: DEVICE_ID, public_key: Buffer.from("stored-key"), status: "approved" },
  verification = { ok: true },
  requested = [],
  used = [],
  verified = []
} = {}) {
  return {
    requested,
    used,
    verified,
    deviceIdFor: () => DEVICE_ID,
    bodyHash: () => "body-hash",
    async findBinding() {
      return binding;
    },
    async verifyRequest(request) {
      verified.push(request);
      return verification;
    },
    async requestBinding(request) {
      requested.push(request);
      return { ...request, id: 99, status: "pending" };
    },
    async markUsed(id) {
      used.push(id);
    }
  };
}

function fakeRequest({ body = {}, ip = "203.0.113.5", headers = {} } = {}) {
  const all = {
    "x-device-id": DEVICE_ID,
    "x-device-timestamp": "1755600000000",
    "x-device-nonce": "11111111-1111-4111-8111-111111111111",
    "x-device-signature": Buffer.from("signature").toString("base64url"),
    "user-agent": "Firefox",
    ...headers
  };

  return {
    ip,
    rawBody: Buffer.from(JSON.stringify(body)),
    input: { body },
    get: (name) => all[String(name).toLowerCase()]
  };
}

function fakeTokenRevocation({ version = 3, revoked = [] } = {}) {
  // 用一個可變的閉包變數，而不是直接回傳建構時的 version：revoke() 真的要
  // 推高它，後續的 currentVersion() 才讀得到——這正是競態測試需要的行為，
  // 真正的 TokenRevocationService 也是這樣（見它的註解）。
  let current = version;

  return {
    revoked,
    async currentVersion() {
      return current;
    },
    async revoke(subject, options) {
      current += 1;
      revoked.push({ subject, options });
      return current;
    }
  };
}

test("login issues a token carrying the roles and permissions claims", async () => {
  const jwt = fakeJwt();
  const tokenRevocation = fakeTokenRevocation({ version: 3 });
  const deviceBinding = fakeDeviceBinding();
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt, tokenRevocation, deviceBinding }
  });

  const response = await handler.execute(
    fakeRequest({ body: { username: "alice", password: "right" } })
  );

  assert.deepEqual(response.data, {
    token: "signed.jwt.token",
    tokenType: "Bearer",
    expiresIn: "2h",
    // 前端靠這個數字算到期時刻。回字串 "2h" 的話它得自己再解析一次單位。
    expiresInSeconds: 7200,
    // 剛登入，整個絕對上限都還在。
    sessionExpiresInSeconds: 8 * 3600,
    user: SAMPLE_USER
  });

  // 授權策略 hasRole／hasPermission 直接讀這兩個 claim；漏掉它們的話每個要求
  // 權限的 API 都會回 403，而 token 本身看起來完全正常。
  const [issued] = jwt.issued;
  assert.deepEqual(issued.payload, {
    roles: ["admin"],
    permissions: ["order.read"],
    // did 少了的話，續期時無從判斷請求是不是來自簽發它的那台設備——任何一台
    // 已審批的設備都能續期任何一個 token。
    did: DEVICE_ID
  });
  // 版本號必須跟著簽進去，否則這個 token 對撤銷永久免疫。authTime 同理：少了
  // 它這條 session 永遠不會撞到絕對上限。登入是唯一會把它設成「現在」的地方。
  assert.deepEqual(issued.options, {
    subject: "7",
    version: 3,
    authTime: NOW_SECONDS
  });
  // last_used_at 是清理工作判斷「這台還在用嗎」的唯一依據。
  assert.deepEqual(deviceBinding.used, [11]);
});

test("an approved device is verified with the stored key, never the one in the request", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await handler.execute(
    fakeRequest({
      body: { username: "alice", password: "right" },
      // 攻擊者附上自己的公鑰，想讓伺服器拿它來驗自己的簽章。
      headers: { "x-device-public-key": Buffer.from("attacker-key").toString("base64url") }
    })
  );

  // 用請求自帶的公鑰驗簽等於完全不驗：任何人都能簽出一份「有效」的簽章。
  const [verified] = deviceBinding.verified;
  assert.deepEqual(verified.publicKeyDer, Buffer.from("stored-key"));
});

test("an unknown device is recorded for approval and told so, not told the login failed", async () => {
  const deviceBinding = fakeDeviceBinding({ binding: null });
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await assert.rejects(
    () =>
      handler.execute(
        fakeRequest({
          body: { username: "alice", password: "right", deviceLabel: "Sam 的辦公室桌機" },
          headers: { "x-device-public-key": Buffer.from("new-key").toString("base64url") }
        })
      ),
    (error) => {
      // 混成「登入失敗」的話，使用者會以為密碼打錯而一直重試，然後撞上登入
      // 節流——真正該做的事（等審批）一件都不會發生。
      assert.equal(error.statusCode, 403);
      assert.equal(error.publicCode, "DEVICE_PENDING_APPROVAL");
      return true;
    }
  );

  const [request] = deviceBinding.requested;
  assert.equal(request.label, "Sam 的辦公室桌機");
  // IP 與 UA 是審批者唯一的判斷依據，漏掉的話審批只能靠猜。
  assert.equal(request.ip, "203.0.113.5");
  assert.equal(request.userAgent, "Firefox");
});

test("rejected and revoked devices get their own codes, not the pending one", async () => {
  for (const [status, expected] of [
    ["rejected", "DEVICE_REJECTED"],
    ["revoked", "DEVICE_REVOKED"],
    ["pending", "DEVICE_PENDING_APPROVAL"]
  ]) {
    const { handler } = createHandler(LoginHandler, {
      userService: {
        async authenticate() {
          return { ok: true, user: SAMPLE_USER };
        }
      },
      services: {
        jwt: fakeJwt(),
        tokenRevocation: fakeTokenRevocation(),
        deviceBinding: fakeDeviceBinding({
          binding: { id: 11, device_id: DEVICE_ID, public_key: Buffer.from("k"), status }
        })
      }
    });

    await assert.rejects(
      () => handler.execute(fakeRequest({ body: { username: "alice", password: "right" } })),
      (error) => {
        assert.equal(error.statusCode, 403, status);
        assert.equal(error.publicCode, expected, status);
        return true;
      }
    );
  }
});

test("a wrong password never reaches the device check", async () => {
  const deviceBinding = fakeDeviceBinding({ binding: null });
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await assert.rejects(() =>
    handler.execute(fakeRequest({ body: { username: "alice", password: "wrong" } }))
  );

  // 順序反過來的話，任何人都能對任意帳號灌爆審批佇列，而且「這個帳號的設備
  // 還沒審批」這個回應本身就會洩漏帳號存不存在。
  assert.deepEqual(deviceBinding.requested, []);
  assert.deepEqual(deviceBinding.verified, []);
});

test("a failed signature says nothing specific publicly but records why in the log", async () => {
  const { handler, logger } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: {
      jwt: fakeJwt(),
      tokenRevocation: fakeTokenRevocation(),
      deviceBinding: fakeDeviceBinding({ verification: { ok: false, reason: "nonce_replayed" } })
    }
  });

  await assert.rejects(
    () => handler.execute(fakeRequest({ body: { username: "alice", password: "right" } })),
    (error) => {
      assert.equal(error.statusCode, 400);
      // 「簽章不符」與「nonce 用過了」的差別會告訴攻擊者他離成功還差多遠。
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_INVALID");
      return true;
    }
  );

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  const rejection = logger.entries.find(
    (entry) => entry.event === "auth.device.signature_rejected"
  );
  assert.equal(rejection.context.reason, "nonce_replayed");
});

test("a clock skew rejection is told apart, because only the user can fix that one", async () => {
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: {
      jwt: fakeJwt(),
      tokenRevocation: fakeTokenRevocation(),
      deviceBinding: fakeDeviceBinding({ verification: { ok: false, reason: "timestamp_stale" } })
    }
  });

  await assert.rejects(
    () => handler.execute(fakeRequest({ body: { username: "alice", password: "right" } })),
    (error) => {
      // 攻擊者從「你的時間差太多」學不到任何東西，而收斂掉它只會換來一通
      // 查不出原因的客服電話。
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_STALE");
      assert.match(error.publicMessage, /clock/);
      return true;
    }
  );
});

test("missing device headers are refused before anything is looked up", async () => {
  const deviceBinding = fakeDeviceBinding();
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await assert.rejects(
    () =>
      handler.execute(
        fakeRequest({
          body: { username: "alice", password: "right" },
          headers: { "x-device-signature": undefined }
        })
      ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_REQUIRED");
      return true;
    }
  );

  assert.deepEqual(deviceBinding.verified, []);
});

test("a malformed nonce is refused up front, not carried into the database", async () => {
  // nonce 會被原樣塞進 user_device_nonces.nonce，一個 CHAR(36)。超長值喺 strict
  // mode 係 ER_DATA_TOO_LONG，而且係喺簽章驗過之後先發生——所以一個持有合法金鑰
  // 但送出畸形 nonce 嘅客戶端，症狀會係「簽名冇問題但伺服器爆咗」。
  const malformed = [
    "x".repeat(200),
    "not-a-uuid",
    "",
    // v1 UUID：長度啱，但規格寫明係 v4，而客戶端用嘅 crypto.randomUUID()
    // 本來就只會出 v4。
    "11111111-1111-1111-8111-111111111111"
  ];

  for (const nonce of malformed) {
    const deviceBinding = fakeDeviceBinding();
    const { handler } = createHandler(LoginHandler, {
      userService: {
        async authenticate() {
          return { ok: true, user: SAMPLE_USER };
        }
      },
      services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
    });

    await assert.rejects(
      () =>
        handler.execute(
          fakeRequest({
            body: { username: "alice", password: "right" },
            headers: { "x-device-nonce": nonce }
          })
        ),
      (error) => {
        assert.equal(error.statusCode, 400, JSON.stringify(nonce));
        // 空字串走「header 冇齊」那條，其餘走「形狀唔啱」那條。兩條都係 400，
        // 而且對外都唔會講出係邊個欄位有問題。
        assert.ok(
          ["DEVICE_SIGNATURE_REQUIRED", "DEVICE_SIGNATURE_INVALID"].includes(error.publicCode),
          `${JSON.stringify(nonce)} gave ${error.publicCode}`
        );
        return true;
      }
    );

    // 關鍵：驗簽同資料庫都唔應該掂過。
    assert.deepEqual(deviceBinding.verified, [], JSON.stringify(nonce));
  }
});

test("a first-time device that sends no public key is refused, not crashed on", async () => {
  const deviceBinding = fakeDeviceBinding({ binding: null });
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  // 未綁定的設備冇附公鑰就無從驗證任何嘢——資料庫入面又冇一把可以用。
  await assert.rejects(
    () =>
      handler.execute(fakeRequest({ body: { username: "alice", password: "right" } })),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_INVALID");
      return true;
    }
  );

  assert.deepEqual(deviceBinding.requested, []);
});

test("a binding request without a label or client details still records cleanly", async () => {
  const deviceBinding = fakeDeviceBinding({ binding: null });
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await assert.rejects(() =>
    handler.execute(
      fakeRequest({
        // deviceLabel 係選填；審批者仲有 IP 同 UA 可以睇，唔應該因為少一個
        // 標籤就擋低成個登入。
        body: { username: "alice", password: "right" },
        ip: "",
        headers: {
          "user-agent": undefined,
          "x-device-public-key": Buffer.from("new-key").toString("base64url")
        }
      })
    )
  );

  const [request] = deviceBinding.requested;
  // 欄位係 NOT NULL DEFAULT ''，所以呢度一定要係空字串而唔係 undefined，
  // 否則 INSERT 會炸。
  assert.equal(request.label, "");
  assert.equal(request.ip, "");
  assert.equal(request.userAgent, "");
});

test("a first-time device must prove the id really is its own key's thumbprint", async () => {
  const deviceBinding = fakeDeviceBinding({ binding: null });
  // deviceIdFor 回傳的是這把公鑰真正的 thumbprint；請求宣稱的是另一個 id。
  deviceBinding.deviceIdFor = () => "b".repeat(64);

  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation(), deviceBinding }
  });

  await assert.rejects(
    () =>
      handler.execute(
        fakeRequest({
          body: { username: "alice", password: "right" },
          headers: { "x-device-public-key": Buffer.from("some-key").toString("base64url") }
        })
      ),
    (error) => {
      // 少了這一步，申請者可以宣稱一個與自己金鑰無關的 id，之後那個 id 對應
      // 到誰的金鑰就說不準了。
      assert.equal(error.publicCode, "DEVICE_SIGNATURE_INVALID");
      return true;
    }
  );

  assert.deepEqual(deviceBinding.requested, []);
});

// --- 登入 vs 同時發生的裝置撤銷 ------------------------------------------------
//
// loginHandler 先讀版本號、再檢查設備狀態（順序見 loginHandler.js 的註解）。
// 這兩支測試逼出兩種可能的交錯，證明不管哪一種都不會有「剛被撤銷的裝置復活」
// 這件事——要嘛設備檢查追上撤銷、直接擋下登入，要嘛設備檢查沒追上，但簽出的
// token 帶著撤銷前的舊版本號，一過期或撤銷快照一刷新就作廢。

test("login vs concurrent device revoke: a revoke that lands before the device check fails the login closed", async () => {
  const versionGate = createDeferred();
  const bindingRow = {
    id: 11,
    device_id: DEVICE_ID,
    public_key: Buffer.from("stored-key"),
    status: "approved"
  };
  const deviceBinding = fakeDeviceBinding({ binding: bindingRow });

  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: {
      jwt: fakeJwt(),
      tokenRevocation: { async currentVersion() { return versionGate.promise; } },
      deviceBinding
    }
  });

  const resultPromise = handler.execute(
    fakeRequest({ body: { username: "alice", password: "right" } })
  );

  // 版本號還卡在讀取中，這時撤銷落地：狀態轉 revoked。這模擬的是「版本號讀到
  // 撤銷前的舊值，但緊接著的設備檢查會讀到撤銷後的新狀態」這種交錯。
  bindingRow.status = "revoked";
  versionGate.resolve(9);

  await assert.rejects(resultPromise, (error) => {
    // #verifyDevice 是在版本號之後才跑的，所以它看見的是撤銷後的狀態——登入
    // 直接被擋下，沒有任何 token 被簽出去。
    assert.equal(error.publicCode, "DEVICE_REVOKED");
    return true;
  });
});

test("login vs concurrent device revoke: a revoke that lands after the device check ships a token already stale, not a resurrected one", async () => {
  let version = 9;
  const verifyStarted = createDeferred();
  const verifyGate = createDeferred();

  const deviceBinding = fakeDeviceBinding();
  const baseVerifyRequest = deviceBinding.verifyRequest;
  deviceBinding.verifyRequest = async (request) => {
    // #verifyDevice 最後一次 await，也是簽出 token 前的最後一關：執行卡在
    // 這裡的期間，就是版本號已經讀走、但 token 還沒真正簽出去的那段窗口。
    verifyStarted.resolve();
    await verifyGate.promise;
    return baseVerifyRequest(request);
  };

  const jwt = fakeJwt();
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: true, user: SAMPLE_USER };
      }
    },
    services: {
      jwt,
      tokenRevocation: { async currentVersion() { return version; } },
      deviceBinding
    }
  });

  const resultPromise = handler.execute(
    fakeRequest({ body: { username: "alice", password: "right" } })
  );

  await verifyStarted.promise;
  // 撤銷此刻才真正落地——但登入早在設備檢查開始之前就把版本號讀走了，不會
  // 再重讀，所以這次撤銷追不上這次登入。
  version += 1;
  verifyGate.resolve();

  await resultPromise;

  const [issued] = jwt.issued;
  // 簽出的是撤銷**之前**的版本號，不是撤銷之後的新版本號——這裡不該看到 10。
  assert.equal(issued.options.version, 9);
  // 而現在的版本號已經是 10：這個剛簽出來的 token 立刻就對不上了。它不是一個
  // 逃過撤銷的 token，只是活得比撤銷本身短——撤銷快照一刷新，下一次用它就會
  // 被判成已撤銷（見 TokenRevocationService.isRevoked）。
  assert.equal(deviceBinding.verified.length, 1);
  assert.equal(version, 10);
});

test("login answers every failure with the same message, except an expired temporary password", async () => {
  // TEMPORARY_EXPIRED 刻意不收斂——它對正常使用者是一句可行動的話，攻擊者從
  // 中學不到東西（見 §3.4）。其餘原因才要逐一區分不出來，否則會告訴攻擊者
  // 哪些帳號存在、哪些已被鎖定。
  for (const reason of Object.values(AUTH_FAILURE).filter(
    (value) => value !== AUTH_FAILURE.TEMPORARY_EXPIRED
  )) {
    const { handler } = createHandler(LoginHandler, {
      userService: {
        async authenticate() {
          return { ok: false, reason };
        }
      },
      services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
    });

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

test("login gives an expired temporary password its own actionable message", async () => {
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.TEMPORARY_EXPIRED };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
  });

  await assert.rejects(
    () =>
      handler.execute({
        input: { body: { username: "alice", password: "whatever" } }
      }),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "TEMPORARY_PASSWORD_EXPIRED");
      assert.equal(error.publicCode, "TEMPORARY_PASSWORD_EXPIRED");
      assert.match(error.publicMessage, /聯絡管理員/);
      return true;
    }
  );
});

test("login records the real failure reason in the log", async () => {
  const { handler, logger } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.LOCKED };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
  });

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
  const { handler, logger } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
  });

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

test("login throttles repeated requests from the same client IP", async () => {
  const { handler, logger } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
  });
  const req = {
    ip: "203.0.113.9",
    input: { body: { username: "alice", password: "wrong" } }
  };
  const res = fakeRes();

  // 節流門檻是每個 IP 20 次／10 分鐘（見 loginHandler.js 的 LOGIN_IP_LIMIT）。
  // 用掉整個配額，每一次都應該正常打進 authenticate，回 401 而不是 429。
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(
      () => handler.execute(req, res),
      (error) => {
        assert.equal(error.statusCode, 401);
        return true;
      }
    );
  }

  // 第 21 次應該被節流擋下，連 authenticate 都不會打進去。
  await assert.rejects(
    () => handler.execute(req, res),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.code, "LOGIN_RATE_LIMITED");
      return true;
    }
  );

  assert.ok(res.headers["Retry-After"], "Retry-After header was not set");

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(
    logger.entries.some((entry) => entry.event === "auth.login.rate_limited"),
    "rate limit rejection was not logged"
  );
});

test("login throttle tracks each client IP independently", async () => {
  const { handler } = createHandler(LoginHandler, {
    userService: {
      async authenticate() {
        return { ok: false, reason: AUTH_FAILURE.BAD_PASSWORD };
      }
    },
    services: { jwt: fakeJwt(), tokenRevocation: fakeTokenRevocation() }
  });
  const requestFrom = (ip) => ({
    ip,
    input: { body: { username: "alice", password: "wrong" } }
  });
  const res = fakeRes();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(() => handler.execute(requestFrom("203.0.113.1"), res));
  }

  // 另一個 IP 沒有共用配額：第一次仍然正常打進 authenticate，回 401 而不是 429。
  await assert.rejects(
    () => handler.execute(requestFrom("203.0.113.2"), res),
    (error) => {
      assert.equal(error.statusCode, 401);
      return true;
    }
  );
});

test("logout revokes every token for the subject", async () => {
  const tokenRevocation = fakeTokenRevocation();
  const { handler } = createHandler(LogoutHandler, { services: { tokenRevocation } });

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
  const { handler } = createHandler(MeHandler, {
    userService: {
      async findActiveById(id) {
        queried.push(id);
        return SAMPLE_USER;
      }
    }
  });

  const response = await handler.execute({
    // claims 帶著一組過期的權限：token 是簽發當下的快照，回它等於讓已經被收回
    // 的權限繼續有效，直到 token 過期為止。
    auth: { claims: { sub: "7", roles: ["superuser"], permissions: ["*"] } }
  });

  assert.deepEqual(response.data, SAMPLE_USER);
  assert.deepEqual(queried, [7]);
});

test("me rejects a valid token whose account no longer exists", async () => {
  const { handler } = createHandler(MeHandler, {
    userService: {
      async findActiveById() {
        return null;
      }
    }
  });

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

// --- 續期 --------------------------------------------------------------------

// ver 預設跟 createRefreshHandler() 底下 fakeTokenRevocation 的預設版本號
// （9）對齊：這代表「這個 token 是在目前版本號下簽的」，也就是續期該會成功的
// 一般情況。故意讓版本號不一致時，測試會自己傳一個不同的 ver。
// refreshTokenHandler 不再自己驗簽——JwtDeviceAuthStrategy 在進 handler 之前
// 就做完了 JWT 驗證、撤銷檢查與設備簽章比對，見 jwtDeviceAuthStrategy.test.js。
// 這裡的 req.auth 直接給出那個 strategy 應該產出的形狀（claims 加
// deviceBinding），handler 自己的測試只管「拿到一個通過身份驗證的請求之後，
// 該不該真的換發」這件事。
const DEFAULT_BINDING = Object.freeze({
  id: 11,
  device_id: DEVICE_ID,
  public_key: Buffer.from("stored-key"),
  status: "approved"
});

function refreshRequest({
  sub = "7",
  ver = 9,
  // 預設是一個「兩小時前登入」的 session：還沒到八小時上限，續期該成功。
  authTime = NOW_SECONDS - 2 * 3600,
  deviceBinding = DEFAULT_BINDING
} = {}) {
  return {
    requestId: null,
    auth: {
      type: "jwt-device",
      claims: {
        sub,
        did: deviceBinding.device_id,
        ver,
        auth_time: authTime,
        roles: ["admin"],
        permissions: ["order.read"]
      },
      deviceBinding
    }
  };
}

function createRefreshHandler({
  deviceBinding,
  userService,
  jwt = fakeJwt(),
  tokenRevocation = fakeTokenRevocation({ version: 9 })
} = {}) {
  const { handler, logger } = createHandler(RefreshTokenHandler, {
    services: {
      jwt,
      tokenRevocation,
      deviceBinding: deviceBinding ?? fakeDeviceBinding()
    }
  });

  handler.userService = userService ?? {
    async findActiveById() {
      return SAMPLE_USER;
    }
  };

  return { handler, logger, jwt, tokenRevocation };
}

test("refresh issues a new token with freshly read roles and the current version", async () => {
  const deviceBinding = fakeDeviceBinding();
  const jwt = fakeJwt();
  const { handler } = createRefreshHandler({ deviceBinding, jwt });

  const response = await handler.execute(refreshRequest());

  assert.equal(response.data.token, "signed.jwt.token");
  assert.equal(response.data.expiresInSeconds, 7200);
  // refreshRequest 預設是「兩小時前登入」，所以絕對上限還剩六小時。回滿值
  // （八小時）的話，前端會在每次續期後都以為還有一整個上限，那個提醒就永遠
  // 不會出現——而這個欄位存在的唯一理由就是那個提醒。
  assert.equal(response.data.sessionExpiresInSeconds, 6 * 3600);

  const [issued] = jwt.issued;
  // roles/permissions 取自剛剛重讀的那一份，所以權限變更會在一次續期內生效。
  assert.deepEqual(issued.payload, {
    roles: ["admin"],
    permissions: ["order.read"],
    did: DEVICE_ID
  });
  // 版本號要重讀，否則新 token 會帶著舊版本，撤銷過的人可以一直換新的。
  //
  // authTime 相反，必須原封不動沿用——這一行就是絕對 session 上限的全部意義。
  // 改成「現在」的話每次背景續期都會把上限往後推，session 永遠不會到期，而
  // 症狀是「沒有人被登出」，不會有任何錯誤浮現。
  assert.deepEqual(issued.options, {
    subject: "7",
    version: 9,
    authTime: NOW_SECONDS - 2 * 3600
  });
  assert.deepEqual(deviceBinding.used, [11]);
});

test("refresh never reports a negative session remainder, even right on the boundary", async () => {
  const jwt = fakeJwt();
  // 起算點正好在八小時又三秒前。JwtAuthStrategy 是在這支 handler 開始之前才
  // 檢查的，中間隔著兩次查詢——剛好踩線進來的請求走到算剩餘那一行時已經超過
  // 了。不夾住的話這裡是 -3，會撞到 responseSchema 的 minimum: 0 變成 500，
  // 而使用者看到的是「伺服器錯誤」而不是「請重新登入」。
  const { handler } = createRefreshHandler({
    jwt,
    tokenRevocation: fakeTokenRevocation({ version: 9 })
  });

  const response = await handler.execute(
    refreshRequest({ ver: 9, authTime: NOW_SECONDS - (8 * 3600 + 3) })
  );

  assert.equal(response.data.sessionExpiresInSeconds, 0);
});

test("a disabled account cannot refresh, which is what ends its session", async () => {
  const { handler } = createRefreshHandler({
    userService: {
      async findActiveById() {
        // findActiveById 只回傳 status 為 active 的人。
        return null;
      }
    }
  });

  // 沒有絕對 session 上限，所以 session 不會自己過期。少了這個檢查，HR 把離職
  // 員工設成 disabled 之後，那個人已經開著的 session 會一直續期下去，永遠不死。
  await assert.rejects(
    () => handler.execute(refreshRequest()),
    (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, "USER_INACTIVE");
      return true;
    }
  );
});

// --- 續期 vs 同時發生的登出／裝置撤銷 ------------------------------------------
//
// findActiveById 是 JwtDeviceAuthStrategy 通過之後、簽出新 token 之前唯一
// 還在跑的一次額外查詢。這兩支測試把交錯點卡在這裡，證明版本號比對能抓住在
// 這段窗口裡發生的登出或裝置撤銷，而不會把一個已經被結束的 session 續回來——
// 即使 strategy 早就把「approved」的快照交給了 handler。

test("refresh vs concurrent logout: a logout that lands mid-refresh is not outrun", async () => {
  const findStarted = createDeferred();
  const findGate = createDeferred();

  const tokenRevocation = fakeTokenRevocation({ version: 9 });
  const { handler, logger } = createRefreshHandler({
    tokenRevocation,
    userService: {
      async findActiveById() {
        findStarted.resolve();
        await findGate.promise;
        return SAMPLE_USER;
      }
    }
  });

  const resultPromise = handler.execute(refreshRequest({ ver: 9 }));

  await findStarted.promise;
  // 這次續期完全不知情的登出，在它卡在 findActiveById 的時候發生並落地。
  await tokenRevocation.revoke("7", { reason: "logout" });
  findGate.resolve();

  await assert.rejects(resultPromise, (error) => {
    // claims.ver（9）已經追不上登出後的新版本號（10），續期整個被拒絕——
    // 而不是安靜地簽出一個蓋著新版本號、把登出繞過去的 token。
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, "TOKEN_VERSION_STALE");
    return true;
  });

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(logger.entries.some((entry) => entry.event === "auth.token.version_stale"));
});

test("refresh vs concurrent device revoke: the version check catches what the strategy's already-issued snapshot cannot", async () => {
  const findStarted = createDeferred();
  const findGate = createDeferred();

  const tokenRevocation = fakeTokenRevocation({ version: 9 });

  const { handler } = createRefreshHandler({
    tokenRevocation,
    userService: {
      async findActiveById() {
        findStarted.resolve();
        await findGate.promise;
        return SAMPLE_USER;
      }
    }
  });

  const resultPromise = handler.execute(refreshRequest({ ver: 9 }));

  await findStarted.promise;
  // 管理員這時撤銷了這台設備。JwtDeviceAuthStrategy 早就把 approved 讀走、
  // 把 deviceBinding 交給了 handler，不會回頭再檢查一次——抓住這次撤銷的
  // 只剩版本號比對。
  await tokenRevocation.revoke("7", { reason: "device_revoked" });
  findGate.resolve();

  await assert.rejects(resultPromise, (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, "TOKEN_VERSION_STALE");
    return true;
  });
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

  // 續期明確宣告 "jwt-device"，不是沿用預設的 "jwt"：JWT 驗證、撤銷檢查與
  // 設備簽章比對全部在 JwtDeviceAuthStrategy 裡完成，這支 handler 才會被
  // 呼叫。少了這個宣告——不管是漏寫還是誤寫回 "jwt"——設備簽章檢查會整個
  // 消失，續期端點就變成一台可以用任意已知使用者的 JWT 換新 token 的機器。
  assert.equal(RefreshTokenHandler.api.authType, "jwt-device");
  assert.equal(RefreshTokenHandler.api.authorizationPolicies, undefined);
});

test("login response schema does not leak the password hash", () => {
  const userSchema = LoginHandler.api.responseSchema[200].properties.user;

  // additionalProperties: false 是這個保證的實作——handler 多回一個欄位會被
  // 回應驗證擋下，而不是安靜地送出去。
  assert.equal(userSchema.additionalProperties, false);
  assert.ok(!("password_hash" in userSchema.properties));
  assert.ok(!("passwordHash" in userSchema.properties));
});
