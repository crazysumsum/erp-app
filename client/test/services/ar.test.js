import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import ar, { service } from "@/services/ar.js";
import { money, quantityText } from "@/components/ar/arPresentation.js";

describe("AR 發票 client 契約", () => {
  beforeEach(() => vi.clearAllMocks());

  it("confirm、cancel、void 用 body.eventId 做 Idempotency-Key，body 原封不動", async () => {
    expect(service.name).toBe("ar");
    const payload = { eventId: "0f8fad5b-d9cb-469f-a165-70867728950e", version: 3, reason: "客戶退回" };
    for (const [method, action] of [["confirmInvoice", "confirm"], ["cancelInvoice", "cancel"], ["voidInvoice", "void"]]) {
      await ar[method](8, payload);
      expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/ar-invoices/8/${action}`, { idempotent: true, idempotencyKey: payload.eventId, body: payload });
    }
  });

  it("列表映射 DataTable；唔送 sortBy／descending 同空 filter；detail 轉發 AbortSignal", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 7, page: 2, pageSize: 20 });
    await expect(ar.listInvoices({ page: 2, rowsPerPage: 20, q: "INV-", status: "CONFIRMED", currencyCode: "", outstandingOnly: null, sortBy: "x", descending: true, signal: "abort" }))
      .resolves.toEqual({ rows: [{ id: 1 }], rowsNumber: 7 });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/ar-invoices", { params: { page: 2, pageSize: 20, q: "INV-", status: "CONFIRMED" }, signal: "abort" });
    await ar.getInvoice(8, { signal: "detail" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/ar-invoices/8", { signal: "detail" });
  });

  it("期初登記使用專用端點，並以 eventId 去重", async () => {
    const payload = { eventId: "0f8fad5b-d9cb-469f-a165-70867728950e", openingReference: "000125" };
    await ar.registerOpeningInvoice(payload);
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/ar-opening-invoices", { idempotent: true, idempotencyKey: payload.eventId, body: payload });
  });
});

describe("AR 金額及數量顯示", () => {
  it("按幣別小數位顯示，但唔四捨五入真 4 位小數", () => {
    expect(money("1250.5000", 2)).toBe("1250.50");
    expect(money("10.0000", 0)).toBe("10");
    expect(money("3.3333", 2)).toBe("3.3333");
    expect(money("0.0050", 2)).toBe("0.0050");
  });
  it("整除顯示銷售單位 × 單價；否則顯示基本單位並註明單價單位；大數用 BigInt", () => {
    const line = { toBaseFactor: 12, baseUomCode: "EA", salesUomCode: "BOX", unitPrice: "120.0000" };
    expect(quantityText({ ...line, quantity: "24" })).toBe("2 BOX × 120.0000");
    expect(quantityText({ ...line, quantity: "25" })).toBe("25 EA（單價 120.0000 為每 BOX）");
    expect(quantityText({ ...line, toBaseFactor: 1, quantity: "9007199254740993" })).toBe("9007199254740993 BOX × 120.0000");
  });
});
