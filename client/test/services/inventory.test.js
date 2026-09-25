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
