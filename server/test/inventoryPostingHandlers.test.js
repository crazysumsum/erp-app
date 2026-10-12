import assert from "node:assert/strict";
import test from "node:test";

import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import { PostInventoryIssueHandler, PostInventoryReceiptHandler } from "../src/handlers/inventory/postingHandlers.js";
import * as postingHandlers from "../src/handlers/inventory/postingHandlers.js";
import { InventoryPostingService } from "../src/modules/inventory/InventoryPostingService.js";

const SIGNED_AT = Date.parse("2026-10-07T04:00:00.000Z");
function reversalCommand(payload = {}) {
  return { actor: { userId: 7, serviceName: "", claimedRoles: ["operator"],
    claimedPermissions: ["inventory.view", "inventory.adjust"] },
  authorization: { purpose: "movement.reverse", requiredCallerPermission: "inventory.adjust" },
  source: { module: "INVENTORY", documentType: "REVERSAL", documentId: "R-1", eventId: "post-1" },
  correlationId: "request-1", payload: { movementId: 41, reasonText: "  Undo duplicate posting  ",
    expectedBalances: [{ balanceId: 502, expectedVersion: 7 }, { balanceId: 501, expectedVersion: 3 }], ...payload } };
}

test("REV032-INPUT canonical intent rejects coercion, missing/extra fields, unsafe IDs and duplicate versions", async () => {
  const { normalizeReversalCommand } = await import("../src/modules/inventory/inventoryReversalPosting.js");
  const tx = { query() {}, execute() {} };
  const normalized = normalizeReversalCommand(tx, reversalCommand());
  assert.equal(normalized.payload.reasonText, "Undo duplicate posting");
  assert.deepEqual(normalized.payload.expectedBalances, [{ balanceId: 501, expectedVersion: 3 }, { balanceId: 502, expectedVersion: 7 }]);
  assert.deepEqual(normalizeReversalCommand(tx, reversalCommand({ expectedBalances: normalized.payload.expectedBalances })), normalized);
  const invalid = [{ movementId: "41" }, { movementId: true }, { movementId: Number.MAX_SAFE_INTEGER + 1 },
    { reasonText: " " }, { reasonText: "x\u007fy" }, { reasonText: "中".repeat(167) }, { quantity: 1 },
    { expectedBalances: [] }, { expectedBalances: null },
    { expectedBalances: Array.from({ length: 201 }, (_, i) => ({ balanceId: i + 1, expectedVersion: 1 })) }];
  for (const field of ["balanceId", "expectedVersion"]) for (const value of ["1", true, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    invalid.push({ expectedBalances: [{ balanceId: 1, expectedVersion: 1, [field]: value }] });
  }
  invalid.push({ expectedBalances: [{ balanceId: 1, expectedVersion: 4_294_967_296 }] },
    { expectedBalances: [{ balanceId: 1, expectedVersion: 1, unknown: 1 }] },
    { expectedBalances: [{ balanceId: 1, expectedVersion: 1 }, { balanceId: 1, expectedVersion: 2 }] });
  for (const change of invalid) assert.throws(() => normalizeReversalCommand(tx, reversalCommand(change)), { code: "INVENTORY_INPUT_INVALID" });
  for (const field of ["movementId", "reasonText", "expectedBalances"]) {
    const input = reversalCommand(); delete input.payload[field];
    assert.throws(() => normalizeReversalCommand(tx, input), { code: "INVENTORY_INPUT_INVALID" });
  }
  assert.equal(normalizeReversalCommand(tx, reversalCommand({ expectedBalances: [{ balanceId: Number.MAX_SAFE_INTEGER, expectedVersion: 4_294_967_295 }] }))
    .payload.expectedBalances[0].expectedVersion, 4_294_967_295);
});

test("REV032-HTTP-BOUNDARY third fixed proof binds canonical original path, actor/device and exact reversal intent", async () => {
  const proof = await import("../src/modules/inventory/inventoryHighRiskContext.js");
  const fixture = highRiskHandler(postingHandlers.PostInventoryAdjustmentHandler);
  const command = reversalCommand({ reasonText: "Undo duplicate posting" });
  const request = () => { const req = fixture.request();
    req.apiRoute = { path: "/api/v1/inventory/movements/:id/reverse", authType: "jwt-device-password" };
    req.input.params = { id: "41" }; return req; };
  const issue = req => proof.issueInventoryHighRiskContext(req, command, fixture.handler.highRiskOptions);
  for (const params of [{}, { id: 41 }, { id: "041" }, { id: "42" }, { id: "41", extra: "x" }]) {
    const req = request(); req.input.params = params;
    assert.throws(() => issue(req), { code: "PERMISSION_STALE" });
  }
  const plain = request(); plain.auth.type = "jwt";
  assert.throws(() => issue(plain), { code: "PERMISSION_STALE" });
  const req = request(), context = issue(req);
  assert.equal(JSON.stringify(context), "{}");
  for (const forged of [{}, { ...context }, JSON.parse(JSON.stringify(context))]) {
    assert.throws(() => proof.consumeInventoryHighRiskContext(forged, command), { code: "PERMISSION_STALE" });
  }
  for (const changed of [reversalCommand({ ...command.payload, movementId: 42 }),
    { ...command, actor: { ...command.actor, userId: 8 } },
    { ...command, authorization: { ...command.authorization, purpose: "adjustment.post" } }]) {
    assert.throws(() => proof.consumeInventoryHighRiskContext(context, changed), { code: "PERMISSION_STALE" });
  }
  req.input.params.id = "42";
  const guard = proof.consumeInventoryHighRiskContext(context, command);
  await fixture.handler.inventory.database.withTransaction(tx => guard.check(tx, { locking: true }));
  assert.deepEqual(fixture.calls.map(call => /FROM (\w+)/u.exec(call.sql)[1]),
    ["users", "user_roles", "role_permissions", "user_devices", "fr_token_versions"]);
  assert.ok(fixture.calls.every(call => call.sql.includes("FOR SHARE")));
  assert.throws(() => proof.consumeInventoryHighRiskContext(context, command), { code: "PERMISSION_STALE" });
  assert.throws(() => issue(req), { code: "PERMISSION_STALE" });
});
function highRiskHandler(Handler) {
  let held = false, revoked = false;
  const deviceId = "a".repeat(64), permissions = ["inventory.view", "inventory.adjust"];
  const binding = { id: 5, user_id: 7, device_id: deviceId, status: "approved", public_key: Buffer.from("synthetic-key") };
  const calls = [];
  const tx = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM users")) return [[{ id: 7, username: "sam", status: "active" }]];
    if (sql.includes("FROM user_roles")) return [[{ role_id: 9, name: "operator" }]];
    if (sql.includes("FROM role_permissions")) return [permissions.map(name => ({ name }))];
    if (sql.includes("FROM user_devices")) return [[{ ...binding, status: revoked ? "revoked" : "approved" }]];
    if (sql.includes("FROM fr_token_versions")) return [[]];
    assert.fail(sql);
  }, execute() { assert.fail("preflight/replay is read-only"); } };
  const database = { async withTransaction(work) { held = true; try { return await work(tx); } finally { held = false; } } };
  const handler = new Handler({ require(name) {
    if (name === "mysqldatabase") return database;
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => SIGNED_AT, fileDate: () => "2026-10-07" };
    if (name === "jwt") return { sessionMaxAgeSeconds: 28800, config: { jwt: { clockToleranceSeconds: 5 } } };
    if (name === "deviceBinding") return { config: { deviceBinding: { signatureMaxSkewSeconds: 60 } } };
    throw new Error(name);
  } });
  handler.inventory.audit = { async recordRejected() {}, async recordFailed() {} };
  const body = { source: { module: "INVENTORY", documentType: "ADJUSTMENT", documentId: "A-1", eventId: "post-1" },
    password: "  original password  ", quantity: 2, uomId: 8, direction: "IN", warehouseId: 2, binId: 35, skuId: 12,
    stockStatus: "AVAILABLE", expectedBalanceVersion: null, reasonCategory: "COUNT_GAIN", reasonText: "  Physical count  " };
  const request = (input = body) => ({ method: "POST", apiRoute: Handler.api,
    auth: { type: "jwt-device-password", claims: { sub: "7", did: deviceId, roles: ["operator"], permissions,
      exp: Math.floor(SIGNED_AT / 1000) + 900, auth_time: Math.floor(SIGNED_AT / 1000), ver: 0 }, deviceBinding: binding },
    requestTimeout: { signal: new AbortController().signal }, get: () => String(SIGNED_AT),
    requestId: "request-1", input: { params: {}, query: {}, body: structuredClone(input) } });
  return { handler, request, body, calls, isHeld: () => held, revoke() { revoked = true; } };
}

test("REV032-HTTP-BOUNDARY fixed route validates raw canonical path, empty query and only complete current guards", () => {
  assert.equal(typeof postingHandlers.ReverseInventoryMovementHandler, "function");
  const api = postingHandlers.ReverseInventoryMovementHandler.api;
  assert.equal(api.path, "/api/v1/inventory/movements/:id/reverse");
  assert.equal(api.authType, "jwt-device-password");
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.adjust"]);
  assert.equal(api.inputCoercion, false); assert.equal(api.idempotencyPreparation, true);
  assert.deepEqual(api.idempotency, { enabled: true, ttlMs: 604800000 });
  const command = reversalCommand(); const { movementId, ...payload } = command.payload;
  const input = { params: { id: String(movementId) }, query: {}, body: { source: command.source, password: "synthetic", ...payload } };
  const validate = new RequestValidator().compile(api.requestSchema, api.path, { coerceTypes: false });
  validate(structuredClone(input));
  for (const id of [41, "041", "0", "-1", "1.0", " 41", "1e2"]) {
    assert.throws(() => validate({ ...input, params: { id } }), { code: "REQUEST_VALIDATION_FAILED" });
  }
  for (const change of [{ movementId: 41 }, { quantity: 2 }, { uomId: 1 }, { direction: "OUT" }, { proof: {} },
    { expectedBalances: [{ balanceId: "501", expectedVersion: 3 }] }, { expectedBalances: [{ balanceId: 501, expectedVersion: null }] }]) {
    assert.throws(() => validate({ ...input, body: { ...input.body, ...change } }), { code: "REQUEST_VALIDATION_FAILED" });
  }
  const response = new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  response(200, { status: "POSTED", operationId: 91, movementGroupId: "group", lineCount: 200 });
});

test("REV032-HTTP-REPLAY privately frozen credential-free path/intent preserves fresh locked replay and one-shot execution", async () => {
  assert.equal(typeof postingHandlers.ReverseInventoryMovementHandler, "function");
  const fixture = highRiskHandler(postingHandlers.ReverseInventoryMovementHandler);
  const command = reversalCommand(); const { movementId, ...payload } = command.payload;
  const request = (extra = {}) => { const req = fixture.request({ source: command.source, password: "synthetic", ...payload, ...extra });
    req.input.params = { id: String(movementId) }; return req; };
  for (const id of [41, "041", "9007199254740992", "0"]) {
    const req = request(); req.input.params.id = id;
    await assert.rejects(() => fixture.handler.prepareIdempotency(req), { code: "INVENTORY_INPUT_INVALID" });
  }
  await assert.rejects(() => fixture.handler.prepareIdempotency(request({ movementId: 42 })), { code: "INVENTORY_INPUT_INVALID" });
  const req = request(), prepared = await fixture.handler.prepareIdempotency(req);
  assert.equal(prepared.input.params.id, "41"); assert.ok(Object.isFrozen(prepared.input.body.expectedBalances[0]));
  assert.doesNotMatch(JSON.stringify(prepared.input), /password|signature|token|context|movementId/u);
  const equivalent = await fixture.handler.prepareIdempotency(request({ password: "changed password", expectedBalances: [...payload.expectedBalances].reverse() }));
  assert.deepEqual(equivalent.input, prepared.input);
  let sends = 0;
  await prepared.replay(() => { assert.equal(fixture.isHeld(), true); sends++; });
  assert.equal(sends, 1);
  fixture.revoke(); await assert.rejects(() => equivalent.replay(() => sends++), { code: "DEVICE_REVOKED" });
  assert.equal(sends, 1);
  const nextFixture = highRiskHandler(postingHandlers.ReverseInventoryMovementHandler);
  const next = nextFixture.request({ source: command.source, password: "synthetic", ...payload }); next.input.params = { id: "41" };
  await nextFixture.handler.prepareIdempotency(next); let captured;
  nextFixture.handler.inventory.reverseMovement = async (input, proof) => { captured = { input, proof }; return { status: "POSTED" }; };
  next.input.params.id = "42"; next.input.body.reasonText = "changed";
  await nextFixture.handler.execute(next);
  assert.equal(captured.input.payload.movementId, 41); assert.equal(captured.input.payload.reasonText, "Undo duplicate posting");
  assert.equal(JSON.stringify(captured.proof), "{}");
  await assert.rejects(() => nextFixture.handler.execute(next), { code: "PERMISSION_STALE" });
});

test("ADJ031-HTTP-BOUNDARY both fixed high-risk routes strictly validate single-op inputs and original versions", () => {
  for (const [Handler, path] of [[postingHandlers.PostInventoryAdjustmentHandler, "/api/v1/inventory/adjustments"],
    [postingHandlers.PostInventoryStatusTransferHandler, "/api/v1/inventory/status-transfers"]]) {
    const api = Handler.api;
    assert.equal(api.path, path);
    assert.equal(api.authType, "jwt-device-password");
    assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.adjust"]);
    assert.deepEqual(api.idempotency, { enabled: true, ttlMs: 604800000 });
    assert.equal(api.idempotencyPreparation, true);
    assert.equal(api.inputCoercion, false);
    const fixture = highRiskHandler(Handler);
    const body = path.endsWith("adjustments") ? fixture.body : { source: fixture.body.source, password: fixture.body.password,
      quantity: 2, uomId: 8, sourceBalanceId: 501, destinationStatus: "DAMAGED", expectedSourceVersion: 3,
      expectedDestinationVersion: null, reasonText: "Damage inspection" };
    const validate = new RequestValidator().compile(api.requestSchema, path, { coerceTypes: false });
    validate({ params: {}, query: {}, body: structuredClone(body) });
    for (const change of [{ quantity: "2" }, { uomId: true }, { firstReceiptDate: "2026-01-01" },
      { reasonCategory: "BAD" }, { sourceBalanceId: 3, direction: "OUT" }, { proof: {} }]) {
      assert.throws(() => validate({ params: {}, query: {}, body: { ...structuredClone(body), ...change } }), { code: "REQUEST_VALIDATION_FAILED" });
    }
    for (const field of ["password", "uomId", path.endsWith("adjustments") ? "expectedBalanceVersion" : "expectedDestinationVersion"]) {
      const invalid = structuredClone(body); delete invalid[field];
      assert.throws(() => validate({ params: {}, query: {}, body: invalid }), { code: "REQUEST_VALIDATION_FAILED" });
    }
    new ResponseValidator({ environment: "production" }).compile(api.responseSchema, path)(200, {
      status: "POSTED", operationId: 9, movementGroupId: "group", lineCount: 1, inputQuantity: 2,
      inputUom: { id: 8, code: "CASE" }, baseQuantity: 24, baseUom: { id: 5, code: "EA" }
    });
  }
});

test("ADJ031-HTTP-REPLAY preparation owns credential-free immutable input and sends only inside current security locks", async () => {
  const fixture = highRiskHandler(postingHandlers.PostInventoryAdjustmentHandler);
  const req = fixture.request();
  const prepared = await fixture.handler.prepareIdempotency(req);
  assert.equal(fixture.isHeld(), false);
  assert.ok(fixture.calls.every(call => !call.sql.includes("FOR SHARE")));
  assert.ok(Object.isFrozen(prepared.input.body.source));
  assert.doesNotMatch(JSON.stringify(prepared.input), /password|signature|token|context|original/u);
  assert.equal(req.input.body.password, fixture.body.password);
  assert.equal(prepared.input.body.reasonText, "Physical count");
  req.input.body.quantity = 999;
  let sends = 0;
  await prepared.replay(() => { assert.equal(fixture.isHeld(), true); sends++; });
  assert.equal(sends, 1);
  await assert.rejects(() => prepared.replay(() => sends++), { code: "PERMISSION_STALE" });
  const second = await fixture.handler.prepareIdempotency(fixture.request({ ...fixture.body, password: "changed password" }));
  assert.deepEqual(second.input, prepared.input);
  fixture.revoke();
  await assert.rejects(() => second.replay(() => sends++), { code: "DEVICE_REVOKED" });
  assert.equal(sends, 1);
});

test("ADJ031-HTTP-BOUNDARY own normalization still rejects invalid business input without framework validation", async () => {
  const fixture = highRiskHandler(postingHandlers.PostInventoryAdjustmentHandler);
  for (const change of [{ quantity: "2" }, { uomId: undefined }, { reasonText: " " }, { lotId: 601 },
    { expectedBalanceVersion: undefined }, { password: "" }, { source: { ...fixture.body.source, unknown: "secret" } }]) {
    await assert.rejects(() => fixture.handler.prepareIdempotency(fixture.request({ ...fixture.body, ...change })),
      error => ["INVENTORY_INPUT_INVALID", "INVENTORY_QUANTITY_INVALID"].includes(error.code));
  }
  const req = fixture.request(); req.input.query = { unexpected: "value" };
  await assert.rejects(() => fixture.handler.prepareIdempotency(req), { code: "INVENTORY_INPUT_INVALID" });
  await assert.rejects(() => fixture.handler.execute(fixture.request()), { code: "PERMISSION_STALE" });
});

test("ADJ031-PROOF execute consumes only the privately prepared command/context", async () => {
  const fixture = highRiskHandler(postingHandlers.PostInventoryAdjustmentHandler);
  const req = fixture.request();
  await fixture.handler.prepareIdempotency(req);
  let received;
  fixture.handler.inventory.postAdjustment = async (command, context) => { received = { command, context }; return { status: "POSTED" }; };
  req.input.body.password = "new"; req.input.body.quantity = 999;
  const response = await fixture.handler.execute(req);
  assert.equal(response.data.status, "POSTED");
  assert.equal(received.command.payload.quantity, 2);
  assert.equal(JSON.stringify(received.context), "{}");
  assert.doesNotMatch(JSON.stringify(received.command), /password|context|signature|token/u);
  await assert.rejects(() => fixture.handler.execute(req), { code: "PERMISSION_STALE" });
});

test("TASK-030 Bin Move route requires both permissions, JWT, idempotency and explicit destination version", () => {
  const api = postingHandlers.PostInventoryBinMoveHandler.api;
  assert.equal(api.method, "POST");
  assert.equal(api.path, "/api/v1/inventory/bin-moves");
  assert.equal(api.authType, "jwt");
  assert.deepEqual(api.authorizationPolicies, PostInventoryReceiptHandler.api.authorizationPolicies);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.inputCoercion, false);
  const validate = new RequestValidator().compile(api.requestSchema, api.path, { coerceTypes: false });
  const body = { source: { module: "INVENTORY", documentType: "BIN_MOVE", documentId: "move-1", eventId: "post-1" },
    warehouseId: 2, lines: [{ sourceBalanceId: 501, destinationBinId: 36, quantity: 2,
      expectedSourceVersion: 3, expectedDestinationVersion: null }] };
  validate({ params: {}, query: {}, body: structuredClone(body) });
  for (const overrides of [{ expectedSourceVersion: null }, { quantity: 0 }, { skuId: 12 },
    { sourceBalanceId: "501" }, { destinationBinId: true }, { quantity: "2" },
    { expectedSourceVersion: true }, { expectedDestinationVersion: "3" }]) {
    const invalid = structuredClone(body);
    Object.assign(invalid.lines[0], overrides);
    assert.throws(() => validate({ params: {}, query: {}, body: invalid }), { code: "REQUEST_VALIDATION_FAILED" });
  }
  const invalid = structuredClone(body);
  delete invalid.lines[0].expectedDestinationVersion;
  assert.throws(() => validate({ params: {}, query: {}, body: invalid }), { code: "REQUEST_VALIDATION_FAILED" });
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
});

test("TASK-030 Bin Move handler maps only trusted claims, fixed authorization and complete payload", async () => {
  const handler = new postingHandlers.PostInventoryBinMoveHandler({ require(name) {
    if (name === "mysqldatabase") return { withTransaction() {} };
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-10-07" };
    throw new Error(name);
  } });
  let received;
  const result = { status: "POSTED", operationId: 4, movementGroupId: "move-group", lineCount: 1 };
  handler.inventory = { async postBinMove(command) { received = command; return result; } };
  const source = { module: "INVENTORY", documentType: "BIN_MOVE", documentId: "BM-1", eventId: "post" };
  const lines = [{ sourceBalanceId: 3, destinationBinId: 4, quantity: 2, expectedSourceVersion: 1, expectedDestinationVersion: null }];
  const response = await handler.execute({ auth: { claims: { sub: "9", roles: ["operator"], permissions: ["inventory.view", "inventory.operation"] } },
    input: { body: { source, warehouseId: 2, reason: "Move", lines } }, requestId: "request-1" });
  assert.deepEqual(received, { actor: { userId: 9, serviceName: "", claimedRoles: ["operator"], claimedPermissions: ["inventory.view", "inventory.operation"] },
    authorization: { purpose: "bin_move.post", requiredCallerPermission: "inventory.operation" },
    source, correlationId: "request-1", payload: { warehouseId: 2, reason: "Move", lines } });
  assert.deepEqual(response.data, result);
  new ResponseValidator({ environment: "production" }).compile(postingHandlers.PostInventoryBinMoveHandler.api.responseSchema, "bin-move")(200, result);
});

test("TASK-014 Receipt route exposes the strict operation contract", () => {
  const api = PostInventoryReceiptHandler.api;
  assert.equal(api.method, "POST");
  assert.equal(api.path, "/api/v1/inventory/receipts");
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.requestSchema.body.additionalProperties, false);
  assert.deepEqual(api.requestSchema.body.properties.stockStatus.enum, ["AVAILABLE", "QUARANTINED", "DAMAGED"]);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
});

test("TASK-014 Receipt handler maps trusted actor and source into a fixed command context", async () => {
  const services = {
    require(name) {
      if (name === "mysqldatabase") return { query() {}, withTransaction() {} };
      if (name === "logging") return { logger: { error() {} } };
      if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-28" };
      throw new Error(name);
    }
  };
  const handler = new PostInventoryReceiptHandler(services);
  let received;
  handler.inventory = { async postReceipt(input) { received = input; return { status: "POSTED" }; } };
  const body = {
    source: {
      module: "RECEIVING", documentType: "PURCHASE_RECEIPT", documentId: "receipt-42",
      lineId: "10", eventId: "posted-1"
    },
    skuId: 12, quantity: 2, uomId: 8, warehouseId: 2, binId: 35, stockStatus: "AVAILABLE"
  };

  const response = await handler.execute({
    auth: { claims: { sub: "7", roles: ["warehouse-operator"], permissions: ["inventory.view", "inventory.operation"] } },
    input: { body },
    requestId: "request-1"
  });

  assert.deepEqual(received, {
    actor: {
      userId: 7,
      serviceName: "",
      claimedRoles: ["warehouse-operator"],
      claimedPermissions: ["inventory.view", "inventory.operation"]
    },
    authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
    source: body.source,
    correlationId: "request-1",
    payload: { skuId: 12, quantity: 2, uomId: 8, warehouseId: 2, binId: 35, stockStatus: "AVAILABLE" }
  });
  assert.deepEqual(response.data, { status: "POSTED" });
});

test("TASK-023 direct Issue HTTP path uses Inventory operation, not Fulfillment internal permission", async () => {
  const paths = Object.values(postingHandlers)
    .filter((value) => typeof value === "function" && value.api)
    .map((Handler) => Handler.api.path);
  assert.equal(paths.includes("/api/v1/inventory/issues"), true);
  assert.equal(typeof InventoryPostingService.prototype.postIssueInTransaction, "function");
  const api = PostInventoryIssueHandler.api;
  assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view", "inventory.operation"]);
  assert.deepEqual(api.idempotency, { enabled: true });
  assert.equal(api.requestSchema.body.additionalProperties, false);
  new RequestValidator().compile(api.requestSchema, api.path);
  new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  const handler = new PostInventoryIssueHandler({ require(name) {
    if (name === "mysqldatabase") return { withTransaction() {} };
    if (name === "logging") return { logger: { error() {} } };
    if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-09-29" };
    throw new Error(name);
  } });
  let received;
  handler.inventory = { async postIssue(command) { received = command; return { status: "POSTED" }; } };
  const source = { module: "FULFILLMENT", documentType: "SHIPMENT", documentId: "S-1", eventId: "post-1" };
  const lines = [{ allocationId: 8, expectedVersion: 2, balanceId: 4, expectedBalanceVersion: 3, quantity: 1 }];
  await handler.execute({
    auth: { claims: { sub: "9", roles: [], permissions: ["inventory.operation"] } },
    input: { body: { source, reservationId: 7, version: 5, lines } }, requestId: "req-1"
  });
  assert.deepEqual(received.authorization, { purpose: "issue.post", requiredCallerPermission: "inventory.operation" });
  assert.deepEqual(received.payload, { reservationId: 7, expectedVersion: 5, lines });
  assert.deepEqual(received.source, source);
});
