import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import test from "node:test";
import jwtSign from "jsonwebtoken";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { BaseRequestHandler } from "../../src/framework/api/BaseRequestHandler.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReceiptContext, issuePurchaseReversalContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
import { hashPassword } from "../../src/modules/user/passwordHash.js";
import { purchaseNativeFixture, purchaseConfirmedLines } from "../../test-support/inventoryPurchaseFixtures.js";

const native = process.env.DB_INTEGRATION_TESTS === "1" && process.env.INVENTORY_PURCHASE_TESTS === "1" ? test : test.skip;

native("Purchase real HTTP/JWT receipt boundary", async t => {
  const f = await purchaseNativeFixture(t, { fullSchema: true }), template = f.command();
  // Consumer harness: only server-owned confirmed projection enters the issuer. No production route is added.
  class ConfirmPurchase extends BaseRequestHandler {
    static handlerName = "purchaseProviderAuthProbe";
    static api = { method: "POST", path: "/api/v1/goods-receipts/:id/confirm", authType: "jwt", description: "Test-only Purchasing consumer contract.",
      authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["purchasing.view", "receiving.operation"] } }], idempotency: { enabled: false },
      requestSchema: { params: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        query: { type: "object", additionalProperties: false }, body: { type: "object", additionalProperties: false } },
      responseSchema: { 200: { type: "object", additionalProperties: true } } };
    async execute(req) {
      const database = this.services.require("mysqldatabase"), time = this.services.require("time"), jwt = this.services.require("jwt");
      const command = structuredClone(template);
      command.actor = { userId: Number(req.auth.claims.sub), serviceName: "", claimedRoles: req.auth.claims.roles,
        claimedPermissions: req.auth.claims.permissions };
      const provider = new InventoryPostingService({ database, time, logger: this.services.require("logging").logger });
      const result = await database.withTransaction(tx => {
        command.context = issuePurchaseReceiptContext(req, tx, command, purchaseConfirmedLines(template),
          { database, time, sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds });
        return provider.postPurchaseReceiptBatchInTransaction(tx, command);
      });
      return this.response(result);
    }
  }
  const source = defaultConfigurationSource(), secret = randomBytes(32).toString("hex");
  const application = await createApplication({ configurationSource: { ...source,
    application: { ...source.application, port: 0 }, database: { ...source.database, database: f.name },
    jwt: { ...source.jwt, secret } },
    handlerRegistryOptions: { moduleUrls: ["purchase-provider-test-only"], moduleLoader: async () => ({ ConfirmPurchase }) } });
  f.beforeCleanup.push(() => application.shutdown("purchase_auth_complete"));
  const jwt = application.services.require("jwt"), { url } = await application.start();
  const issue = (extra = {}, permissions = f.actor.claimedPermissions) => jwt.issue({ roles: f.actor.claimedRoles, permissions, ...extra },
    { subject: String(f.actor.userId), version: 0, authTime: Math.floor(Date.now() / 1000) });
  const request = async token => {
    const response = await fetch(`${url}/api/v1/goods-receipts/42/confirm`, { method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: "{}" });
    return { status: response.status, body: await response.json() };
  };
  const noInventoryEffect = async () => {
    const [[row]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_operation_requests"); assert.equal(row.count, 0);
  };
  await t.test("H01 missing JWT", async () => { assert.equal((await request()).status, 401); await noInventoryEffect(); });
  await t.test("H02 invalid signature", async () => {
    const token = issue(), parts = token.split("."); parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
    assert.equal((await request(parts.join("."))).status, 401); await noInventoryEffect();
  });
  await t.test("H03 expired signed JWT", async () => {
    const token = jwtSign.sign({ sub: String(f.actor.userId), ver: 0, auth_time: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) - 60, roles: f.actor.claimedRoles, permissions: f.actor.claimedPermissions }, secret,
    { algorithm: source.jwt.algorithm, issuer: source.jwt.issuer, audience: source.jwt.audience });
    assert.equal((await request(token)).status, 401); await noInventoryEffect();
  });
  await t.test("H04 password-change gate", async () => { assert.equal((await request(issue({ mcp: true }))).status, 403); await noInventoryEffect(); });
  await t.test("H05 missing receiving permission", async () => {
    assert.equal((await request(issue({}, ["purchasing.view"]))).status, 403); await noInventoryEffect();
  });
  let original;
  await t.test("H06 valid receiving role without inventory.view", async () => {
    original = await request(issue()); assert.equal(original.status, 200, JSON.stringify(original));
    assert.equal(original.body.data.status, "POSTED");
    const [[row]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_movements"); assert.equal(row.count, 1);
  });
  await t.test("H07 fresh signed replay returns original and no additional Movement", async () => {
    const result = await request(issue()); assert.equal(result.status, 200); assert.deepEqual(result.body.data, original.body.data);
    const [[row]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_movements"); assert.equal(row.count, 1);
  });
  await t.test("H08 current DB token revocation rejects otherwise valid replay", async () => {
    const token = issue(); await f.db.execute("INSERT INTO fr_token_versions(subject,version,updated_at) VALUES(?,1,?)", [String(f.actor.userId), Date.now()]);
    assert.equal((await request(token)).status, 401);
    const [[row]] = await f.db.query("SELECT COUNT(*) AS count FROM inventory_movements"); assert.equal(row.count, 1);
  });
});

native("Purchase real HTTP/JWT/device/password partial reversal boundary and consumer FK order", async t => {
  const f = await purchaseNativeFixture(t, { fullSchema: true }), receipt = f.command();
  const original = await f.withRequest(receipt, (tx, req) => {
    receipt.context = issuePurchaseReceiptContext(req, tx, receipt, purchaseConfirmedLines(receipt), f.options);
    return new InventoryPostingService(f).postPurchaseReceiptBatchInTransaction(tx, receipt);
  });
  f.actor.claimedPermissions.push("inventory.adjust");
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'", [f.roleId]);
  let password = randomBytes(24).toString("hex");
  await f.db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), f.actor.userId]);
  // Test-owned consumer tables model locked original rows and post-result NOT NULL/FK inserts; no production Purchasing tables are written.
  await f.db.query("CREATE TABLE test_purchase_owner(id BIGINT UNSIGNED PRIMARY KEY,status VARCHAR(30) NOT NULL) ENGINE=InnoDB");
  await f.db.query(`CREATE TABLE test_purchase_owner_details(id BIGINT UNSIGNED PRIMARY KEY,owner_id BIGINT UNSIGNED NOT NULL,
    movement_id BIGINT UNSIGNED NOT NULL,FOREIGN KEY(owner_id) REFERENCES test_purchase_owner(id),FOREIGN KEY(movement_id) REFERENCES inventory_movements(id)) ENGINE=InnoDB`);
  await f.db.query(`CREATE TABLE test_purchase_reverse_headers(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,owner_id BIGINT UNSIGNED NOT NULL,
    event_id CHAR(36) NOT NULL UNIQUE,operation_id BIGINT UNSIGNED NOT NULL,result_summary JSON NOT NULL,
    FOREIGN KEY(owner_id) REFERENCES test_purchase_owner(id),FOREIGN KEY(operation_id) REFERENCES inventory_operation_requests(id)) ENGINE=InnoDB`);
  await f.db.query(`CREATE TABLE test_purchase_reverse_details(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,header_id BIGINT UNSIGNED NOT NULL,
    original_detail_id BIGINT UNSIGNED NOT NULL,movement_id BIGINT UNSIGNED NOT NULL,operation_id BIGINT UNSIGNED NOT NULL,
    FOREIGN KEY(header_id) REFERENCES test_purchase_reverse_headers(id),FOREIGN KEY(original_detail_id) REFERENCES test_purchase_owner_details(id),
    FOREIGN KEY(movement_id) REFERENCES inventory_movements(id),FOREIGN KEY(operation_id) REFERENCES inventory_operation_requests(id)) ENGINE=InnoDB`);
  await f.db.execute("INSERT INTO test_purchase_owner VALUES(42,'CONFIRMED')");
  await f.db.execute("INSERT INTO test_purchase_owner_details VALUES(81,42,?)", [original.lines[0].movementId]);
  const eventId = randomUUID(); let inventoryReturned = 0;
  class ReversePurchase extends BaseRequestHandler {
    static handlerName = "purchaseProviderReversalAuthProbe";
    static api = { method: "POST", path: "/api/v1/goods-receipts/:id/reversals/create", authType: "jwt-device-password",
      description: "Test-only Purchasing owner consumer.", idempotency: { enabled: false },
      authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["purchasing.view", "inventory.adjust"] } }],
      requestSchema: { params: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        query: { type: "object", additionalProperties: false }, body: { type: "object", properties: { password: { type: "string" } }, additionalProperties: false } },
      responseSchema: { 200: { type: "object", additionalProperties: true } } };
    async execute(req) {
      const database = this.services.require("mysqldatabase"), time = this.services.require("time"), jwt = this.services.require("jwt"), device = this.services.require("deviceBinding");
      const provider = new InventoryPostingService({ database, time, logger: this.services.require("logging").logger });
      const result = await database.withTransaction(async tx => {
        const [[owner]] = await tx.query("SELECT * FROM test_purchase_owner WHERE id=? FOR UPDATE", [req.input.params.id]);
        const [details] = await tx.query("SELECT * FROM test_purchase_owner_details WHERE owner_id=? ORDER BY id FOR UPDATE", [owner.id]);
        const command = { actor: { userId: Number(req.auth.claims.sub), serviceName: "", claimedRoles: req.auth.claims.roles,
          claimedPermissions: req.auth.claims.permissions }, correlationId: req.requestId,
        source: { documentId: String(owner.id), eventId }, goodsReceiptId: String(owner.id), reasonText: "Correct confirmed receipt",
        lines: details.map(row => ({ sourceLineId: String(row.id), originalSourceLineId: String(row.id), originalMovementId: Number(row.movement_id), baseQuantity: 1 })) };
        command.context = issuePurchaseReversalContext(req, tx, command, { database, time,
          sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds,
          signatureMaxSkewSeconds: device.config.deviceBinding.signatureMaxSkewSeconds,
          ownerProof: { goodsReceiptId: String(owner.id), status: owner.status, details: details.map(row => ({ sourceLineId: String(row.id),
            goodsReceiptId: String(row.owner_id), originalMovementId: Number(row.movement_id) })) } });
        const result = await provider.reversePurchaseReceiptBatchInTransaction(tx, command);
        assert.equal(result.status, "POSTED"); inventoryReturned++;
        const [[existing]] = await tx.query("SELECT id,result_summary FROM test_purchase_reverse_headers WHERE event_id=? FOR UPDATE", [eventId]);
        if (existing) {
          assert.deepEqual(typeof existing.result_summary === "string" ? JSON.parse(existing.result_summary) : existing.result_summary, result);
          return result;
        }
        const [header] = await tx.execute("INSERT INTO test_purchase_reverse_headers(owner_id,event_id,operation_id,result_summary) VALUES(?,?,?,?)",
          [owner.id, eventId, result.operationId, JSON.stringify(result)]);
        for (const line of result.lines) await tx.execute(`INSERT INTO test_purchase_reverse_details
          (header_id,original_detail_id,movement_id,operation_id) VALUES(?,?,?,?)`, [header.insertId, Number(line.sourceLineId), line.movementId, line.operationId]);
        await tx.execute("UPDATE test_purchase_owner SET status='PARTIALLY_REVERSED' WHERE id=?", [owner.id]);
        return result;
      });
      return this.response(result);
    }
  }
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 },
    database: { ...source.database, database: f.name }, jwt: { ...source.jwt, secret: randomBytes(32).toString("hex") } },
  handlerRegistryOptions: { moduleUrls: ["purchase-reversal-test-only"], moduleLoader: async () => ({ ReversePurchase }) } });
  f.beforeCleanup.push(() => application.shutdown("purchase_reversal_auth_complete"));
  const jwt = application.services.require("jwt"), device = application.services.require("deviceBinding"), { url } = await application.start();
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), publicKey = keys.publicKey.export({ type: "spki", format: "der" });
  const did = device.deviceIdFor(publicKey);
  const deviceId = await f.insert("INSERT INTO user_devices(user_id,device_id,public_key,status,requested_at) VALUES(?,?,?,'approved',?)",
    [f.actor.userId, did, publicKey, Date.now()]);
  const token = (permissions = f.actor.claimedPermissions) => jwt.issue({ roles: f.actor.claimedRoles, permissions, did },
    { subject: String(f.actor.userId), version: 0, authTime: Math.floor(Date.now() / 1000) });
  const path = "/api/v1/goods-receipts/42/reversals/create";
  const request = async ({ jwtToken = token(), body = { password }, signed = true, badSignature = false } = {}) => {
    const headers = { "Content-Type": "application/json", ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}) };
    if (signed) {
      const timestamp = Date.now(), nonce = randomUUID();
      const input = device.signingInput({ accessTokenHash: device.accessTokenHash(jwtToken), bodyHash: device.bodyHash(Buffer.from(JSON.stringify(body))),
        deviceId: did, method: "POST", nonce, path, timestamp });
      const signature = sign("sha256", Buffer.from(input), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
      if (badSignature) signature[0] ^= 1;
      Object.assign(headers, { "X-Device-Id": did, "X-Device-Timestamp": String(timestamp), "X-Device-Nonce": nonce,
        "X-Device-Signature": signature.toString("base64url") });
    }
    const response = await fetch(url + path, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const counts = async () => {
    const result = [];
    for (const table of ["inventory_movements", "inventory_operation_requests", "inventory_purchase_reversal_links", "test_purchase_reverse_headers", "test_purchase_reverse_details"]) {
      const [[row]] = await f.db.query(`SELECT COUNT(*) AS count FROM ${table}`); result.push(Number(row.count));
    }
    return result;
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ["inventory_stock_balances", "inventory_stock_controls", "inventory_movements", "inventory_operation_requests",
      "inventory_audit_logs", "inventory_purchase_reversal_links", "test_purchase_owner", "test_purchase_owner_details",
      "test_purchase_reverse_headers", "test_purchase_reverse_details"]) {
      [result[table]] = await f.db.query(`SELECT * FROM ${table} ORDER BY id`);
    }
    return result;
  };
  const rejected = async (options, status, code) => {
    const before = await snapshot(), response = await request(options); assert.equal(response.status, status, JSON.stringify(response));
    if (code) assert.equal(response.body.error.code, code);
    assert.deepEqual(await snapshot(), before); assert.ok(!JSON.stringify(response.body).includes(password));
  };
  await t.test("B01 missing JWT", () => rejected({ jwtToken: null, signed: false }, 401));
  await t.test("B02 missing device proof", () => rejected({ signed: false }, 400, "DEVICE_SIGNATURE_REQUIRED"));
  await t.test("B03 invalid real P256 signature", () => rejected({ badSignature: true }, 400, "DEVICE_SIGNATURE_INVALID"));
  await t.test("B04 missing password", () => rejected({ body: {} }, 400));
  await t.test("B05 wrong password", () => rejected({ body: { password: "wrong synthetic password" } }, 403));
  await t.test("B06 missing adjustment permission", () => rejected({ jwtToken: token(["purchasing.view", "receiving.operation"]) }, 403));
  await t.test("B07 browser cannot supply owner proof or original Movement", () => rejected({ body: { password, ownerProof: {}, originalMovementId: 999 } }, 400));
  await t.test("B08-FK real post-result consumer NOT NULL failure rolls back Inventory and consumer, same event remains retryable", async () => {
    const before = inventoryReturned;
    await f.db.query(`CREATE TRIGGER test_purchase_consumer_failure BEFORE INSERT ON test_purchase_reverse_details
      FOR EACH ROW SET NEW.movement_id=NULL`);
    try { await rejected({}, 500); assert.equal(inventoryReturned, before + 1); }
    finally { await f.db.query("DROP TRIGGER test_purchase_consumer_failure"); }
  });
  let posted;
  await t.test("B08 actual JWT/password/device success inserts real FK consumer rows after Inventory result", async () => {
    posted = await request(); assert.equal(posted.status, 200, JSON.stringify(posted));
    assert.deepEqual(await counts(), [2, 4, 1, 1, 1]);
    const [[row]] = await f.db.query(`SELECT d.original_detail_id,d.movement_id,d.operation_id FROM test_purchase_reverse_details d
      JOIN inventory_movements m ON m.id=d.movement_id JOIN inventory_operation_requests o ON o.id=d.operation_id`);
    assert.deepEqual([Number(row.original_detail_id), Number(row.movement_id), Number(row.operation_id)],
      [81, posted.body.data.lines[0].movementId, posted.body.data.lines[0].operationId]);
  });
  await t.test("B09 password rotation still requires fresh credential for exact original replay", async () => {
    const previous = password; password = randomBytes(24).toString("hex");
    await f.db.execute("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), f.actor.userId]);
    await rejected({ body: { password: previous } }, 403);
    const before = await snapshot(), replay = await request(); assert.equal(replay.status, 200, JSON.stringify(replay)); assert.deepEqual(replay.body.data, posted.body.data);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await counts(), [2, 4, 1, 1, 1]);
  });
  await t.test("B10 revoked real device rejects cached domain replay", async () => {
    await f.db.execute("UPDATE user_devices SET status='revoked' WHERE id=?", [deviceId]);
    try { await rejected({}, 403); } finally { await f.db.execute("UPDATE user_devices SET status='approved' WHERE id=?", [deviceId]); }
  });
  await t.test("B11 revoked current role permission rejects otherwise signed replay", async () => {
    await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.adjust'", [f.roleId]);
    try { await rejected({}, 403); } finally { await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.adjust'", [f.roleId]); }
  });
  await t.test("B12 revoked signed JWT rejects replay without extra effects", async () => {
    const old = token(); await application.services.require("tokenRevocation").revoke(String(f.actor.userId), { reason: "synthetic purchase reversal revocation" });
    await rejected({ jwtToken: old }, 401);
  });
});
