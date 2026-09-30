import assert from "node:assert/strict";
import { mkdir, readdir, rm, mkdtemp, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BaseRequestHandler } from "../src/framework/api/BaseRequestHandler.js";
import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { fakeDatabaseOptions } from "../test-support/fakeMySqlPool.js";

// 這一組測試涵蓋的是「上傳／下載成功以外」的路徑：逾時、客戶端中斷、驗證
// 失敗、handler 失敗、重播。這些正是先前只測快樂路徑而漏掉的地方。

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);

const silentLogger = {
  debug: async () => {},
  info: async () => {},
  warn: async () => {},
  error: async () => {},
  flush: async () => {},
  isSensitiveField: () => false
};

function makeHandlers(uploadDirectory, disk = false, hold = null) {
  const uploadApi = {
    method: "POST",
    path: "/api/v1/documents",
    description: "Accept a document upload.",
    authType: "public",
    authorizationPolicies: [{ name: "allowAll", options: {} }],
    upload: {
      enabled: true,
      storageMode: disk ? "disk" : "memory",
      directory: uploadDirectory,
      maxFileSizeBytes: 4096,
      maxFieldSizeBytes: 128,
      maxFiles: 1,
      allowedMimeTypes: [disk ? "text/csv" : "application/pdf"]
    },
    ...(disk ? { timeoutMs: 150 } : {}),
    requestSchema: {
      body: {
        type: "object",
        required: ["title"],
        additionalProperties: false,
        properties: { title: { type: "string" }, note: { type: "string" } }
      }
    },
    responseSchema: { 201: { type: "object", additionalProperties: true } }
  };

  class UploadHandler extends BaseRequestHandler {
    static handlerName = "uploadDocument";
    static api = uploadApi;

    async execute(req) {
      return this.response({ files: req.files.length }, { statusCode: 201 });
    }
  }

  class FailingUploadHandler extends BaseRequestHandler {
    static handlerName = "uploadAndFail";
    static api = { ...uploadApi, path: "/api/v1/documents/failing" };

    async execute() {
      throw new Error("handler exploded after the file was stored");
    }
  }

  class IdempotentUploadHandler extends BaseRequestHandler {
    static handlerName = "uploadIdempotent";
    static api = {
      ...uploadApi,
      path: "/api/v1/documents/idempotent",
      idempotency: { enabled: true, ttlMs: 60000 }
    };

    async execute(req) {
      return this.response(
        { hash: req.files[0].contentHash },
        { statusCode: 201 }
      );
    }
  }

  class HeldUploadHandler extends BaseRequestHandler {
    static handlerName = "heldUpload";
    static api = { ...uploadApi, path: "/api/v1/documents/held", timeoutMs: 2000 };
    async execute(req) {
      hold?.entered();
      await hold?.wait;
      return this.response({ files: req.files.length }, { statusCode: 201 });
    }
  }

  class SlowDownloadHandler extends BaseRequestHandler {
    static handlerName = "slowDownload";
    static api = {
      method: "GET",
      path: "/api/v1/reports/:name",
      description: "Download a stored report slowly.",
      authType: "public",
      authorizationPolicies: [{ name: "allowAll", options: {} }],
      download: { enabled: true, root: uploadDirectory },
      // 短到一定會在串流途中觸發。
      timeoutMs: 150,
      requestSchema: {
        params: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string" } }
        }
      },
      responseSchema: { 200: { type: "object", additionalProperties: true } }
    };

    async execute(req) {
      return this.file({
        path: req.input.params.name,
        fileName: "report.pdf",
        contentType: "application/pdf"
      });
    }
  }

  return {
    UploadHandler,
    FailingUploadHandler,
    IdempotentUploadHandler,
    SlowDownloadHandler,
    HeldUploadHandler
  };
}

async function startApplication(t, { limits, disk = false, hold = null } = {}) {
  if (disk) await mkdir(path.resolve("server/storage"), { recursive: true });
  const uploadDirectory = await mkdtemp(path.join(disk ? path.resolve("server/storage") : os.tmpdir(), "erp-upload-fail-"));
  t.after(() => rm(uploadDirectory, { recursive: true, force: true }));

  const handlers = makeHandlers(uploadDirectory, disk, hold);
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: {
      ...source,
      application: { ...source.application, port: 0, shutdownTimeoutMs: 1000 },
      requestLimiter: { ...source.requestLimiter, ...limits },
      // 這裡測的是上傳與 idempotency 的互動，不是共享 store。假 pool 對每一句
      // SQL 都回成功，mysql adapter 在它上面等於沒有 idempotency。
      idempotency: { ...source.idempotency, storeAdapter: "memory" },
      ...(disk ? { api: { ...source.api, upload: { ...source.api.upload, diskTempDirectory: uploadDirectory, maxConcurrentDiskUploads: 1 } } } : {})
    },
    handlerRegistryOptions: {
      moduleUrls: ["virtual:fileTransferFailureModes"],
      moduleLoader: async () => handlers
    },
    logger: silentLogger,
    requestLogger: (_req, _res, next) => next(),
    serviceOptions: {
      mysqldatabase: fakeDatabaseOptions()
    },
    forceExit: () => {
      throw new Error("File transfer failure tests must not force exit");
    }
  });
  t.after(() => application.shutdown("test_cleanup"));

  const { url } = await application.start();
  return { url, uploadDirectory };
}

function form({ title = "Q3", note = null, file = PDF } = {}) {
  const data = new FormData();

  if (title !== null) {
    data.append("title", title);
  }

  if (note !== null) {
    data.append("note", note);
  }

  if (file !== null) {
    data.append("file", new Blob([file], { type: "application/pdf" }), "doc.pdf");
  }

  return data;
}

/**
 * 送出一個宣告了 Content-Length 卻只寫一部分就斷線的 multipart 請求，
 * 也就是最便宜的一種上傳中斷。
 */
function abortMidUpload(url, pathname) {
  return new Promise((resolve) => {
    const target = new URL(`${url}${pathname}`);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=----abortboundary",
          "content-length": "100000"
        }
      },
      () => {}
    );
    // 客戶端主動 destroy 會讓 socket 收到 ECONNRESET，測試不關心。
    req.on("error", () => {});
    req.write("------abortboundary\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nQ3\r\n");
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 30);
  });
}

test("a download that outlives its timeout does not crash the process", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);

  // 大到一定要分成多個 chunk 才送得完，客戶端刻意慢慢讀。
  const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(8 * 1024 * 1024, 0x20)]);
  await writeFile(path.join(uploadDirectory, "big.pdf"), big);

  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  // 框架的 processLifecycle 也掛著 uncaughtException，而它會關掉整個程序。
  // 這裡先接住，確認的是「計時器根本不該拋出例外」。
  process.on("uncaughtException", onUncaught);
  t.after(() => process.removeListener("uncaughtException", onUncaught));

  const response = await new Promise((resolve, reject) => {
    const target = new URL(`${url}/api/v1/reports/big.pdf`);
    const req = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname },
      resolve
    );
    req.on("error", reject);
    req.end();
  });

  assert.equal(response.statusCode, 200, "header 應在逾時之前就送出");

  let received = 0;
  let streamError = null;

  await new Promise((resolve) => {
    response.on("data", (chunk) => {
      received += chunk.length;
      // 停住不讀，讓傳輸拖過 150ms 的 route timeout。
      response.pause();
      setTimeout(() => response.resume(), 60);
    });
    response.on("error", (error) => {
      streamError = error;
      resolve();
    });
    response.on("end", resolve);
    response.on("close", resolve);
  });

  // 連線被中斷是預期行為：回應已經開始送，改不成 504 了。
  assert.ok(received < big.length, "逾時後不應把整個檔案送完");
  assert.ok(streamError !== null || received < big.length);
  assert.deepEqual(
    uncaught.map((error) => error.code),
    [],
    `逾時不得產生未捕捉例外，實際收到：${uncaught.map((e) => e.message).join(", ")}`
  );
});

test("an aborted upload releases its concurrency slot immediately", async (t) => {
  const { url } = await startApplication(t, {
    limits: { maxConcurrentRequests: 1, queueTimeoutMs: 1000 }
  });

  await abortMidUpload(url, "/api/v1/documents");
  // 中斷之後槽位必須立刻釋放。沒修好的話下一個請求會排到 queueTimeoutMs
  // 才拿到 429。
  const startedAt = Date.now();
  const response = await fetch(`${url}/api/v1/documents`, {
    method: "POST",
    body: form()
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.status, 201);
  assert.ok(elapsedMs < 800, `後續請求耗時 ${elapsedMs}ms，槽位沒有被釋放`);
});

test("a form field larger than the route limit is rejected, not silently truncated", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);

  const response = await fetch(`${url}/api/v1/documents`, {
    method: "POST",
    body: form({ note: "x".repeat(4096) })
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error.code, "UPLOAD_FIELD_TOO_LARGE");
  assert.deepEqual(await readdir(uploadDirectory), []);
});

test("a request that fails schema validation leaves no file behind", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);

  // title 是必填，缺了它會在檔案落盤之後才被 schema 擋下。
  const response = await fetch(`${url}/api/v1/documents`, {
    method: "POST",
    body: form({ title: null })
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "REQUEST_VALIDATION_FAILED");
  assert.deepEqual(await readdir(uploadDirectory), []);
});

test("a handler that throws leaves no file behind", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);

  const response = await fetch(`${url}/api/v1/documents/failing`, {
    method: "POST",
    body: form()
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await readdir(uploadDirectory), []);
});

test("a successful upload keeps its file", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);

  const response = await fetch(`${url}/api/v1/documents`, {
    method: "POST",
    body: form()
  });

  assert.equal(response.status, 201);
  assert.equal((await readdir(uploadDirectory)).length, 1, "成功的上傳不得被清掉");
});

test("reusing an idempotency key with a different file is a conflict", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);
  const send = (file) =>
    fetch(`${url}/api/v1/documents/idempotent`, {
      method: "POST",
      headers: { "Idempotency-Key": "same-key-different-file" },
      body: form({ file })
    });

  const first = await send(PDF);
  assert.equal(first.status, 201);

  // 文字欄位完全相同，只有檔案內容不同——指紋不含檔案時這裡會回 201 重播，
  // 客戶端會以為第二份檔案已經存下來了。
  const other = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x41)]);
  const second = await send(other);

  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(
    (await readdir(uploadDirectory)).length,
    1,
    "被判定為衝突的第二份檔案不得留在磁碟上"
  );
});

test("an idempotent replay does not leave the resent file behind", async (t) => {
  const { url, uploadDirectory } = await startApplication(t);
  const send = () =>
    fetch(`${url}/api/v1/documents/idempotent`, {
      method: "POST",
      headers: { "Idempotency-Key": "same-key-same-file" },
      body: form()
    });

  assert.equal((await send()).status, 201);

  const replay = await send();
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  // handler 沒有跑，重送的那一份沒有任何東西引用它。
  assert.equal((await readdir(uploadDirectory)).length, 1);
});


async function waitUntil(check) {
  const deadline = Date.now() + 2000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "Observable cleanup did not complete");
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
}

function csvForm(title = "Q3") {
  const body = new FormData();
  if (title !== null) body.append("title", title);
  body.append("file", new Blob(["sku,quantity\nA,1\n"], { type: "text/csv" }), "input.csv");
  return body;
}

test("TC-006 disk HTTP success, schema failure, handler failure and replay clean their request directories", async (t) => {
  const { url, uploadDirectory } = await startApplication(t, { disk: true });
  for (const [route, title, status, key] of [
    ["", "Q3", 201], ["", null, 400], ["/failing", "Q3", 500],
    ["/idempotent", "Q3", 201, "disk-replay-1"], ["/idempotent", "Q3", 201, "disk-replay-1"]
  ]) {
    const response = await fetch(`${url}/api/v1/documents${route}`, { method: "POST", body: csvForm(title),
      headers: key ? { "Idempotency-Key": key } : {} });
    assert.equal(response.status, status);
    await response.arrayBuffer();
    await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
  }
});

test("TC-006 disk HTTP partial disconnect releases capacity and removes the partial file", async (t) => {
  const { url, uploadDirectory } = await startApplication(t, { disk: true });
  const target = new URL(`${url}/api/v1/documents`);
  const request = httpRequest(target, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=abort-disk" } });
  request.on("error", () => {});
  request.write('--abort-disk\r\nContent-Disposition: form-data; name="file"; filename="input.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n');
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 1);
  request.destroy();
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
  const response = await fetch(`${url}/api/v1/documents`, { method: "POST", body: csvForm() });
  assert.equal(response.status, 201);
  await response.arrayBuffer();
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
});


test("TC-006 disk HTTP timeout and malformed multipart remove partial files", async (t) => {
  const { url, uploadDirectory } = await startApplication(t, { disk: true });
  let slowRequest;
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(new URL(`${url}/api/v1/documents`), { method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=slow-disk" } }, resolve);
    request.on("error", reject);
    request.write('--slow-disk\r\nContent-Disposition: form-data; name="file"; filename="input.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n');
    slowRequest = request;
  });
  assert.equal(response.statusCode, 504);
  response.resume();
  slowRequest.destroy();
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
  const malformed = await fetch(`${url}/api/v1/documents`, { method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=bad-disk" },
    body: '--bad-disk\r\nContent-Disposition: form-data; name="file"; filename="input.csv"\r\nContent-Type: text/csv\r\n\r\na,b\n' });
  assert.equal(malformed.status, 400);
  await malformed.arrayBuffer();
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
});


test("TC-006 disk capacity stays reserved until a delayed handler releases its file", async (t) => {
  let release;
  let entered;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const { url, uploadDirectory } = await startApplication(t, { disk: true, hold: { entered, wait } });
  t.after(release);
  const first = fetch(`${url}/api/v1/documents/held`, { method: "POST", body: csvForm() });
  await started;
  const second = await fetch(`${url}/api/v1/documents`, { method: "POST", body: csvForm() });
  assert.equal(second.status, 503);
  assert.equal(second.headers.get("retry-after"), "1");
  await second.arrayBuffer();
  release();
  assert.equal((await first).status, 201);
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
  const third = await fetch(`${url}/api/v1/documents`, { method: "POST", body: csvForm() });
  assert.equal(third.status, 201);
  await third.arrayBuffer();
  await waitUntil(async () => (await readdir(uploadDirectory)).length === 0);
});
