import assert from "node:assert/strict";
import test from "node:test";
import { MyDevicesHandler } from "../src/handlers/device/myDevicesHandler.js";
import { PendingDevicesHandler } from "../src/handlers/device/pendingDevicesHandler.js";
import {
  ApproveDeviceHandler,
  RejectDeviceHandler,
  RevokeDeviceHandler
} from "../src/handlers/device/reviewDeviceHandlers.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 審批是設備綁定唯一有人在做決定的一步，也是整個方案唯一沒有自動兜底的地方
// （見 docs/device-binding-auth.md §5.3）。它錯的方式都很安靜：權限沒掛好就
// 人人可批、撤銷沒連帶撤 token 就等於慢 15 分鐘、競態沒處理就兩個審批者各自
// 看到「成功」而結果只有一個算數。

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };

  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function createHandler(HandlerClass, { deviceBinding, tokenRevocation } = {}) {
  const logger = collectingLogger();
  const available = {
    logging: { logger, loggers: {} },
    time: createTestTime(),
    mysqldatabase: {},
    deviceBinding,
    tokenRevocation
  };

  const handler = new HandlerClass({
    get: (name) => available[name],
    require(name) {
      if (!(name in available) || available[name] === undefined) {
        throw new Error(`Unexpected test service: ${name}`);
      }
      return available[name];
    }
  });

  return { handler, logger };
}

function fakeDeviceBinding({
  result = { id: 5, user_id: 7, status: "approved" },
  // RevokeDeviceHandler 先查一次現況再決定做唔做。同 result 分開，因為兩者
  // 答嘅係唔同問題：current 係「而家係咩狀態」，result 係「轉移之後係咩」。
  current = { id: 5, user_id: 7, status: "approved" },
  pending = [],
  mine = []
} = {}) {
  const calls = [];

  return {
    calls,
    async findById(id) {
      calls.push({ method: "findById", id });
      return current;
    },
    async listPending() {
      return pending;
    },
    async listForUser(userId) {
      calls.push({ method: "listForUser", userId });
      return mine;
    },
    async approve(id, options) {
      calls.push({ method: "approve", id, options });
      return result;
    },
    async reject(id, options) {
      calls.push({ method: "reject", id, options });
      return result;
    },
    async revoke(id, options) {
      calls.push({ method: "revoke", id, options });
      return result;
    }
  };
}

function fakeTokenRevocation() {
  const revoked = [];

  return {
    revoked,
    async revoke(subject, options) {
      revoked.push({ subject, options });
      return 2;
    }
  };
}

const reviewerRequest = (id = "5", body = {}) => ({
  input: { params: { id }, query: {}, body },
  auth: { claims: { sub: "3", permissions: ["device.approve"] } }
});

// --- 權限 --------------------------------------------------------------------

test("every review route demands device.approve, and the listing routes agree", () => {
  for (const HandlerClass of [
    PendingDevicesHandler,
    ApproveDeviceHandler,
    RejectDeviceHandler,
    RevokeDeviceHandler
  ]) {
    assert.deepEqual(
      HandlerClass.api.authorizationPolicies,
      [{ name: "hasPermission", options: { permissions: ["device.approve"] } }],
      HandlerClass.handlerName
    );
  }

  // 自己的設備清單刻意不覆寫：預設的 authenticated 就夠，因為它只回傳
  // claims.sub 自己的列、不收任何指定使用者的參數。「看別人的設備」在這支 API
  // 上根本不存在，不需要再靠一條授權規則去擋。
  assert.equal(MyDevicesHandler.api.authorizationPolicies, undefined);
});

test("approve, reject and revoke require a fresh password, not just a valid session", () => {
  for (const HandlerClass of [ApproveDeviceHandler, RejectDeviceHandler, RevokeDeviceHandler]) {
    // 核准會讓一台設備拿到長期存取權，撤銷會讓一個使用者所有 session 立刻
    // 失效——兩者都值得要求審批者當場再證明一次「現在仍然是我」。密碼本身
    // 的驗證邏輯在 jwtPasswordAuthStrategy.test.js。
    assert.equal(HandlerClass.api.authType, "jwt-password", HandlerClass.handlerName);
  }

  // 清單型的兩支路由不變：讀取不是這裡要多防的動作。
  assert.equal(PendingDevicesHandler.api.authType, undefined);
  assert.equal(MyDevicesHandler.api.authType, undefined);
});

test("the pending queue never exposes key material", () => {
  const item = PendingDevicesHandler.api.responseSchema[200].properties.items.items;

  // additionalProperties: false 是這個保證的實作——handler 多回一個欄位會被
  // 回應驗證擋下，而不是安靜地送出去。
  assert.equal(item.additionalProperties, false);
  assert.ok(!("publicKey" in item.properties));
  assert.ok(!("public_key" in item.properties));
});

// --- 審批動作 ----------------------------------------------------------------

test("approving and rejecting record who did it and any note", async () => {
  for (const [HandlerClass, method] of [
    [ApproveDeviceHandler, "approve"],
    [RejectDeviceHandler, "reject"]
  ]) {
    const deviceBinding = fakeDeviceBinding();
    const { handler } = createHandler(HandlerClass, { deviceBinding });

    const response = await handler.execute(reviewerRequest("5", { note: "已致電確認" }));

    assert.deepEqual(response.data, { id: 5, status: "approved" });
    assert.deepEqual(deviceBinding.calls, [
      // reviewerId 取自 token，不是 body：讓呼叫端自己說「我是誰」等於沒有稽核。
      { method, id: 5, options: { reviewerId: 3, note: "已致電確認" } }
    ]);
  }
});

test("an action that changed nothing is a conflict, not a success", async () => {
  for (const HandlerClass of [ApproveDeviceHandler, RejectDeviceHandler, RevokeDeviceHandler]) {
    const deviceBinding = fakeDeviceBinding({ result: null });
    const { handler } = createHandler(HandlerClass, {
      deviceBinding,
      tokenRevocation: fakeTokenRevocation()
    });

    // 兩個審批者同時開著佇列，一個按核准一個按拒絕：第二個必須知道自己撲空了。
    // 回 200 的話他會以為結果是他按的那個。
    await assert.rejects(
      () => handler.execute(reviewerRequest()),
      (error) => {
        assert.equal(error.statusCode, 409, HandlerClass.handlerName);
        assert.equal(error.publicCode, "DEVICE_BINDING_CONFLICT");
        return true;
      }
    );
  }
});

test("revoking a device also kills the tokens that device already holds", async () => {
  const deviceBinding = fakeDeviceBinding({
    result: { id: 5, user_id: 7, status: "revoked" }
  });
  const tokenRevocation = fakeTokenRevocation();
  const { handler, logger } = createHandler(RevokeDeviceHandler, {
    deviceBinding,
    tokenRevocation
  });

  await handler.execute(reviewerRequest());

  // 只改 status 的話，那台設備手上的 token 還能再用到自己過期為止。遺失電腦是
  // 分鐘級的事，撐不起 15 分鐘的窗。
  assert.deepEqual(tokenRevocation.revoked, [
    { subject: "7", options: { reason: "device_revoked" } }
  ]);

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(
    logger.entries.some((entry) => entry.event === "auth.device.revoked_sessions"),
    "the blast radius of a revoke has to be visible in the log"
  );
});

test("the token version is bumped before the status changes, not after", async () => {
  // 順序係承重嘅。反過來嘅話，轉狀態成功、撤 token 失敗，會留低一台狀態係
  // revoked 但 token 仲有效嘅設備——而重試會因為狀態唔再係 approved 而 409，
  // 永遠唔會補做。呢條測試釘住嗰個順序。
  const order = [];
  const deviceBinding = fakeDeviceBinding();
  const baseRevoke = deviceBinding.revoke;
  deviceBinding.revoke = async (id, options) => {
    order.push("status");
    return baseRevoke(id, options);
  };

  const tokenRevocation = fakeTokenRevocation();
  const baseTokenRevoke = tokenRevocation.revoke;
  tokenRevocation.revoke = async (subject, options) => {
    order.push("token-version");
    return baseTokenRevoke(subject, options);
  };

  const { handler } = createHandler(RevokeDeviceHandler, { deviceBinding, tokenRevocation });
  await handler.execute(reviewerRequest());

  assert.deepEqual(order, ["token-version", "status"]);
});

test("if the status change fails, the tokens are still revoked and a retry can finish the job", async () => {
  const deviceBinding = fakeDeviceBinding();
  deviceBinding.revoke = async () => {
    throw new Error("connection lost");
  };
  const tokenRevocation = fakeTokenRevocation();
  const { handler } = createHandler(RevokeDeviceHandler, { deviceBinding, tokenRevocation });

  await assert.rejects(() => handler.execute(reviewerRequest()), /connection lost/);

  // 多撤咗（token 已經冇效），但綁定仲係 approved——所以重試會完整重做一次。
  // 呢個方向係安全嘅：寧願多登出一次，都好過一台顯示已撤銷、實際仲用得嘅設備。
  assert.deepEqual(tokenRevocation.revoked, [
    { subject: "7", options: { reason: "device_revoked" } }
  ]);
});

test("if the token revoke fails, the binding is left approved so the retry is a full retry", async () => {
  const deviceBinding = fakeDeviceBinding();
  const tokenRevocation = fakeTokenRevocation();
  tokenRevocation.revoke = async () => {
    throw new Error("revocation table is down");
  };

  const { handler } = createHandler(RevokeDeviceHandler, { deviceBinding, tokenRevocation });

  await assert.rejects(() => handler.execute(reviewerRequest()), /revocation table is down/);

  // 狀態一定唔可以已經轉咗：轉咗嘅話重試會 409，而嗰次撤銷就永遠補唔返。
  assert.ok(
    !deviceBinding.calls.some(({ method }) => method === "revoke"),
    "the binding must not be transitioned when the token revoke failed"
  );
});

test("revoking a device that is already revoked is a conflict and does not log anyone out", async () => {
  const deviceBinding = fakeDeviceBinding({
    current: { id: 5, user_id: 7, status: "revoked" }
  });
  const tokenRevocation = fakeTokenRevocation();
  const { handler } = createHandler(RevokeDeviceHandler, { deviceBinding, tokenRevocation });

  await assert.rejects(
    () => handler.execute(reviewerRequest()),
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );

  // 冇呢個前置檢查嘅話，對一台早就撤銷咗嘅設備再撳一次，會喺乜都唔應該發生
  // 嘅情況下將嗰個使用者喺所有設備登出。
  assert.deepEqual(tokenRevocation.revoked, []);
  assert.ok(!deviceBinding.calls.some(({ method }) => method === "revoke"));
});

test("approving and rejecting do not touch token revocation", async () => {
  for (const HandlerClass of [ApproveDeviceHandler, RejectDeviceHandler]) {
    const { handler } = createHandler(HandlerClass, {
      deviceBinding: fakeDeviceBinding()
      // tokenRevocation 刻意不提供：這兩支 handler 要求它的話，這裡就會炸。
      // 核准一台新設備沒有理由把那個人在其他設備上登出。
    });

    await handler.execute(reviewerRequest());
  }
});

// --- 清單 --------------------------------------------------------------------

test("the pending queue maps rows to the shape the approver sees", async () => {
  const deviceBinding = fakeDeviceBinding({
    pending: [
      {
        id: 1,
        user_id: 7,
        username: "alice",
        display_name: "Alice",
        device_id: "a".repeat(64),
        label: "Sam 的辦公室桌機",
        requested_at: 1_700_000_000_000,
        requested_ip: "10.0.0.5",
        requested_ua: "Firefox"
      }
    ]
  });
  const { handler } = createHandler(PendingDevicesHandler, { deviceBinding });

  const response = await handler.execute({ input: { params: {}, query: {} } });

  assert.deepEqual(response.data, {
    items: [
      {
        id: 1,
        userId: 7,
        username: "alice",
        displayName: "Alice",
        deviceId: "a".repeat(64),
        label: "Sam 的辦公室桌機",
        requestedAt: 1_700_000_000_000,
        requestedIp: "10.0.0.5",
        requestedUserAgent: "Firefox"
      }
    ]
  });
});

test("my devices only ever asks for the caller's own rows", async () => {
  const deviceBinding = fakeDeviceBinding({
    mine: [
      {
        id: 1,
        device_id: "a".repeat(64),
        label: "桌機",
        status: "approved",
        requested_at: 1_700_000_000_000,
        requested_ip: "10.0.0.5",
        requested_ua: "Firefox",
        reviewed_at: 1_700_000_100_000,
        last_used_at: null
      }
    ]
  });
  const { handler } = createHandler(MyDevicesHandler, { deviceBinding });

  const response = await handler.execute({
    input: { params: {}, query: {} },
    auth: { claims: { sub: "7" } }
  });

  // userId 只可能來自 token。接受一個參數的話，這支 API 就變成「看任何人的
  // 設備」，而它是每個登入使用者都叫得動的。
  assert.deepEqual(deviceBinding.calls, [{ method: "listForUser", userId: 7 }]);
  // 從沒用過的設備 lastUsedAt 是 null，不是 0——0 會被畫面顯示成 1970 年。
  assert.equal(response.data.items[0].lastUsedAt, null);
  assert.equal(response.data.items[0].reviewedAt, 1_700_000_100_000);
});
