import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";
import inventoryService, { service } from "@/services/inventory.js";

describe("inventory service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares its registry name and maps master lists to DataTable shape", async () => {
    expect(service.name).toBe("inventory");
    httpClient.get.mockResolvedValue({ items: [{ id: 3 }], total: 1 });

    await expect(inventoryService.listWarehouses({
      page: 2, rowsPerPage: 50, filter: "MAIN", status: "ACTIVE",
      sortBy: "name", descending: true, signal: "signal"
    })).resolves.toEqual({ rows: [{ id: 3 }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/inventory/warehouses", {
      params: { page: 2, pageSize: 50, q: "MAIN", status: "ACTIVE", sortBy: "name", descending: true },
      signal: "signal"
    });
  });

  it("passes Warehouse ownership, lock filters and cancellation on Bin reads", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0 });
    await inventoryService.listBins(4, {
      page: 1, rowsPerPage: 20, filter: "A", status: "INACTIVE",
      lockStatus: "LOCKED", sortBy: "code", descending: false, signal: "signal"
    });
    await inventoryService.getBin(4, 9, { signal: "detail-signal" });

    expect(httpClient.get.mock.calls).toEqual([
      ["/api/v1/inventory/warehouses/4/bins", {
        params: { page: 1, pageSize: 20, q: "A", status: "INACTIVE", lockStatus: "LOCKED", sortBy: "code", descending: false },
        signal: "signal"
      }],
      ["/api/v1/inventory/warehouses/4/bins/9", { signal: "detail-signal" }]
    ]);
  });

  it("passes inquiry filters and cancellation without leaking empty query values", async () => {
    httpClient.get.mockResolvedValue({ items: [{ sku: { skuId: 3 } }], total: 1 });

    await expect(inventoryService.listStockAggregates({
      page: 2, rowsPerPage: 50, filter: "SKU-3", warehouseId: "1", binId: "",
      status: "AVAILABLE", availability: "ZERO_ATP", expiryState: "WITHIN_DAYS",
      withinDays: 30, sortBy: "skuCode", descending: false, signal: "aggregate-signal"
    })).resolves.toEqual({ rows: [{ sku: { skuId: 3 } }], rowsNumber: 1 });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/inventory/stocks/aggregates", {
      params: {
        page: 2, pageSize: 50, q: "SKU-3", warehouseId: "1", status: "AVAILABLE",
        availability: "ZERO_ATP", expiryState: "WITHIN_DAYS", withinDays: 30,
        sortBy: "skuCode", descending: false
      },
      signal: "aggregate-signal"
    });
  });

  it("makes every write idempotent, strips a caller key from strict bodies and signs deletes only", async () => {
    await inventoryService.createWarehouse({ warehouseCode: "MAIN", warehouseName: "Main", idempotencyKey: "create-main" });
    await inventoryService.deactivateWarehouse(3, { version: 2, reason: "Close location", password: "pw" });
    await inventoryService.deleteBin(3, 9, { version: 4, reason: "Remove unused bin", password: "pw", idempotencyKey: "delete-bin" });

    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/inventory/warehouses/create", {
        idempotent: true, idempotencyKey: "create-main", body: { warehouseCode: "MAIN", warehouseName: "Main" }
      }],
      ["/api/v1/inventory/warehouses/3/deactivate", {
        idempotent: true, body: { version: 2, reason: "Close location", password: "pw" }
      }],
      ["/api/v1/inventory/warehouses/3/bins/9/delete", {
        idempotent: true, idempotencyKey: "delete-bin", signed: true,
        body: { version: 4, reason: "Remove unused bin", password: "pw" }
      }]
    ]);
  });

  it("sends Reservation create with the same intent key and without client-side ATP calculation", async () => {
    const payload = {
      source: { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-1", eventId: "reserve-1" },
      skuId: 4, warehouseId: 2, quantity: 7, purpose: "SALE", minimumRemainingDays: 10,
      idempotencyKey: "reservation-intent-1"
    };
    await inventoryService.createReservation(payload);
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/inventory/reservations/create", {
      idempotent: true, idempotencyKey: "reservation-intent-1",
      body: { source: payload.source, skuId: 4, warehouseId: 2, quantity: 7, purpose: "SALE", minimumRemainingDays: 10 }
    });
  });

  it("sends Reservation release and cancel with path ownership and an intent key", async () => {
    const source = { module: "SALES", documentType: "SALES_ORDER", documentId: "SO-1", eventId: "change-1" };
    await inventoryService.releaseReservation(7, { source, version: 2, quantity: 3, idempotencyKey: "release-1" });
    await inventoryService.cancelReservation(7, { source, version: 3, idempotencyKey: "cancel-1" });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/inventory/reservations/7/release", {
        idempotent: true, idempotencyKey: "release-1", body: { source, version: 2, quantity: 3 }
      }],
      ["/api/v1/inventory/reservations/7/cancel", {
        idempotent: true, idempotencyKey: "cancel-1", body: { source, version: 3 }
      }]
    ]);
  });

  it("does not retry a version conflict", async () => {
    const conflict = Object.assign(new Error("stale"), { code: "VERSION_CONFLICT" });
    httpClient.post.mockRejectedValue(conflict);
    await expect(inventoryService.updateWarehouse(3, { version: 1 })).rejects.toBe(conflict);
    expect(httpClient.post).toHaveBeenCalledTimes(1);
  });

  it("has Traditional Chinese messages for every Warehouse and Bin public error", () => {
    for (const code of [
      "INVENTORY_INPUT_INVALID", "WAREHOUSE_INVALID", "BIN_INVALID", "WAREHOUSE_CODE_TAKEN",
      "BIN_CODE_TAKEN", "WAREHOUSE_IN_USE", "BIN_IN_USE", "VERSION_CONFLICT",
      "PERMISSION_STALE", "INVENTORY_RESOURCE_NOT_FOUND"
    ]) {
      expect(ERROR_CODE_MESSAGES[code]).toMatch(/[\u3400-\u9fff]/u);
    }
  });
});
