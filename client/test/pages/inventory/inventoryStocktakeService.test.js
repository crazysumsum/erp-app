import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() } }));
import { httpClient } from "@/framework/http/HttpClient.js";
import inventory from "@/services/inventory.js";
const source = { module: "INVENTORY", documentType: "STOCKTAKE", documentId: "C039", eventId: "intent1" };
const payload = { source, expectedVersion: 2, idempotencyKey: "fixed-intent" };
describe("TASK039 Stocktake service contract", () => {
  beforeEach(() => { vi.clearAllMocks(); httpClient.get.mockResolvedValue({ items: [], total: 0, asOf: 123 }); httpClient.post.mockResolvedValue({ id: 41 }); });
  it("ST039-C01 twelve public methods use only their exact routes and business payload", async () => {
    expect(typeof inventory.startStocktake).toBe("function");
    for (const [method, path] of [["createStocktake", "/create"], ["updateStocktake", "/41/update"], ["startStocktake", "/41/start"],
      ["saveStocktakeCounts", "/41/counts/save"], ["addStocktakeLine", "/41/lines/add"], ["readyStocktake", "/41/ready"],
      ["postStocktake", "/41/post"], ["cancelStocktake", "/41/cancel"]]) {
      if (method === "createStocktake") await inventory[method](payload); else await inventory[method](41, payload);
      expect(httpClient.post.mock.lastCall[0]).toBe("/api/v1/inventory/stocktakes" + path);
      expect(httpClient.post.mock.lastCall[1].body).toEqual({ source, expectedVersion: 2 });
    }
    await inventory.listStocktakes(); await inventory.getStocktake(41); await inventory.listStocktakeLines(41); await inventory.exportStocktake(41);
    expect(httpClient.get.mock.calls.map(call => call[0])).toEqual(["/api/v1/inventory/stocktakes", "/api/v1/inventory/stocktakes/41", "/api/v1/inventory/stocktakes/41/lines"]);
    expect(httpClient.getBlob.mock.lastCall[0]).toBe("/api/v1/inventory/stocktakes/41/export");
  });
  it("ST039-C02 only Post is signed; password-only Cancel retains the same explicit key", async () => {
    expect(typeof inventory.postStocktake).toBe("function");
    await inventory.postStocktake(41, { ...payload, password: "synthetic" });
    expect(httpClient.post.mock.lastCall[1]).toMatchObject({ signed: true, idempotent: true, idempotencyKey: "fixed-intent" });
    await inventory.cancelStocktake(41, { ...payload, password: "synthetic" });
    expect(httpClient.post.mock.lastCall[1].signed).toBeUndefined(); expect(httpClient.post.mock.lastCall[1].body.password).toBe("synthetic");
    expect(httpClient.post.mock.lastCall[1].idempotencyKey).toBe("fixed-intent");
  });
  it("ST039-C03 list adapters preserve asOf and global/filtered summary instead of dropping metadata", async () => {
    expect(typeof inventory.listStocktakeLines).toBe("function");
    httpClient.get.mockResolvedValueOnce({ items: [{ id: 1 }], total: 4, asOf: 123, version: 2, globalSummary: { totalLines: 9 }, filteredSummary: { totalLines: 4 } });
    const result = await inventory.listStocktakeLines(41, { page: 2, rowsPerPage: 1, variance: "LOSS" });
    expect(httpClient.get.mock.lastCall[1].params).toEqual({ page: 2, pageSize: 1, variance: "LOSS" });
    expect(result).toEqual({ rows: [{ id: 1 }], rowsNumber: 4, asOf: 123, version: 2, globalSummary: { totalLines: 9 }, filteredSummary: { totalLines: 4 } });
  });
  it("ST039-C04 zero/notFound versions and Add's line-owned scalar remain unchanged", async () => {
    expect(typeof inventory.saveStocktakeCounts).toBe("function");
    const lines = [{ lineId: 201, expectedVersion: 3, countedQuantity: 0 }, { lineId: 202, expectedVersion: 4, notFound: true }];
    await inventory.saveStocktakeCounts(41, { source, lines, idempotencyKey: "count1" });
    expect(httpClient.post.mock.lastCall[1].body).toEqual({ source, lines });
    const original = { id: 203, stocktakeId: 41, version: 1, operationId: 21, rowCount: 1, status: "COUNTING" };
    httpClient.post.mockResolvedValueOnce(original); expect(await inventory.addStocktakeLine(41, { source })).toBe(original);
  });
  it("ST039-C05 CSV filters are encoded in an auth-based getBlob URL with no token or unsupported field", async () => {
    expect(typeof inventory.exportStocktake).toBe("function");
    await inventory.exportStocktake(41, { binId: 2, variance: "GAIN", progress: "COUNTED", unused: "token=secret" });
    const url = new URL(httpClient.getBlob.mock.lastCall[0], "http://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ binId: "2", progress: "COUNTED", variance: "GAIN" });
    expect(url.toString()).not.toContain("secret");
  });
  it("ST039-C06 AbortSignal reaches every relevant read, write and blob request", async () => {
    expect(typeof inventory.getStocktake).toBe("function"); const { signal } = new AbortController();
    await inventory.getStocktake(41, { signal }); expect(httpClient.get.mock.lastCall[1].signal).toBe(signal);
    await inventory.startStocktake(41, payload, { signal }); expect(httpClient.post.mock.lastCall[1].signal).toBe(signal);
    await inventory.exportStocktake(41, { signal }); expect(httpClient.getBlob.mock.lastCall[1].signal).toBe(signal);
  });
  it("ST039-C07 safe errors and unknown outcomes propagate without replacing the original source/key", async () => {
    expect(typeof inventory.postStocktake).toBe("function");
    for (const code of ["JWT_INVALID", "PERMISSION_STALE", "VERSION_CONFLICT", "TRANSACTION_OUTCOME_UNKNOWN"]) {
      const error = Object.assign(new Error(code), { code }); httpClient.post.mockRejectedValueOnce(error);
      await expect(inventory.postStocktake(41, payload)).rejects.toBe(error);
      expect(httpClient.post.mock.lastCall[1].idempotencyKey).toBe("fixed-intent"); expect(httpClient.post.mock.lastCall[1].body.source).toBe(source);
    }
  });
  it("ST039-C08 all existing Inventory adapters retain signing and route conventions", async () => {
    expect(typeof inventory.startStocktake).toBe("function");
    await inventory.postAdjustment(payload); expect(httpClient.post.mock.lastCall[0]).toBe("/api/v1/inventory/adjustments"); expect(httpClient.post.mock.lastCall[1].signed).toBe(true);
    await inventory.createTransfer(payload); expect(httpClient.post.mock.lastCall[0]).toBe("/api/v1/inventory/transfers/create");
    expect(typeof inventory.listReservations).toBe("function"); expect(typeof inventory.findOperationBySource).toBe("function");
  });
});
