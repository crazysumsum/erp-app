import assert from "node:assert/strict";
import test from "node:test";
import { RequestValidator } from "../src/framework/validation/requestValidator.js";
import { ResponseValidator } from "../src/framework/validation/responseValidator.js";
import * as transfers from "../src/handlers/inventory/transferHandlers.js";
import { LookupInventorySkuHandler } from "../src/handlers/inventory/skuLookupHandlers.js";

const services = { require(name) {
  if (name === "mysqldatabase") return { query() {}, withTransaction() {} };
  if (name === "logging") return { logger: { error() {} } };
  if (name === "time") return { nowMs: () => 1, fileDate: () => "2026-10-06" };
  throw new Error(name);
} };
const source = { module: "INVENTORY", documentType: "TRANSFER", documentId: "intent-1", lineId: "", eventId: "event-1" };
const line = { skuId: 12, lotId: null, sourceBinId: 10, stockStatus: "AVAILABLE", quantity: 5 };
const draft = { source, sourceWarehouseId: 1, destinationWarehouseId: 2, reason: "", lines: [line] };
function validate(Handler, body, params = { id: "7" }, query = {}) {
  const req = { params, query, body, headers: {} };
  new RequestValidator().compile(Handler.api.requestSchema, Handler.api.path)(req);
  return req.input;
}

test("TASK-029 Transfer exposes exactly seven approved JWT routes and permissions", () => {
  const handlers = Object.values(transfers).filter(value => typeof value === "function" && value.api);
  assert.equal(handlers.length, 7);
  assert.deepEqual(handlers.map(H => [H.api.method, H.api.path]).sort(), [
    ["GET", "/api/v1/inventory/transfers"], ["GET", "/api/v1/inventory/transfers/:id"],
    ...["cancel", "dispatch", "receive", "update"].map(action => ["POST", `/api/v1/inventory/transfers/:id/${action}`]),
    ["POST", "/api/v1/inventory/transfers/create"]
  ].sort());
  for (const Handler of handlers) {
    assert.equal(Handler.api.authType, "jwt");
    assert.deepEqual(Handler.api.authorizationPolicies[0].options.permissions,
      Handler.api.method === "GET" ? ["inventory.view"] : ["inventory.view", "inventory.operation"]);
    assert.deepEqual(Handler.api.idempotency, Handler.api.method === "GET" ? undefined : { enabled: true });
    for (const schema of Object.values(Handler.api.requestSchema)) assert.equal(schema.additionalProperties, false);
    new RequestValidator().compile(Handler.api.requestSchema, Handler.api.path);
    new ResponseValidator({ environment: "production" }).compile(Handler.api.responseSchema, Handler.api.path);
  }
});

test("TASK-029 Transfer list validates paging, filters and epoch time bounds", () => {
  const { query } = validate(transfers.ListInventoryTransfersHandler, undefined, {}, {
    page: "2", pageSize: "100", status: "IN_TRANSIT", sourceWarehouseId: "1", createdFrom: "0", createdTo: "10"
  });
  assert.deepEqual(query, { page: 2, pageSize: 100, status: "IN_TRANSIT", sourceWarehouseId: 1,
    createdFrom: 0, createdTo: 10, sortBy: "updatedAt", descending: true });
  for (const query of [{ pageSize: 101 }, { status: "PARTIAL" }, { createdFrom: -1 }, { permission: "inventory.operation" }]) {
    assert.throws(() => validate(transfers.ListInventoryTransfersHandler, undefined, {}, query), { code: "REQUEST_VALIDATION_FAILED" });
  }
});

test("TASK-029 Transfer Draft schema rejects bad quantities and injected actor/source fields", () => {
  assert.equal(validate(transfers.CreateInventoryTransferHandler, structuredClone(draft), {}).body.lines[0].quantity, 5);
  const invalid = [
    { ...draft, actor: { userId: 9 } }, { ...draft, source: { ...source, permission: "inventory.operation" } },
    { ...draft, lines: [] }, { ...draft, lines: Array(101).fill(line) },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(quantity => ({ ...draft, lines: [{ ...line, quantity }] })),
    { ...draft, lines: [{ ...line, destinationBinId: 20 }] }, { ...draft, version: 1 }
  ];
  for (const body of invalid) assert.throws(() => validate(transfers.CreateInventoryTransferHandler, body, {}), { code: "REQUEST_VALIDATION_FAILED" });
});

test("TASK-029 Transfer replacement requires header and retained-line versions", () => {
  const body = { ...draft, version: 2, lines: [{ ...line, id: 11, expectedVersion: 1 }, line] };
  assert.equal(validate(transfers.UpdateInventoryTransferHandler, body).body.lines.length, 2);
  for (const bad of [{ ...body, version: 0 }, { ...body, version: undefined },
    { ...body, lines: [{ ...line, id: 11 }] }, { ...body, lines: [{ ...line, expectedVersion: 1 }] }]) {
    assert.throws(() => validate(transfers.UpdateInventoryTransferHandler, bad), { code: "REQUEST_VALIDATION_FAILED" });
  }
});

test("TASK-029 Dispatch and Cancel reject partial selection and missing reason", () => {
  assert.equal(validate(transfers.DispatchInventoryTransferHandler, { source, version: 2 }).body.version, 2);
  assert.throws(() => validate(transfers.DispatchInventoryTransferHandler, { source, version: 2, lines: [{ id: 1 }] }), { code: "REQUEST_VALIDATION_FAILED" });
  for (const reason of ["", "   "]) assert.throws(() => validate(transfers.CancelInventoryTransferHandler, { source, version: 1, reason }), { code: "REQUEST_VALIDATION_FAILED" });
});

test("TASK-029 Receive accepts only bounded lines, versions and destination fields", () => {
  const receipt = { source, version: 2, lines: [{ id: 11, quantity: 5, destinationBinId: 20 }] };
  assert.equal(validate(transfers.ReceiveInventoryTransferHandler, structuredClone(receipt)).body.lines[0].destinationBinId, 20);
  for (const body of [{ ...receipt, lines: [] }, { ...receipt, version: 0 },
    { ...receipt, lines: [{ id: 11, quantity: 0, destinationBinId: 20 }] },
    { ...receipt, lines: [{ ...receipt.lines[0], sourceBinId: 10 }] },
    { ...receipt, lines: [{ ...receipt.lines[0], stockStatus: "EXPIRED" }] }]) {
    assert.throws(() => validate(transfers.ReceiveInventoryTransferHandler, body), { code: "REQUEST_VALIDATION_FAILED" });
  }
});

test("TASK-029 Transfer writes bind trusted actor, fixed permission and path ownership", async () => {
  for (const [Handler, action, body, payload] of [
    [transfers.CreateInventoryTransferHandler, "create", draft, { ...draft, source: undefined }],
    [transfers.UpdateInventoryTransferHandler, "update", { ...draft, version: 2 }, { ...draft, source: undefined, transferId: 7, expectedVersion: 2 }],
    [transfers.CancelInventoryTransferHandler, "cancel", { source, version: 2, reason: "cancelled" }, { transferId: 7, expectedVersion: 2, reason: "cancelled" }],
    [transfers.DispatchInventoryTransferHandler, "dispatch", { source, version: 2 }, { transferId: 7, expectedVersion: 2 }],
    [transfers.ReceiveInventoryTransferHandler, "receive", { source, version: 2, lines: [{ id: 11, quantity: 5, destinationBinId: 20 }], reason: "inspection" },
      { transferId: 7, expectedVersion: 2, lines: [{ id: 11, quantity: 5, destinationBinId: 20 }], reason: "inspection" }]
  ]) {
    delete payload.source;
    const handler = new Handler(services);
    let received;
    handler.inventory = { async [action](command) { received = command; return { id: 7 }; } };
    const result = await handler.execute({ auth: { claims: { sub: "9", roles: ["operator"], permissions: ["inventory.view", "inventory.operation"] } },
      input: { params: { id: 7 }, query: {}, body }, requestId: "request-1" });
    assert.deepEqual(received, { actor: { userId: 9, serviceName: "", claimedRoles: ["operator"], claimedPermissions: ["inventory.view", "inventory.operation"] },
      authorization: { purpose: `transfer.${action}`, requiredCallerPermission: "inventory.operation" }, source, correlationId: "request-1", payload });
    assert.deepEqual(result.data, { id: 7 });
  }
});

test("TASK-029 Transfer reads forward only validated filters and detail ID", async () => {
  const list = new transfers.ListInventoryTransfersHandler(services);
  list.inventory = { async listTransfers(input) { assert.deepEqual(input, { status: "DRAFT" }); return { items: [] }; } };
  assert.deepEqual((await list.execute({ input: { query: { status: "DRAFT" } } })).data, { items: [] });
  const detail = new transfers.GetInventoryTransferHandler(services);
  detail.inventory = { async getTransfer(id) { assert.equal(id, 7); return { id }; } };
  assert.deepEqual((await detail.execute({ input: { params: { id: 7 } } })).data, { id: 7 });
});

test("TASK-029 Transfer does not swallow transactional conflicts or manufacture success", async () => {
  const handler = new transfers.DispatchInventoryTransferHandler(services);
  const failure = Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" });
  handler.inventory = { async dispatch() { throw failure; } };
  await assert.rejects(() => handler.execute({ auth: { claims: { sub: "9", roles: [], permissions: [] } },
    input: { params: { id: 7 }, body: { source, version: 1 } } }), error => error === failure);
});

function lookupFixture({ sku = {}, uom = {}, missing = false, failure } = {}) {
  const calls = [];
  const row = { id: 12, sku_code: "SKU-%_", sku_name: "Lookup SKU", sku_status: "active",
    item_status: "active", item_id: 1, item_name: "Private admin name", product_type: "standard",
    inventory_tracked: 1, tracking_policy: "none", suggested_price_amount: "99.0000", ...sku };
  const tx = { async query(sql, params) {
    calls.push({ sql, params });
    if (failure) throw failure;
    if (sql.includes("s.id AS sku_id")) return [missing ? [] : [{ sku_id: 12, item_id: 1, id: 20, uom_id: 4 }]];
    if (sql.includes("FROM item_uoms")) return [[{ id: 4, code: "EA", name: "Each", status: "active", version: 1 }]];
    if (sql.includes("FROM items")) return [[{ id: 1, name: row.item_name, product_type: row.product_type, status: row.item_status, version: 1 }]];
    if (sql.includes("FROM item_sku_uoms")) return [[{ id: 20, sku_id: 12, uom_id: 4, uom_code: "EA", is_base: 1, to_base_factor: 1, version: 1, ...uom }]];
    assert.match(sql, /FROM item_skus/u);
    return [missing ? [] : [row]];
  } };
  const database = { query() { throw new Error("lookup escaped its transaction"); }, async withTransaction(work) { return work(tx); } };
  const handler = new LookupInventorySkuHandler({ require(name) {
    return name === "mysqldatabase" ? database : services.require(name);
  } });
  return { calls, async lookup(code = "SKU-%_") {
    const query = { code }, input = validate(LookupInventorySkuHandler, undefined, {}, query);
    return (await handler.execute({ query, input })).data;
  } };
}

test("TASK-029 lookup uses Inventory view only and strict request/response contracts", () => {
  const api = LookupInventorySkuHandler.api;
  assert.equal(api.path, "/api/v1/inventory/sku-lookup"); assert.equal(api.method, "GET");
  assert.equal(api.authType, "jwt"); assert.deepEqual(api.authorizationPolicies[0].options.permissions, ["inventory.view"]);
  assert.equal(api.idempotency, undefined);
  for (const query of [{}, { code: "" }, { code: "a".repeat(191) }, { code: "\u0000bad" }, { code: "bad\u007f" },
    { code: ["a", "b"] }, { code: "a", permission: "item.view" }]) {
    assert.throws(() => validate(LookupInventorySkuHandler, undefined, {}, query), { code: "REQUEST_VALIDATION_FAILED" });
  }
  for (const code of ["1", "a".repeat(190), "😀".repeat(190)]) assert.equal(validate(LookupInventorySkuHandler, undefined, {}, { code }).query.code, code);
  assert.throws(() => validate(LookupInventorySkuHandler, undefined, {}, { code: "😀".repeat(191) }), { code: "REQUEST_VALIDATION_FAILED" });
  const validateResponse = new ResponseValidator({ environment: "production" }).compile(api.responseSchema, api.path);
  const data = { skuId: 12, skuCode: "SKU-%_", skuName: "Lookup SKU", trackingPolicy: "none", baseUom: { uomId: 4, uomCode: "EA" } };
  validateResponse(200, data);
  for (const bad of [{ ...data, itemName: "admin" }, { ...data, trackingPolicy: "serial" },
    { ...data, skuId: 0 }, { ...data, baseUom: { ...data.baseUom, factor: 1 } }]) assert.throws(() => validateResponse(200, bad));
});

test("TASK-029 lookup trims Code, keeps literal wildcards and confines Item reads to one executor", async () => {
  const fixture = lookupFixture();
  assert.deepEqual(await fixture.lookup("  SKU-%_  "), { skuId: 12, skuCode: "SKU-%_", skuName: "Lookup SKU",
    trackingPolicy: "none", baseUom: { uomId: 4, uomCode: "EA" } });
  assert.equal(fixture.calls.length, 2);
  assert.match(fixture.calls[0].sql, /s\.sku_code = \?/u); assert.deepEqual(fixture.calls[0].params, ["SKU-%_"]);
  assert.deepEqual(fixture.calls[1].params, [12]);
  assert.ok(fixture.calls.every(({ sql }) => !/INSERT|UPDATE|FOR UPDATE|FOR SHARE|inventory_stock/iu.test(sql)));
});

test("TASK-029 lookup preserves Item inventory eligibility, including discontinued Item", async () => {
  for (const tracking_policy of ["none", "batch", "batch_expiry"]) {
    assert.equal((await lookupFixture({ sku: { item_status: "discontinued", tracking_policy } }).lookup()).trackingPolicy, tracking_policy);
  }
  for (const [sku, code] of [[{ inventory_tracked: 0 }, "SKU_NOT_INVENTORY_TRACKED"],
    [{ sku_status: "inactive" }, "INVENTORY_INPUT_INVALID"], [{ sku_status: "archived" }, "INVENTORY_INPUT_INVALID"],
    [{ item_status: "archived" }, "INVENTORY_INPUT_INVALID"], [{ tracking_policy: "serial" }, "SERIAL_TRACKING_UNSUPPORTED"]]) {
    await assert.rejects(() => lookupFixture({ sku }).lookup(), { code, statusCode: 400 });
  }
});

test("TASK-029 lookup rejects unknown SKU and invalid Base UOM without manufacturing a result", async () => {
  await assert.rejects(() => lookupFixture({ missing: true }).lookup(), { code: "INVENTORY_RESOURCE_NOT_FOUND", statusCode: 404 });
  for (const uom of [{ is_base: 0 }, { to_base_factor: 2 }]) {
    await assert.rejects(() => lookupFixture({ uom }).lookup(), { code: "UOM_CONVERSION_INVALID", statusCode: 400 });
  }
  const failure = new Error("private SQL failure");
  await assert.rejects(() => lookupFixture({ failure }).lookup(), error => error === failure);
});

test("TASK-029 lookup rejects blank and non-string raw input before any Item query", async () => {
  const blank = lookupFixture();
  await assert.rejects(() => blank.lookup("   "), { code: "SKU_CODE_INVALID" }); assert.equal(blank.calls.length, 0);
  for (const code of [123, true, null]) {
    const fixture = lookupFixture();
    await assert.rejects(() => fixture.lookup(code), { code: "REQUEST_VALIDATION_FAILED" }); assert.equal(fixture.calls.length, 0);
  }
});
