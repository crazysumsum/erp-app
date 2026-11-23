import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import ar from "@/services/ar.js";
import { amountInputValid, fromUnits, toUnits } from "@/components/ar/arPresentation.js";

describe("AR 收款 client 契約", () => {
  beforeEach(() => vi.clearAllMocks());

  it("收款命令用 body.eventId 做 Idempotency-Key，路徑同契約一致", async () => {
    const payload = { eventId: "0f8fad5b-d9cb-469f-a165-70867728950e", version: 3 };
    for (const [method, args, path] of [["createReceipt", [payload], ""], ["confirmReceipt", [5, payload], "/5/confirm"], ["cancelReceipt", [5, payload], "/5/cancel"],
      ["voidReceipt", [5, payload], "/5/void"], ["allocateReceipt", [5, payload], "/5/allocations"], ["unapplyAllocation", [5, 7, payload], "/5/allocations/7/unapply"]]) {
      await ar[method](...args);
      expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/ar-receipts${path}`, { idempotent: true, idempotencyKey: payload.eventId, body: payload });
    }
  });

  it("收款列表映射 DataTable；帳齡只送有值嘅 filter；兩者轉發 AbortSignal", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 3, page: 1, pageSize: 20 });
    await expect(ar.listReceipts({ page: 1, rowsPerPage: 20, q: "RCT", status: "", signal: "abort" })).resolves.toEqual({ rows: [{ id: 1 }], rowsNumber: 3 });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/ar-receipts", { params: { page: 1, pageSize: 20, q: "RCT" }, signal: "abort" });
    await ar.getReceipt(5, { signal: "detail" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/ar-receipts/5", { signal: "detail" });
    await ar.getAging({ customerId: "3", currencyCode: "", signal: "aging" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/ar-aging", { params: { customerId: "3" }, signal: "aging" });
  });
});

describe("AR 金額輸入", () => {
  it("只收幣別小數位內、大於零嘅十進制字串", () => {
    expect(["10", "10.5", "10.05", "0.01"].every((value) => amountInputValid(value, 2))).toBe(true);
    expect(["10.005", "0", "0.00", "01", "-1", "1e3", " 1", ""].some((value) => amountInputValid(value, 2))).toBe(false);
    expect(amountInputValid("10", 0)).toBe(true);
    expect(amountInputValid("10.5", 0)).toBe(false);
  });
  it("萬分位 BigInt 換算冇浮點誤差", () => {
    expect(toUnits("0.1") + toUnits("0.2")).toBe(toUnits("0.3"));
    expect(fromUnits(toUnits("100.01") - toUnits("33.3332"), 2)).toBe("66.6768");
    expect(fromUnits(toUnits("9007199254740993.5"), 2)).toBe("9007199254740993.50");
  });
});
