/** TASK-015：PO Draft create／update handler 合約（設計 §5.1、§5.2、§10.4）。唔使 DB；真 HTTP 路徑見 purchasingPurchaseOrderApi.integration.test.js。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { CopyPurchaseOrderHandler } from "../../src/handlers/purchase-orders/copyPurchaseOrderHandler.js";
import { CreatePurchaseOrderHandler } from "../../src/handlers/purchase-orders/createPurchaseOrderHandler.js";
import { GetPurchaseOrderHandler } from "../../src/handlers/purchase-orders/getPurchaseOrderHandler.js";
import { ListPurchaseOrdersHandler } from "../../src/handlers/purchase-orders/listPurchaseOrdersHandler.js";
import { SubmitPurchaseOrderHandler } from "../../src/handlers/purchase-orders/submitPurchaseOrderHandler.js";
import { UpdatePurchaseOrderHandler } from "../../src/handlers/purchase-orders/updatePurchaseOrderHandler.js";
import { PURCHASE_ORDER_CREATE_INPUT, PURCHASE_ORDER_UPDATE_INPUT } from "../../src/handlers/purchasing/purchasingSchemas.js";
import { PurchaseOrderService } from "../../src/modules/purchasing/PurchaseOrderService.js";
import { PurchasingInquiryService } from "../../src/modules/purchasing/PurchasingInquiryService.js";

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
    update: async (command) => { calls.push(["update", command]); return { ...result, version: 2 }; },
    copy: async (command) => { calls.push(["copy", command]); return result; },
    submit: async (command) => { calls.push(["submit", command]); return { ...result, status: "CONFIRMED", outcome: "CONFIRMED", version: 2 }; } };
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

test("Read handler metadata：GET、jwt、只要 purchasing.view；唔開 idempotency，query 同 response 都係白名單", () => {
  for (const [Handler, name, path] of [[ListPurchaseOrdersHandler, "listPurchaseOrders", "/api/v1/purchase-orders"],
    [GetPurchaseOrderHandler, "getPurchaseOrder", "/api/v1/purchase-orders/:id"]]) {
    assert.equal(Handler.handlerName, name);
    assert.deepEqual([Handler.api.method, Handler.api.path, Handler.api.authType, Handler.api.idempotency], ["GET", path, undefined, undefined]);
    assert.deepEqual(Handler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["purchasing.view"] } }]);
    assert.ok(new Handler(services()).inquiry instanceof PurchasingInquiryService);
  }
  const { additionalProperties, properties } = ListPurchaseOrdersHandler.api.responseSchema[200].properties.items.items;
  assert.equal(additionalProperties, false);
  assert.ok(!Object.keys(properties).some((field) => /bank|iban|account|internal/iu.test(field)));
  assert.equal(GetPurchaseOrderHandler.api.responseSchema[200].additionalProperties, false);
  assert.deepEqual(GetPurchaseOrderHandler.api.requestSchema.params.required, ["id"]);
});

test("List 將 query 字串轉型先交畀 service；未知 filter、爛 enum、超上限一律 PURCHASING_INPUT_INVALID", async () => {
  const instance = new ListPurchaseOrdersHandler(services()), calls = [];
  instance.inquiry = { list: async (command) => { calls.push(command); return { items: [], total: 0, page: 1, pageSize: 20 }; } };
  const list = (query) => instance.execute({ input: { query, params: {}, body: {} }, auth: { claims: { sub: "9" } } });

  await list({ page: "2", pageSize: "50", supplierId: "12", hasOutstanding: "false", descending: "true", status: ["DRAFT", "CLOSED"], q: "ABC", orderDateFrom: "2026-11-01" });
  assert.deepEqual(calls, [{ claims: { sub: "9" }, input: { page: 2, pageSize: 50, supplierId: 12, hasOutstanding: false, descending: true, status: ["DRAFT", "CLOSED"], q: "ABC",
    orderDateFrom: "2026-11-01" } }]);
  calls.length = 0;
  for (const [query, field] of [[{ unknown: "1" }, "query"], [{ pageSize: "101" }, "pageSize"], [{ page: "0" }, "page"], [{ sortBy: "password_hash" }, "sortBy"],
    [{ status: "NOPE" }, "status"], [{ status: ["DRAFT", "NOPE"] }, "status"], [{ supplierId: "abc" }, "supplierId"], [{ hasOutstanding: "maybe" }, "hasOutstanding"],
    [{ currencyCode: "hkd" }, "currencyCode"], [{ orderDateTo: "30/02/2026" }, "orderDateTo"], [{ q: "x".repeat(191) }, "q"]]) {
    await assert.rejects(list(query), invalid(field), JSON.stringify(query));
  }
  assert.deepEqual(calls, []);
});

test("Get 用 path 嘅 ID 同 JWT claims 叫 service", async () => {
  const instance = new GetPurchaseOrderHandler(services()), calls = [];
  instance.inquiry = { get: async (command) => { calls.push(command); return { id: 41 }; } };
  const response = await instance.execute({ input: { params: { id: "41" }, query: {}, body: {} }, auth: { claims: { sub: "9" } } });
  assert.deepEqual(calls, [{ claims: { sub: "9" }, id: 41 }]);
  assert.deepEqual([response.statusCode, response.data], [200, { id: 41 }]);
});

test("Copy metadata 同 create 一樣要 mgmt 同 idempotency；body 只收 eventId，來源 ID 嚟自 path，回 201", async () => {
  assert.deepEqual([CopyPurchaseOrderHandler.handlerName, CopyPurchaseOrderHandler.api.method, CopyPurchaseOrderHandler.api.path],
    ["copyPurchaseOrder", "POST", "/api/v1/purchase-orders/:id/copy"]);
  assert.deepEqual(CopyPurchaseOrderHandler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["purchasing.mgmt"] } }]);
  assert.deepEqual(CopyPurchaseOrderHandler.api.idempotency, { enabled: true });
  assert.deepEqual(Object.keys(CopyPurchaseOrderHandler.api.responseSchema), ["201"]);

  const { instance, calls } = handler(CopyPurchaseOrderHandler), eventId = randomUUID();
  const response = await instance.execute(request({ eventId }, { params: { id: "41" } }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(calls, [["copy", { claims: { sub: "9", roles: ["buyer"], permissions: ["purchasing.mgmt"] }, input: { eventId }, purchaseOrderId: 41,
    context: { requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" } }]]);
  calls.length = 0;

  await assert.rejects(instance.execute(request({ eventId, supplierId: 1 }, { params: { id: "41" } })), invalid("body"));
  await assert.rejects(instance.execute(request({ eventId, status: "CONFIRMED" }, { params: { id: "41" } })), invalid("body"));
  await assert.rejects(instance.execute(request({}, { params: { id: "41" }, key: eventId })), invalid("eventId"));
  await assert.rejects(instance.execute(request({ eventId }, { params: { id: "41" }, key: randomUUID() })), invalid("eventId"));
  assert.deepEqual(calls, []);
});

test("Submit metadata：POST、mgmt、idempotency、200；body 唔收 status 同 outcome，審批欄位驗類型，來源 ID 嚟自 path", async () => {
  assert.deepEqual([SubmitPurchaseOrderHandler.handlerName, SubmitPurchaseOrderHandler.api.method, SubmitPurchaseOrderHandler.api.path, SubmitPurchaseOrderHandler.api.authType],
    ["submitPurchaseOrder", "POST", "/api/v1/purchase-orders/:id/submit", undefined]);
  assert.deepEqual(SubmitPurchaseOrderHandler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["purchasing.mgmt"] } }]);
  assert.deepEqual(SubmitPurchaseOrderHandler.api.idempotency, { enabled: true });
  assert.deepEqual(Object.keys(SubmitPurchaseOrderHandler.api.responseSchema), ["200"]);

  const { instance, calls } = handler(SubmitPurchaseOrderHandler), eventId = randomUUID(), params = { id: "41" };
  const response = await instance.execute(request({ eventId, version: 3 }, { params }));
  assert.deepEqual([response.statusCode, response.data.outcome], [200, "CONFIRMED"]);
  assert.deepEqual(calls, [["submit", { claims: { sub: "9", roles: ["buyer"], permissions: ["purchasing.mgmt"] }, input: { eventId, version: 3 }, purchaseOrderId: 41,
    context: { requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" } }]]);
  calls.length = 0;

  for (const field of ["status", "outcome"]) {
    await assert.rejects(instance.execute(request({ eventId, version: 3, [field]: 1 }, { params })), invalid("body"), field);
  }
  await assert.rejects(instance.execute(request({ eventId, version: 3, assignedApproverId: "1" }, { params })), invalid("assignedApproverId"));
  await assert.rejects(instance.execute(request({ eventId, version: 3, requestNote: 1 }, { params })), invalid("requestNote"));
  await assert.rejects(instance.execute(request({ eventId }, { params })), invalid("version"));
  await assert.rejects(instance.execute(request({ eventId, version: "3" }, { params })), invalid("version"));
  await assert.rejects(instance.execute(request({ eventId, version: 3 }, { params, key: randomUUID() })), invalid("eventId"));
  assert.deepEqual(calls, []);
});

