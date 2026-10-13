import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn() } }));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierService from "@/services/supplier.js";

describe("supplier service: SKU relations (TASK-039)", () => {
  beforeEach(() => { httpClient.get.mockReset(); httpClient.post.mockReset(); });

  it("listSkuRelations() pages on the server and returns DataTable's { rows, rowsNumber }", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 91 }], total: 1, page: 2, pageSize: 10 });
    expect(await supplierService.listSkuRelations(7, { page: 2, rowsPerPage: 10, filter: "TEA" })).toEqual({ rows: [{ id: 91 }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/suppliers/7/sku-relations", { params: { page: 2, pageSize: 10, q: "TEA" } });
    await supplierService.listSkuRelations(7, { page: 1, rowsPerPage: 20, filter: "" });
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/suppliers/7/sku-relations", { params: { page: 1, pageSize: 20, q: undefined } });
  });

  it("create and update post to the relation routes", async () => {
    httpClient.post.mockResolvedValue({});
    await supplierService.createSkuRelation(7, { skuId: 51 });
    await supplierService.updateSkuRelation(7, 91, { version: 3 });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/suppliers/7/sku-relations/create", { body: { skuId: 51 } }],
      ["/api/v1/suppliers/7/sku-relations/91/update", { body: { version: 3 } }]
    ]);
  });

  it("searchPurchasableSkus() asks the Supplier lookup, not an Item route, and passes the abort signal", async () => {
    const signal = new AbortController().signal;
    httpClient.get.mockResolvedValue({ items: [], total: 0 });
    await supplierService.searchPurchasableSkus({ q: "tea", signal });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-lookups/skus", { params: { q: "tea", pageSize: 20 }, signal });
  });
});
