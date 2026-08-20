import assert from "node:assert/strict";
import test from "node:test";
import { DeviceBindingService } from "../src/services/deviceBinding/DeviceBindingService.js";
import { normalizeDeviceBindingConfig } from "../src/services/deviceBinding/normalizeDeviceBindingConfig.js";
import { createTestTime } from "../test-support/createTestTime.js";

// 設備簽章是續期機制唯一的憑證：它若形同虛設，被偷走的 JWT 就能自己無限續期
// 下去，而整個方案的安全性論證就沒有了。它的失效模式全都是安靜的——簽章格式
// 對不上、時效窗沒檢查、nonce 沒去重，症狀都只是「本來該被拒的請求過了」。
//
// 所以這裡一律用**真的** Web Crypto 金鑰簽名，而不是假的簽章字串：Web Crypto
// 產出 IEEE P1363，Node 對 EC 預設吃 DER，兩邊對不上的話每一份合法簽章都會被
// 判成無效——那是這個介面最容易踩的一顆雷，只有真金鑰測得出來。

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

async function generateDeviceKey({ namedCurve = "P-256" } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve },
    // extractable: false，與前端實際會用的一樣。公鑰不受這個旗標影響（規格規定
    // 非對稱金鑰的公鑰恆為可匯出），所以這一行同時驗證了設計依賴的那個前提：
    // 私鑰匯不出來，公鑰照樣送得到後端。
    false,
    ["sign", "verify"]
  );

  return {
    keyPair,
    spki: Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey))
  };
}

async function sign(keyPair, input) {
  return Buffer.from(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      Buffer.from(input)
    )
  );
}

/** 只實作這個 service 真正用到的那幾句 SQL，讓判斷邏輯確實被執行到。 */
function fakeDatabase({ devices = [], nonces = [] } = {}) {
  const state = {
    devices: devices.map((row) => ({ ...row })),
    nonces: new Map(nonces.map((nonce) => [nonce.nonce, nonce.expires_at])),
    queries: [],
    nextId: devices.length + 1
  };

  const run = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    state.queries.push({ sql: normalized, params });

    if (normalized.startsWith("INSERT INTO user_device_nonces")) {
      const [nonce, expiresAt] = params;

      if (state.nonces.has(nonce)) {
        throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
      }

      state.nonces.set(nonce, expiresAt);
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("DELETE FROM user_device_nonces")) {
      const [nowMs] = params;
      let removed = 0;

      for (const [nonce, expiresAt] of [...state.nonces]) {
        if (expiresAt <= nowMs) {
          state.nonces.delete(nonce);
          removed += 1;
        }
      }

      return [{ affectedRows: removed }];
    }

    if (normalized.startsWith("SELECT id, user_id, device_id")) {
      const [userId, deviceId] = params;
      const row = state.devices.find(
        (device) => device.user_id === userId && device.device_id === deviceId
      );
      return [row ? [{ ...row }] : []];
    }

    if (normalized.startsWith("INSERT INTO user_devices")) {
      const [userId, deviceId, publicKey, label, status, requestedAt, ip, ua] = params;
      state.devices.push({
        id: state.nextId,
        user_id: userId,
        device_id: deviceId,
        public_key: publicKey,
        label,
        status,
        requested_at: requestedAt,
        requested_ip: ip,
        requested_ua: ua,
        reviewed_at: null,
        reviewed_by: null,
        last_used_at: null
      });
      state.nextId += 1;
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE user_devices SET status")) {
      const [status, reviewedAt, reviewedBy, note, id, requiredStatus] = params;
      const row = state.devices.find(
        (device) => device.id === id && device.status === requiredStatus
      );

      if (!row) {
        return [{ affectedRows: 0 }];
      }

      Object.assign(row, {
        status,
        reviewed_at: reviewedAt,
        reviewed_by: reviewedBy,
        review_note: note
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE user_devices SET last_used_at")) {
      const [lastUsedAt, id] = params;
      const row = state.devices.find((device) => device.id === id);

      if (row) {
        row.last_used_at = lastUsedAt;
      }

      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (normalized.startsWith("DELETE FROM user_devices")) {
      const [pending, staleBefore, approved, unusedApprovedBefore, usedBefore] = params;
      const before = state.devices.length;

      state.devices = state.devices.filter((device) => {
        const stalePending =
          device.status === pending && device.requested_at <= staleBefore;
        const unusedApproved =
          device.status === approved &&
          device.last_used_at === null &&
          device.reviewed_at !== null &&
          device.reviewed_at <= unusedApprovedBefore;
        const staleUsed =
          device.last_used_at !== null && device.last_used_at <= usedBefore;

        return !(stalePending || unusedApproved || staleUsed);
      });

      return [{ affectedRows: before - state.devices.length }];
    }

    throw new Error(`Unexpected SQL: ${normalized}`);
  };

  return { state, query: run, execute: run };
}

function createService({ database = fakeDatabase(), config, logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const service = new DeviceBindingService({
    config: { deviceBinding: config ?? {} },
    services: {
      require: (name) =>
        ({ mysqldatabase: database, logging: { logger }, time })[name]
    }
  });

  return { service, database, logger };
}

/** 產生一份合法的簽名請求，讓每個測試只需要改動它想破壞的那一項。 */
async function signedRequest(service, keyPair, spki, overrides = {}) {
  const request = {
    publicKeyDer: spki,
    deviceId: service.deviceIdFor(spki),
    method: "POST",
    path: "/api/v1/user/login",
    bodyHash: service.bodyHash(Buffer.from('{"username":"sam"}')),
    timestamp: NOW_MS,
    nonce: "11111111-1111-4111-8111-111111111111",
    ...overrides
  };

  return {
    ...request,
    signature: await sign(keyPair, service.signingInput(request))
  };
}

// --- 與前端的格式契約 --------------------------------------------------------

// 前端簽的字串與後端重組的字串必須逐字元一樣。兩邊漂移的症狀是「每一次登入都
// 說簽章無效」，而錯誤訊息不會提到格式——所以兩邊各釘住同一個 golden 值。
//
// 對應的前端測試：client/test/framework/auth/deviceKey.test.js 裡同名的 golden。
// 改這個字串時兩條測試一定要一起改，否則就是一次會讓所有人登入不了的部署。
const GOLDEN_INPUT =
  '{"bodyHash":"Xr4t8g","deviceId":"aaaa","method":"POST","nonce":"n-1","path":"/api/v1/user/login","timestamp":1755600000000}';

test("the signing input matches the format the client signs, byte for byte", () => {
  const { service } = createService();

  assert.equal(
    service.signingInput({
      bodyHash: "Xr4t8g",
      deviceId: "aaaa",
      method: "POST",
      nonce: "n-1",
      path: "/api/v1/user/login",
      timestamp: 1755600000000
    }),
    GOLDEN_INPUT
  );

  // 鍵順序不能跟著呼叫端傳入的順序走：物件實字的鍵是插入順序，若實作改成
  // 直接 JSON.stringify(input)，同一個請求在兩邊就會算出不同的字串。
  assert.equal(
    service.signingInput({
      timestamp: 1755600000000,
      path: "/api/v1/user/login",
      nonce: "n-1",
      method: "POST",
      deviceId: "aaaa",
      bodyHash: "Xr4t8g"
    }),
    GOLDEN_INPUT
  );
});

// --- 簽章驗證 ----------------------------------------------------------------

test("a genuine Web Crypto signature verifies, proving the P1363 encoding is handled", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();

  const result = await service.verifyRequest(await signedRequest(service, keyPair, spki));

  // 這一條若失敗而其他都過，答案幾乎一定是 dsaEncoding 沒設成 ieee-p1363：
  // Node 對 EC 預設吃 DER，而瀏覽器產出的是 r||s。
  assert.deepEqual(result, { ok: true });
});

test("the device id is the SHA-256 thumbprint of the public key, so it cannot be chosen", async () => {
  const { service } = createService();
  const { spki } = await generateDeviceKey();
  const other = await generateDeviceKey();

  assert.match(service.deviceIdFor(spki), /^[0-9a-f]{64}$/);
  assert.equal(service.deviceIdFor(spki), service.deviceIdFor(Buffer.from(spki)));
  assert.notEqual(service.deviceIdFor(spki), service.deviceIdFor(other.spki));
});

test("a signature made for one request is rejected on another", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  // 簽章若沒有覆蓋 method / path / bodyHash，它就只證明「這台設備某個時候簽過
  // 東西」，攻擊者可以把一份合法簽章原樣搬到一個他自己編的請求上。
  for (const tamper of [
    { method: "DELETE" },
    { path: "/api/v1/user/token/refresh" },
    { bodyHash: service.bodyHash(Buffer.from('{"username":"root"}')) }
  ]) {
    const result = await service.verifyRequest({ ...request, ...tamper });
    assert.deepEqual(result, { ok: false, reason: "signature_invalid" }, JSON.stringify(tamper));
  }
});

test("a malformed signature is rejected rather than thrown out of verifyRequest", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  // P-256 的 P1363 簽章固定 64 bytes。長度不對時 Node 的 verify 會直接拋，而不是
  // 回 false——沒接住的話，一個畸形的 header 就變成 500 而不是 400，還會在日誌
  // 留下一個看起來像伺服器出錯的堆疊。
  for (const signature of [Buffer.alloc(0), Buffer.alloc(10), Buffer.alloc(200)]) {
    const result = await service.verifyRequest({ ...request, signature });
    assert.deepEqual(result, { ok: false, reason: "signature_invalid" }, `${signature.length} bytes`);
  }
});

test("a signature from a different key is rejected", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const attacker = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  const result = await service.verifyRequest({
    ...request,
    publicKeyDer: attacker.spki,
    deviceId: service.deviceIdFor(attacker.spki)
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature_invalid");
});

// --- 時效窗 ------------------------------------------------------------------

test("timestamps outside the skew window are rejected in both directions", async () => {
  const { service } = createService({ config: { signatureMaxSkewSeconds: 60 } });
  const { keyPair, spki } = await generateDeviceKey();

  for (const offsetMs of [-61_000, 61_000]) {
    const request = await signedRequest(service, keyPair, spki, {
      timestamp: NOW_MS + offsetMs
    });
    const result = await service.verifyRequest(request);
    assert.deepEqual(result, { ok: false, reason: "timestamp_stale" }, `offset ${offsetMs}`);
  }

  // 未來方向也要擋：只檢查「太舊」的話，攻擊者送一個遠在未來的 timestamp 就能
  // 讓同一份簽章的可用時間無限延長。
  const inWindow = await signedRequest(service, keyPair, spki, {
    timestamp: NOW_MS + 59_000
  });
  assert.equal((await service.verifyRequest(inWindow)).ok, true);
});

// --- 重放 --------------------------------------------------------------------

test("replaying the same nonce is rejected the second time", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  assert.equal((await service.verifyRequest(request)).ok, true);

  // 一字不改地重送——簽章仍然合法，時效窗仍然有效。擋住它的只有 nonce。
  const replay = await service.verifyRequest(request);
  assert.deepEqual(replay, { ok: false, reason: "nonce_replayed" });
});

test("a bad signature never reaches the nonce table", async () => {
  const { service, database } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  await service.verifyRequest({ ...request, method: "DELETE" });

  // nonce 排在簽章之後是刻意的：放在前面的話，任何人都能用一堆沒有簽章的垃圾
  // 請求往這張表灌資料。
  assert.equal(database.state.nonces.size, 0);
  assert.equal(
    database.state.queries.some((entry) => entry.sql.includes("user_device_nonces")),
    false
  );
});

test("a missing nonce is rejected before any crypto work", async () => {
  const { service } = createService();
  const { keyPair, spki } = await generateDeviceKey();
  const request = await signedRequest(service, keyPair, spki);

  assert.deepEqual(await service.verifyRequest({ ...request, nonce: "  " }), {
    ok: false,
    reason: "nonce_missing"
  });
});

// --- 金鑰型別 ----------------------------------------------------------------

test("keys that are not on the configured curve are rejected", async () => {
  const { service } = createService({ config: { namedCurve: "P-256" } });
  const { keyPair, spki } = await generateDeviceKey({ namedCurve: "P-384" });
  const request = await signedRequest(service, keyPair, spki);

  // 少了曲線檢查，任何人都能拿一條他自己挑的曲線來註冊設備——驗簽照樣會過，
  // 因為那是他自己的金鑰，但整個方案對「金鑰有多強」就失去了控制。
  const result = await service.verifyRequest(request);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "public_key_invalid");
  assert.match(result.detail, /P-256/);
});

test("a non-EC key is rejected", async () => {
  const { service } = createService();
  const rsa = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const spki = Buffer.from(await crypto.subtle.exportKey("spki", rsa.publicKey));

  const result = await service.verifyRequest({
    publicKeyDer: spki,
    deviceId: service.deviceIdFor(spki),
    method: "POST",
    path: "/x",
    bodyHash: "",
    timestamp: NOW_MS,
    nonce: "22222222-2222-4222-8222-222222222222",
    signature: Buffer.alloc(64)
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "public_key_invalid");
  assert.match(result.detail, /EC key/);
});

// --- 綁定的生命週期 ----------------------------------------------------------

test("requesting a binding twice does not create a second row or overwrite the first", async () => {
  const { service, database } = createService();
  const { spki } = await generateDeviceKey();
  const deviceId = service.deviceIdFor(spki);

  const first = await service.requestBinding({
    userId: 7,
    deviceId,
    publicKeyDer: spki,
    label: "Sam 的辦公室桌機",
    ip: "10.0.0.5",
    userAgent: "Firefox"
  });

  const second = await service.requestBinding({
    userId: 7,
    deviceId,
    publicKeyDer: spki,
    label: "改個名字試試",
    ip: "10.0.0.9",
    userAgent: "Chrome"
  });

  assert.equal(database.state.devices.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(second.label, "Sam 的辦公室桌機");
  assert.equal(second.status, "pending");
});

test("approving writes reviewed_at, without which the row can never be purged", async () => {
  const database = fakeDatabase({
    devices: [
      {
        id: 1,
        user_id: 7,
        device_id: "a".repeat(64),
        status: "pending",
        requested_at: NOW_MS,
        reviewed_at: null,
        last_used_at: null
      }
    ]
  });
  const { service } = createService({ database });

  assert.equal(await service.approve(1, { reviewerId: 3, note: "new laptop" }), true);

  const row = database.state.devices[0];
  assert.equal(row.status, "approved");
  // 清理規則二靠 reviewed_at 判斷年齡，規則三靠 last_used_at。兩欄都是 NULL 的
  // 列會同時逃過兩條規則，變成永遠清不掉的孤兒。
  assert.equal(row.reviewed_at, NOW_MS);
  assert.equal(row.reviewed_by, 3);
});

test("approving anything that is not pending reports failure instead of reviving it", async () => {
  const database = fakeDatabase({
    devices: [
      { id: 1, user_id: 7, device_id: "b".repeat(64), status: "revoked", requested_at: NOW_MS, reviewed_at: NOW_MS, last_used_at: NOW_MS }
    ]
  });
  const { service } = createService({ database });

  assert.equal(await service.approve(1), false);
  assert.equal(await service.approve(999), false);
  assert.equal(database.state.devices[0].status, "revoked");
});

// --- 清理 --------------------------------------------------------------------

test("the three purge rules keep what they should and drop what they should", async () => {
  const day = 86_400_000;
  const database = fakeDatabase({
    devices: [
      // 規則 1：pending 超過 30 天 → 刪
      { id: 1, status: "pending", requested_at: NOW_MS - 31 * day, reviewed_at: null, last_used_at: null },
      // 規則 1 的另一邊：還沒滿 30 天 → 留
      { id: 2, status: "pending", requested_at: NOW_MS - 29 * day, reviewed_at: null, last_used_at: null },
      // 規則 2：核准超過 14 天但從未使用 → 刪
      { id: 3, status: "approved", requested_at: NOW_MS - 40 * day, reviewed_at: NOW_MS - 15 * day, last_used_at: null },
      // 規則 2 的另一邊：核准未滿 14 天 → 留
      { id: 4, status: "approved", requested_at: NOW_MS - 40 * day, reviewed_at: NOW_MS - 13 * day, last_used_at: null },
      // 規則 3：用過但超過 30 天沒用 → 刪
      { id: 5, status: "approved", requested_at: NOW_MS - 90 * day, reviewed_at: NOW_MS - 90 * day, last_used_at: NOW_MS - 31 * day },
      // 使用中的設備：last_used_at 每次續期都會更新，永遠碰不到規則 3
      { id: 6, status: "approved", requested_at: NOW_MS - 90 * day, reviewed_at: NOW_MS - 90 * day, last_used_at: NOW_MS - 60_000 },
      // 規則 3 不分狀態，撤銷過的用過設備一樣刪
      { id: 7, status: "revoked", requested_at: NOW_MS - 90 * day, reviewed_at: NOW_MS - 60 * day, last_used_at: NOW_MS - 31 * day },
      // 刻意留下的縫：rejected 且從未使用過，不落在任何一條規則 → 永久保留，
      // 這樣同一把金鑰再來申請時，審批者看得到它有前科。
      { id: 8, status: "rejected", requested_at: NOW_MS - 400 * day, reviewed_at: NOW_MS - 400 * day, last_used_at: null }
    ]
  });
  const { service } = createService({ database });

  const removed = await service.purgeStaleDevices();

  assert.equal(removed, 4);
  assert.deepEqual(
    database.state.devices.map((device) => device.id).sort((a, b) => a - b),
    [2, 4, 6, 8]
  );
});

test("expired nonces are purged and live ones are kept", async () => {
  const database = fakeDatabase({
    nonces: [
      { nonce: "expired", expires_at: NOW_MS - 1 },
      { nonce: "live", expires_at: NOW_MS + 60_000 }
    ]
  });
  const { service } = createService({ database });

  assert.equal(await service.purgeNonces(), 1);
  assert.deepEqual([...database.state.nonces.keys()], ["live"]);
});

// --- 設定 --------------------------------------------------------------------

test("a nonce retention shorter than the skew window fails startup", () => {
  // 一個 timestamp 為 T 的簽章在 T + skew 之前都還會被接受。nonce 若比那個時點
  // 早刪掉，同一份請求在剩下的窗裡重放就會成功——防重放漏掉一個尾巴，而且完全
  // 沒有症狀：日誌上看不出差別，被重放的請求跟正常請求長得一模一樣。
  assert.throws(
    () =>
      normalizeDeviceBindingConfig({
        signatureMaxSkewSeconds: 120,
        nonceRetentionSeconds: 60
      }),
    /nonceRetentionSeconds.*must be at least.*signatureMaxSkewSeconds/s
  );

  assert.doesNotThrow(() =>
    normalizeDeviceBindingConfig({
      signatureMaxSkewSeconds: 60,
      nonceRetentionSeconds: 60
    })
  );
});

test("unknown curves and hashes are rejected at startup, not at first verification", () => {
  assert.throws(
    () => normalizeDeviceBindingConfig({ namedCurve: "P-224" }),
    /namedCurve/
  );
  assert.throws(
    () => normalizeDeviceBindingConfig({ hashAlgorithm: "md5" }),
    /hashAlgorithm/
  );
  assert.throws(() => normalizeDeviceBindingConfig(null), /must be an object/);
  assert.throws(
    () => normalizeDeviceBindingConfig({ signatureMaxSkewSeconds: 0 }),
    /positive integer/
  );
});
