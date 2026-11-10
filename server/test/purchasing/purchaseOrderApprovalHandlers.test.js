/** TASK-023：審批同設定 handler 合約（§5.2、§5.4、§6.2）。唔使 DB；真 HTTP 路徑見 purchasingApprovalCommands.integration.test.js。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ListMyPurchaseOrderApprovalsHandler } from "../../src/handlers/purchase-order-approvals/listMyPurchaseOrderApprovalsHandler.js";
import { ApprovePurchaseOrderHandler, RejectPurchaseOrderHandler, WithdrawPurchaseOrderApprovalHandler } from "../../src/handlers/purchase-orders/purchaseOrderApprovalHandlers.js";
import { GetPurchasingSettingsHandler, UpdatePurchasingSettingsHandler } from "../../src/handlers/purchasing-settings/purchasingSettingsHandlers.js";
import { PurchaseOrderService } from "../../src/modules/purchasing/PurchaseOrderService.js";
import { PurchasingSettingsService } from "../../src/modules/purchasing/PurchasingSettingsService.js";

const logger = { async info() {}, async warn() {}, async error() {}, async debug() {} };
const time = { now: () => new Date(0), nowMs: () => 0, timestamp: () => "", at: (ms) => new Date(ms), fileDate: () => "2026-11-05" };
const registry = { mysqldatabase: { withTransaction() {}, query() {} }, time, logging: { logger } };
const services = { get: (name) => registry[name], require: (name) => registry[name], config: { purchasing: {} } };
const claims = { sub: "9", roles: ["r"], permissions: ["purchasing.view"] };
const request = (body, { params = { id: "41" }, key = body.eventId } = {}) => ({ input: { body, params, query: {} }, get: (name) => name.toLowerCase() === "idempotency-key" ? key : undefined,
  auth: { claims }, requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" });
const invalid = (field) => ({ code: "PURCHASING_INPUT_INVALID", publicDetails: { field } });
const decision = ["purchasing.view", "purchasing.approval"];
const orderHandler = (Handler, method) => {
  const instance = new Handler(services), calls = [];
  instance.orders = { [method]: async (command) => { calls.push(command); return { id: 41, number: "PO-202611-000001", status: "DRAFT", version: 2, replayed: false }; } };
  return { instance, calls };
};

test("Metadata：審批決定用 jwt-password＋view＋approval；撤回用 jwt＋mgmt；設定更新用 jwt-device-password", () => {
  for (const [Handler, name, action, authType, permissions] of [[ApprovePurchaseOrderHandler, "approvePurchaseOrder", "approve", "jwt-password", decision],
    [RejectPurchaseOrderHandler, "rejectPurchaseOrder", "reject", "jwt-password", decision], [WithdrawPurchaseOrderApprovalHandler, "withdrawPurchaseOrderApproval", "withdraw", undefined, ["purchasing.mgmt"]]]) {
    assert.deepEqual([Handler.handlerName, Handler.api.method, Handler.api.path, Handler.api.authType], [name, "POST", `/api/v1/purchase-orders/:id/approval/${action}`, authType]);
    assert.deepEqual(Handler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions } }]);
    assert.deepEqual(Handler.api.idempotency, { enabled: true });
    assert.deepEqual(Object.keys(Handler.api.responseSchema), ["200"]);
  }
  assert.deepEqual([UpdatePurchasingSettingsHandler.api.path, UpdatePurchasingSettingsHandler.api.authType], ["/api/v1/purchasing-settings/update", "jwt-device-password"]);
  assert.deepEqual(UpdatePurchasingSettingsHandler.api.idempotency, { enabled: true });
  assert.deepEqual([GetPurchasingSettingsHandler.api.method, GetPurchasingSettingsHandler.api.path, GetPurchasingSettingsHandler.api.authType], ["GET", "/api/v1/purchasing-settings", undefined]);
  for (const Handler of [UpdatePurchasingSettingsHandler, GetPurchasingSettingsHandler]) {
    assert.deepEqual(Handler.api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: ["purchasing.settings"] } }]);
  }
});

test("Handler 用真 service 組裝", () => {
  assert.ok(new ApprovePurchaseOrderHandler(services).orders instanceof PurchaseOrderService);
  assert.ok(new UpdatePurchasingSettingsHandler(services).settings instanceof PurchasingSettingsService);
});

test("批准、拒絕：password 唔會交畀 service；PO ID 嚟自 path；context 照傳", async () => {
  for (const [Handler, method, extra] of [[ApprovePurchaseOrderHandler, "approve", {}], [RejectPurchaseOrderHandler, "reject", { reason: "價錢要再傾" }]]) {
    const { instance, calls } = orderHandler(Handler, method), eventId = randomUUID();
    const response = await instance.execute(request({ eventId, version: 3, password: "secret", ...extra }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, [{ claims, input: { eventId, version: 3, ...extra }, purchaseOrderId: 41, context: { requestId: "req-1", correlationId: "corr-1", ip: "127.0.0.1" } }]);
    assert.ok(!JSON.stringify(calls).includes("secret"));
  }
});

test("批准、拒絕、撤回：未知欄位、缺欄位、key 唔一致一律拒絕，唔會打 service", async () => {
  const eventId = randomUUID(), good = { eventId, version: 3, password: "secret" };
  const approve = orderHandler(ApprovePurchaseOrderHandler, "approve"), reject = orderHandler(RejectPurchaseOrderHandler, "reject"), withdraw = orderHandler(WithdrawPurchaseOrderApprovalHandler, "withdrawApproval");
  await assert.rejects(approve.instance.execute(request({ ...good, status: "CONFIRMED" })), invalid("body"));
  await assert.rejects(approve.instance.execute(request({ eventId, version: 3 })), invalid("password"));
  await assert.rejects(approve.instance.execute(request({ ...good, version: "3" })), invalid("version"));
  await assert.rejects(approve.instance.execute(request(good, { key: randomUUID() })), invalid("eventId"));
  await assert.rejects(reject.instance.execute(request(good)), invalid("reason"));
  await assert.rejects(withdraw.instance.execute(request({ eventId, version: 3, password: "x" })), invalid("body"));
  assert.deepEqual([approve.calls, reject.calls, withdraw.calls], [[], [], []]);
});

test("設定更新：password 唔會交畀 service；未知欄位拒絕", async () => {
  const instance = new UpdatePurchasingSettingsHandler(services), calls = [], eventId = randomUUID();
  instance.settings = { update: async (command) => { calls.push(command); return { requirePoApproval: true, version: 2, replayed: false }; } };
  const body = { eventId, version: 1, requirePoApproval: true, reason: "開始需要審批", password: "secret" };
  assert.equal((await instance.execute(request(body))).statusCode, 200);
  assert.deepEqual(calls[0].input, { eventId, version: 1, requirePoApproval: true, reason: "開始需要審批" });
  await assert.rejects(instance.execute(request({ ...body, extra: 1 })), invalid("body"));
  await assert.rejects(instance.execute(request({ ...body, requirePoApproval: "true" })), invalid("requirePoApproval"));
  assert.equal(calls.length, 1);
});

test("待我審批：GET、view＋approval；query 驗完先打 service，未知欄位拒絕", async () => {
  const { api, handlerName } = ListMyPurchaseOrderApprovalsHandler;
  assert.deepEqual([handlerName, api.method, api.path, api.authType], ["listMyPurchaseOrderApprovals", "GET", "/api/v1/purchase-order-approvals/mine", undefined]);
  assert.deepEqual(api.authorizationPolicies, [{ name: "hasPermission", options: { permissions: decision } }]);
  const instance = new ListMyPurchaseOrderApprovalsHandler(services), calls = [];
  instance.inquiry = { myApprovals: async (command) => { calls.push(command); return { items: [], total: 0, page: 2, pageSize: 5 }; } };
  await instance.execute({ input: { query: { page: "2", pageSize: "5", q: "PO-" } }, auth: { claims } });
  assert.deepEqual(calls, [{ claims, input: { page: 2, pageSize: 5, q: "PO-" } }]);
  await assert.rejects(instance.execute({ input: { query: { status: "DRAFT" } }, auth: { claims } }), invalid("query"));
  assert.equal(calls.length, 1);
});
