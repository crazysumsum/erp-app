import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import itemService, { service } from "@/services/item.js";

describe("item service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("item");
  });

  it("listItems() 轉做 DataTable 需要嘅 { rows, rowsNumber } 形狀", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, name: "維他命 C" }], total: 1, page: 1, pageSize: 20 });

    const result = await itemService.listItems({ page: 1, rowsPerPage: 20 });

    expect(result).toEqual({ rows: [{ id: 1, name: "維他命 C" }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/items", {
      params: {
        page: 1,
        pageSize: 20,
        q: undefined,
        categoryId: undefined,
        brandId: undefined,
        status: undefined,
        sortBy: undefined,
        descending: undefined
      }
    });
  });

  it("listItems() 帶埋 filter／categoryId／brandId／status／sortBy／descending", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0 });

    await itemService.listItems({
      page: 2,
      rowsPerPage: 50,
      filter: "維他命",
      categoryId: 3,
      brandId: 8,
      status: "active",
      sortBy: "name",
      descending: false
    });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/items", {
      params: {
        page: 2,
        pageSize: 50,
        q: "維他命",
        categoryId: 3,
        brandId: 8,
        status: "active",
        sortBy: "name",
        descending: false
      }
    });
  });

  it("getItem(id) 直接打 GET /api/v1/items/:id", async () => {
    httpClient.get.mockResolvedValue({ id: 1, name: "維他命 C" });

    const item = await itemService.getItem(1);

    expect(item).toEqual({ id: 1, name: "維他命 C" });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/items/1");
  });

  it("listSkus() 轉做 DataTable 需要嘅形狀，帶埋全部篩選欄位", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 5, skuCode: "SKU-1" }], total: 1 });

    const result = await itemService.listSkus({
      page: 1,
      rowsPerPage: 20,
      filter: "SKU-1",
      itemId: 1,
      categoryId: 3,
      brandId: 8,
      status: "active",
      purchasable: true,
      sellable: false,
      sortBy: "skuCode",
      descending: true
    });

    expect(result).toEqual({ rows: [{ id: 5, skuCode: "SKU-1" }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/skus", {
      params: {
        page: 1,
        pageSize: 20,
        q: "SKU-1",
        itemId: 1,
        categoryId: 3,
        brandId: 8,
        status: "active",
        purchasable: true,
        sellable: false,
        sortBy: "skuCode",
        descending: true
      }
    });
  });

  it("listSkus() 冇帶 purchasable／sellable 就唔篩呢兩個欄位（送 undefined，唔係 false）", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0 });

    await itemService.listSkus({ page: 1, rowsPerPage: 20 });

    const params = httpClient.get.mock.calls[0][1].params;
    expect(params.purchasable).toBeUndefined();
    expect(params.sellable).toBeUndefined();
  });

  it("getSku(id) 直接打 GET /api/v1/skus/:id", async () => {
    httpClient.get.mockResolvedValue({ id: 5, skuCode: "SKU-1" });

    const sku = await itemService.getSku(5);

    expect(sku).toEqual({ id: 5, skuCode: "SKU-1" });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/skus/5");
  });

  it("checkDuplicates() 打 POST /items/duplicates/check，唔帶 idempotent（純警告冇副作用）", async () => {
    httpClient.post.mockResolvedValue({ candidates: [] });

    await itemService.checkDuplicates({ name: "維他命 C", categoryId: 3, brandId: 8 });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/items/duplicates/check", {
      body: { name: "維他命 C", categoryId: 3, brandId: 8 },
      signal: undefined
    });
  });

  it("bulkChangeStatus() 打 POST /item-bulk/status/change，帶 targetType／action／targets／reason／password", async () => {
    httpClient.post.mockResolvedValue({ results: [] });

    await itemService.bulkChangeStatus({
      targetType: "sku",
      action: "archive",
      targets: [{ id: 1, version: 1 }, { id: 2, version: 3 }],
      reason: "批量封存",
      password: "hunter2"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/item-bulk/status/change", {
      body: {
        targetType: "sku",
        action: "archive",
        targets: [{ id: 1, version: 1 }, { id: 2, version: 3 }],
        reason: "批量封存",
        password: "hunter2"
      }
    });
  });
});
