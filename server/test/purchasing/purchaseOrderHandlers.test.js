/** TASK-015：PO Draft create／update handler 合約（設計 §5.1、§5.2、§10.4）。唔使 DB；真 HTTP 路徑見 purchasingPurchaseOrderApi.integration.test.js。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { CreatePurchaseOrderHandler } from "../../src/handlers/purchasing/createPurchaseOrderHandler.js";
import { UpdatePurchaseOrderHandler } from "../../src/handlers/purchasing/updatePurchaseOrderHandler.js";
import { PURCHASE_ORDER_CREATE_INPUT, PURCHASE_ORDER_UPDATE_INPUT } from "../../src/handlers/purchasing/purchasingSchemas.js";
import { PurchaseOrderService } from "../../src/modules/purchasing/PurchaseOrderService.js";

const logger = { async info() {}, async warn() {}, async error() {}, async debug() {} };
const time = { now: () => new Date(0), nowMs: () => 0, timestamp: () => "", at: (ms) => new Date(ms), fileDate: () => "2026-11-03" };
function services(purchasing = {}) {
  const registry = { mysqldatabase: { withTransaction() {}, query() {} }, time, logging: { logger } };
  return { get: (name) => registry[name], require: (name) => registry[name], config: { purchasing } };
}
const body = (overrides = {}) => ({ eventId: randomUUID(), supplierId: 12, currencyCode: "HKD", orderDate: "2026-11-03", buyerId: 7,
  lines: [{ skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "3", unitPrice: "125.5" }], ...overrides });
// `key` 用 hasOwn 判斷：測「冇 key」要傳 undefined，唔可以畀預設值蓋過。
const request = (input, options = {}) => ({ input: { body: input, params: options.params ?? {}, query: {} },
  get: (name) => name.toLowerCase() === "idempotency-key" ? (Object.hasOwn(options, "key") ? options.key : input.eventId) : undefined,
  auth: { claims: { sub: "9", roles: ["buyer"], permissions: ["purchasing.mgmt"] } }, requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" });
const invalid = (field) => ({ code: "PURCHASING_INPUT_INVALID", publicDetails: { field } });

/** 換走 service，記低 handler 傳咗乜。 */
function handler(Handler) {
  const instance = new Handler(services()), calls = [];
  const result = { id: 41, number: "PO-202611-000001", status: "DRAFT", version: 1, warnings: [], replayed: false };
  instance.orders = { create: async (command) => { calls.push(["create", command]); return result; },
    update: async (command) => { calls.push(["update", command]); return { ...result, version: 2 }; } };
  return { instance, calls };
}

test("Handler metadata：POST、jwt、只要 purchasing.mgmt、開 idempotency、create 201／update 200", () => {
  for (const [Handler, name, path, status] of [[CreatePurchaseOrderHandler, "createPurchaseOrder", "/api/v1/purchase-orders/create", 201],
    [UpdatePurchaseOrderHandler, "updatePurchaseOrder", "/api/v1/purchase-orders/:id/update", 200]]) {
    assert.equal(Handler.handlerName, name);
    assert.equal(Handler.api.method, "POST");
    assert.equal(Handler.api.path, path);
    assert.equal(Handler.api.authType, undefined, "預設 jwt；Draft 唔使密碼（§6.2）");
    assert.deepEqual(Handler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["purchasing.mgmt"] } }]);
    assert.deepEqual(Handler.api.idempotency, { enabled: true });
    assert.deepEqual(Object.keys(Handler.api.responseSchema), [String(status)]);
  }
  assert.deepEqual(UpdatePurchaseOrderHandler.api.requestSchema.params.required, ["id"]);
  for (const schema of [PURCHASE_ORDER_CREATE_INPUT, PURCHASE_ORDER_UPDATE_INPUT]) {
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.lines.items.additionalProperties, false);
  }
});

test("Handler 用真 provider 同 config 組 service：Supplier 接 Business Master，audit 上限跟 config", () => {
  const instance = new CreatePurchaseOrderHandler(services({ auditDetailMaxBytes: 4096, maxPurchaseOrderLines: 50 }));
  assert.ok(instance.orders instanceof PurchaseOrderService);
  assert.equal(instance.orders.config.maxPurchaseOrderLines, 50);
  assert.equal(instance.orders.audit.auditDetailMaxBytes, 4096);
  assert.equal(typeof instance.orders.suppliers.businessMaster.assertSupplierDefaultsInTransaction, "function");
  assert.equal(typeof instance.orders.businessMaster.assertCurrencyUsableInTransaction, "function");
  assert.throws(() => new CreatePurchaseOrderHandler(services({ unknownSetting: 1 })), /unsupported setting/u);
});

test("Create 將 JWT claims、原 body 同 request context 交畀 service，回 201", async () => {
  const { instance, calls } = handler(CreatePurchaseOrderHandler), input = body();
  const response = await instance.execute(request(input));
  assert.equal(response.statusCode, 201);
  assert.equal(response.data.number, "PO-202611-000001");
  assert.deepEqual(calls, [["create", { claims: { sub: "9", roles: ["buyer"], permissions: ["purchasing.mgmt"] }, input,
    context: { requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" } }]]);
});

test("Update 要 version，PO ID 嚟自 path，回 200", async () => {
  const { instance, calls } = handler(UpdatePurchaseOrderHandler);
  await assert.rejects(instance.execute(request(body(), { params: { id: 41 } })), invalid("version"));
  const input = body({ version: 3, lines: [{ id: 101, skuId: 55, purchaseSkuUomId: 88, orderedQuantity: "1", unitPrice: "1" }] });
  const response = await instance.execute(request(input, { params: { id: 41 } }));
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0][0], "update");
  assert.equal(calls[0][1].purchaseOrderId, 41);
  assert.equal(calls[0][1].input, input);
});

test("Idempotency-Key 一定要同 eventId 逐字相同；冇 key 或者唔同都唔叫 service", async () => {
  const { instance, calls } = handler(CreatePurchaseOrderHandler), input = body();
  for (const key of [undefined, "", randomUUID(), input.eventId.toUpperCase(), ` ${input.eventId}`]) {
    await assert.rejects(instance.execute(request(input, { key })), invalid("eventId"), String(key));
  }
  assert.deepEqual(calls, []);
});

test("Schema 拒絕 client total、快照、factor、Base quantity、status 同 line ID（create），錯誤帶欄位路徑", async () => {
  const { instance, calls } = handler(CreatePurchaseOrderHandler), line = body().lines[0];
  for (const field of ["totalAmount", "subtotalAmount", "status", "poNumber", "supplierCodeSnapshot", "version"]) {
    await assert.rejects(instance.execute(request(body({ [field]: "1" }))), invalid("body"), field);
  }
  for (const field of ["lineAmount", "orderedBaseQuantity", "uomToBaseFactor", "skuCodeSnapshot", "id"]) {
    await assert.rejects(instance.execute(request(body({ lines: [{ ...line, [field]: 1 }] }))), invalid("lines.0"), field);
  }
  const { instance: updater } = handler(UpdatePurchaseOrderHandler);
  await assert.rejects(updater.execute(request(body({ version: 1, lines: [{ ...line, lineAmount: "1" }] }), { params: { id: 1 } })), invalid("lines.0"));
  assert.deepEqual(calls, []);
});

test("數量同金額要係原本嘅字串，唔會 coerce；其他型別錯誤都指出欄位", async () => {
  const { instance, calls } = handler(CreatePurchaseOrderHandler), line = body().lines[0];
  const cases = [
    [body({ lines: [{ ...line, orderedQuantity: 3 }] }), "lines.0.orderedQuantity"],
    [body({ lines: [{ ...line, unitPrice: 1.5 }] }), "lines.0.unitPrice"],
    [body({ lines: [line, { ...line, unitPrice: "1.00001" }] }), "lines.1.unitPrice"],
    [body({ supplierId: "12" }), "supplierId"],
    [body({ eventId: randomUUID().toUpperCase() }), "eventId"],
    [body({ currencyCode: "hkd" }), "currencyCode"],
    [body({ orderDate: "03/11/2026" }), "orderDate"],
    [body({ lines: [] }), "lines"],
    [body({ lines: Array.from({ length: 101 }, () => line) }), "lines"],
    [body({ notes: "x".repeat(2001) }), "notes"],
    [body({ buyerId: undefined }), "buyerId"]
  ];
  for (const [input, field] of cases) await assert.rejects(instance.execute(request(input)), invalid(field), field);
  assert.deepEqual(calls, []);
});
