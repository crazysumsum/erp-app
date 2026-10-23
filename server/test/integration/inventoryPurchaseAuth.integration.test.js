import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import jwtSign from "jsonwebtoken";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { BaseRequestHandler } from "../../src/framework/api/BaseRequestHandler.js";
import { InventoryPostingService } from "../../src/modules/inventory/InventoryPostingService.js";
import { issuePurchaseReceiptContext } from "../../src/modules/inventory/InventoryPurchaseContext.js";
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
