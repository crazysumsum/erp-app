import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import sales, { service } from "@/services/sales.js";
describe("Sales Quotation client contract", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps server pagination while preserving status/date filters and request cancellation", async () => {
    expect(service.name).toBe("sales");
    httpClient.get.mockResolvedValue({ items: [{ id: 1, totalAmount: "0.0000" }], total: 7 });
    await expect(sales.listQuotations({ page: 2, rowsPerPage: 20, filter: "QT-202610", status: ["ISSUED"], customerId: 3, sortBy: "validUntil", descending: false, signal: "abort" })).resolves.toEqual({ rows: [{ id: 1, totalAmount: "0.0000" }], rowsNumber: 7 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/sales-quotations", { params: { page: 2, pageSize: 20, q: "QT-202610", status: ["ISSUED"], customerId: 3, sortBy: "validUntil", descending: false }, signal: "abort" });
  });
  it("retains server detail/projections and forwards cancellation", async () => {
    const detail = { id: 1, totalAmount: "6.6666", allowedActions: ["edit"], lines: [{ quantity: "2.000000", unitSellingPrice: "3.3333" }] };
    httpClient.get.mockResolvedValue(detail);
    await expect(sales.getQuotation(1, { signal: "detail-abort" })).resolves.toBe(detail);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/sales-quotations/1", { signal: "detail-abort" });
  });
  it("preserves event/version/decimal strings and derives transport key from the existing intent", async () => {
    const payload = { eventId: "intent", version: 3, lines: [{ quantity: "2.000000", unitSellingPrice: "3.3333" }] };
    for (const [method, path, args] of [["createQuotation", "/create", [payload]], ["updateQuotation", "/1/update", [1, payload]],
      ["issueQuotation", "/1/issue", [1, payload]], ["cancelQuotation", "/1/cancel", [1, payload]], ["convertQuotation", "/1/convert", [1, payload]]]) {
      await sales[method](...args);
      expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/sales-quotations${path}`, { idempotent: true, idempotencyKey: "intent", body: payload });
    }
    await sales.createQuotation({ ...payload, idempotencyKey: "explicit-key" });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/sales-quotations/create", { idempotent: true, idempotencyKey: "explicit-key", body: payload });
  });
  it("forwards bounded Sales lookup queries and abort signals to their purpose routes", async () => {
    for (const [method, kind] of [["lookupCustomers", "customers"], ["lookupSkus", "skus"], ["lookupWarehouses", "warehouses"], ["lookupChannels", "channels"]]) {
      httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      await expect(sales[method]({ q: "probe", page: 1, pageSize: 20, signal: "abort" })).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
      expect(httpClient.get).toHaveBeenLastCalledWith(`/api/v1/sales-lookups/${kind}`, { params: { q: "probe", page: 1, pageSize: 20 }, signal: "abort" });
    }
  });
  it("preserves Manual SO write intents and forwards detail cancellation", async () => {
    const payload={eventId:"order-intent",version:2,lines:[{quantity:"2.000000",unitSellingPrice:"3.3333"}]};
    await sales.createOrder(payload);expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/sales-orders/create",{idempotent:true,idempotencyKey:"order-intent",body:payload});
    await sales.updateOrder(8,payload);expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/sales-orders/8/update",{idempotent:true,idempotencyKey:"order-intent",body:payload});
    await sales.getOrder(8,{signal:"abort-order"});expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/sales-orders/8",{signal:"abort-order"});
  });
  it("maps bounded Active SO pagination and exact source filters",async()=>{httpClient.get.mockResolvedValue({items:[{id:8}],total:11});await expect(sales.listOrders({page:2,rowsPerPage:10,filter:"customer",number:"SO-202610-000008",externalOrderId:"case_%",channelCode:"WEB",hasBackorder:false,status:["DRAFT"],signal:"abort"})).resolves.toEqual({rows:[{id:8}],rowsNumber:11});expect(httpClient.get).toHaveBeenCalledWith("/api/v1/sales-orders",{params:{page:2,pageSize:10,q:"customer",number:"SO-202610-000008",externalOrderId:"case_%",channelCode:"WEB",hasBackorder:false,status:["DRAFT"]},signal:"abort"});});
});
