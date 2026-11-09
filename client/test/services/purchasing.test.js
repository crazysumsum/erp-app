import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import purchasing, { service } from "@/services/purchasing.js";

describe("Purchasing client contract（§10.4）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create、update、submit、copy 用 eventId 做 Idempotency-Key，body 原封不動", async () => {
    expect(service.name).toBe("purchasing");
    const payload = { eventId: "intent", version: 3, lines: [{ orderedQuantity: "2.000000", unitPrice: "3.3333" }] };
    for (const [method, path, args] of [["createPurchaseOrder", "/create", [payload]], ["updatePurchaseOrder", "/8/update", [8, payload]],
      ["submitPurchaseOrder", "/8/submit", [8, payload]], ["copyPurchaseOrder", "/8/copy", [8, payload]]]) {
      await purchasing[method](...args);
      expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/purchase-orders${path}`, { idempotent: true, idempotencyKey: "intent", body: payload });
    }
  });

  it("列表映射 DataTable，去走空 filter；detail 同 lookup 轉發 AbortSignal", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 7 });
    await expect(purchasing.listPurchaseOrders({ page: 2, rowsPerPage: 20, filter: "PO-", status: ["DRAFT"], supplierId: "", signal: "abort" })).resolves.toEqual({ rows: [{ id: 1 }], rowsNumber: 7 });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchase-orders", { params: { page: 2, pageSize: 20, q: "PO-", status: ["DRAFT"] }, signal: "abort" });
    await purchasing.getPurchaseOrder(8, { signal: "detail" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchase-orders/8", { signal: "detail" });
    await purchasing.getSupplierDefaults(4, { signal: "defaults" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchasing-lookups/suppliers/4/defaults", { signal: "defaults" });
    for (const [method, kind] of [["lookupSuppliers", "suppliers"], ["lookupSkus", "skus"], ["lookupCurrencies", "currencies"], ["lookupPaymentTerms", "payment-terms"], ["lookupWarehouses", "warehouses"], ["lookupBuyers", "buyers"]]) {
      httpClient.get.mockResolvedValue({ items: [{ id: kind }] });
      await expect(purchasing[method]({ q: "probe", signal: "abort" })).resolves.toEqual([{ id: kind }]);
      expect(httpClient.get).toHaveBeenLastCalledWith(`/api/v1/purchasing-lookups/${kind}`, { params: { q: "probe" }, signal: "abort" });
    }
  });
});

describe("TASK-024 審批及設定 client contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("審批命令用 eventId 做 Idempotency-Key；設定更新要裝置簽章；待我審批映射 DataTable；approvers 回埋 requireApproval", async () => {
    const payload = { eventId: "intent", version: 3, reason: "原因原因", password: "pw" };
    for (const [method, action] of [["approvePurchaseOrder", "approve"], ["rejectPurchaseOrder", "reject"], ["withdrawPurchaseOrderApproval", "withdraw"]]) {
      await purchasing[method](8, payload);
      expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/purchase-orders/8/approval/${action}`, { idempotent: true, idempotencyKey: "intent", body: payload });
    }
    await purchasing.updateSettings(payload);
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/purchasing-settings/update", { idempotent: true, idempotencyKey: "intent", body: payload, signed: true });
    httpClient.get.mockResolvedValue({ items: [{ approvalId: 1 }], total: 4, page: 2, pageSize: 20 });
    await expect(purchasing.listMyApprovals({ page: 2, rowsPerPage: 20, filter: "", supplierId: 3, signal: "abort" })).resolves.toEqual({ rows: [{ approvalId: 1 }], rowsNumber: 4 });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchase-order-approvals/mine", { params: { page: 2, pageSize: 20, supplierId: 3 }, signal: "abort" });
    httpClient.get.mockResolvedValue({ requireApproval: true, items: [{ id: 5, label: "審批人" }] });
    await expect(purchasing.lookupApprovers({ signal: "abort" })).resolves.toEqual({ requireApproval: true, items: [{ id: 5, label: "審批人" }] });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchasing-lookups/approvers", { params: {}, signal: "abort" });
    await purchasing.getSettings({ signal: "abort" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/purchasing-settings", { signal: "abort" });
  });
});

describe("useCommandEvent", () => {
  const failure = (fields) => Object.assign(new Error("failed"), fields);

  it.each([[{ code: "TIMEOUT" }], [{ code: "NETWORK_ERROR" }], [{ code: "TRANSACTION_OUTCOME_UNKNOWN" }], [{ code: "IDEMPOTENCY_IN_PROGRESS" }], [{ status: 503 }]])("結果未確定（%j）就保留原 payload 同 eventId", async (fields) => {
    const command = useCommandEvent(), send = vi.fn().mockRejectedValueOnce(failure(fields)).mockResolvedValue("done");
    await expect(command.run({ notes: "第一次" }, send)).rejects.toThrow("failed");
    expect(command.isUncertain()).toBe(true);
    await expect(command.run({ notes: "用戶之後改咗" }, send)).resolves.toBe("done");
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    expect(send.mock.calls[1][0].notes).toBe("第一次");
    expect(send.mock.calls[0][0].eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(command.isUncertain()).toBe(false);
  });

  it("明確結果之後下一次係新意圖、新 eventId", async () => {
    const command = useCommandEvent(), send = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(failure({ status: 409, code: "VERSION_CONFLICT" })).mockResolvedValue("third");
    await command.run({}, send);
    await expect(command.run({}, send)).rejects.toThrow("failed");
    expect(command.isUncertain()).toBe(false);
    await command.run({}, send);
    expect(new Set(send.mock.calls.map(([body]) => body.eventId)).size).toBe(3);
  });

  it("唔同 key 互不影響：新 key 唔用舊 intent，原 key 仍然未確定", async () => {
    const command = useCommandEvent(), send = vi.fn().mockRejectedValueOnce(failure({ code: "TIMEOUT" })).mockResolvedValue("done");
    await expect(command.run({ notes: "舊" }, send, "a")).rejects.toThrow("failed");
    await command.run({ notes: "新" }, send, "b");
    const [first, second] = send.mock.calls.map(([body]) => body);
    expect(send).toHaveBeenCalledTimes(2);
    expect(second.notes).toBe("新");
    expect(second.eventId).not.toBe(first.eventId);
    expect(command.isUncertain("a")).toBe(true);
    expect(command.isUncertain("b")).toBe(false);
  });

  it.each([[403, "PASSWORD_INVALID"], [403, "PERMISSION_STALE"], [400, "DEVICE_SIGNATURE_STALE"], [409, "CONCURRENT_OPERATION"], [409, "VERSION_CONFLICT"], [422, "UNKNOWN_FUTURE_CODE"]])(
    "未確定之後 %i %s 證明唔到原交易失敗：保留原 eventId、payload 同未確定，只有原操作成功先解除", async (status, code) => {
      const command = useCommandEvent();
      const send = vi.fn().mockRejectedValueOnce(failure({ code: "TIMEOUT" })).mockRejectedValueOnce(failure({ status, code })).mockResolvedValue("done");
      await expect(command.run({ notes: "原" }, send, "k", { action: "x" })).rejects.toThrow("failed");
      await expect(command.run({ notes: "新" }, send, "k", { action: "x" })).rejects.toThrow("failed");
      expect(command.isUncertain("k")).toBe(true);
      await expect(command.run({ notes: "再新" }, send, "k", { action: "x" })).resolves.toBe("done");
      expect(command.isUncertain("k")).toBe(false);
      const bodies = send.mock.calls.map(([body]) => body);
      expect(bodies).toHaveLength(3);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0].notes).toBe("原");
    });

  it("同一 key 只准一個 in-flight，亦唔准換動作：本地 COMMAND_PENDING 唔發 HTTP；未確定 record 由空開始都睇得到", async () => {
    const command = useCommandEvent();
    expect(command.uncertainRecords.value).toEqual([]);
    let rejectHeld;
    const send = vi.fn(() => new Promise((_, reject) => { rejectHeld = reject; }));
    const first = command.run({ n: 1 }, send, "k", { action: "approve" });
    await expect(command.run({ n: 2 }, send, "k", { action: "approve" })).rejects.toMatchObject({ code: "COMMAND_PENDING" });
    expect(command.isBusy("k")).toBe(true);
    rejectHeld(failure({ code: "TIMEOUT" }));
    await expect(first).rejects.toThrow("failed");
    expect(command.isBusy("k")).toBe(false);
    await expect(command.run({ n: 3 }, send, "k", { action: "reject" })).rejects.toMatchObject({ code: "COMMAND_PENDING" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(command.isUncertain("k")).toBe(true);
    expect(command.uncertainRecords.value.map(({ key, meta }) => [key, meta.action])).toEqual([["k", "approve"]]);
  });
});
