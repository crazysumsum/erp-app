import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import itemCatalogService, { service } from "@/services/itemCatalog.js";

describe("itemCatalog service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
    httpClient.post.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("itemCatalog");
  });

  it("categoryTree() 預設唔帶 includeArchived", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, name: "Vitamins" }] });

    expect(await itemCatalogService.categoryTree()).toEqual([{ id: 1, name: "Vitamins" }]);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/catalog/categories", {
      params: { includeArchived: undefined }
    });
  });

  it("categoryTree({ includeArchived: true }) 帶字串 'true'", async () => {
    httpClient.get.mockResolvedValue({ items: [] });

    await itemCatalogService.categoryTree({ includeArchived: true });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/catalog/categories", {
      params: { includeArchived: "true" }
    });
  });

  it("createCategory() 冇帶 parentId 就送 null，唔簽章唔帶密碼", async () => {
    httpClient.post.mockResolvedValue({ id: 2, name: "Gummies" });

    await itemCatalogService.createCategory({ name: "Gummies" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/create", {
      body: { name: "Gummies", parentId: null, sortOrder: 0 }
    });
  });

  it("createCategory() 帶 parentId／sortOrder", async () => {
    httpClient.post.mockResolvedValue({ id: 3, name: "Snacks" });

    await itemCatalogService.createCategory({ name: "Snacks", parentId: 1, sortOrder: 5 });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/create", {
      body: { name: "Snacks", parentId: 1, sortOrder: 5 }
    });
  });

  it("updateCategory() 整組覆蓋，parentId 可以係 null（移到根層級）", async () => {
    httpClient.post.mockResolvedValue({ id: 2, name: "Renamed" });

    await itemCatalogService.updateCategory(2, {
      name: "Renamed",
      parentId: null,
      sortOrder: 1,
      version: 3
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/update", {
      body: { name: "Renamed", parentId: null, sortOrder: 1, version: 3 }
    });
  });

  it("activateCategory()／deactivateCategory() 帶 reason 同 version，唔帶 password", async () => {
    httpClient.post.mockResolvedValue({ id: 2, status: "active" });
    await itemCatalogService.activateCategory(2, { reason: "重新上架", version: 1 });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/activate", {
      body: { reason: "重新上架", version: 1 }
    });

    httpClient.post.mockResolvedValue({ id: 2, status: "inactive" });
    await itemCatalogService.deactivateCategory(2, { reason: "暫停使用", version: 2 });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/deactivate", {
      body: { reason: "暫停使用", version: 2 }
    });
  });

  it("archiveCategory()／restoreCategory()／deleteCategory() 帶 reason／version／password，唔簽章", async () => {
    httpClient.post.mockResolvedValue({ id: 2, status: "archived" });
    await itemCatalogService.archiveCategory(2, { reason: "停產", version: 3, password: "hunter2" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/archive", {
      body: { reason: "停產", version: 3, password: "hunter2" }
    });

    httpClient.post.mockResolvedValue({ id: 2, status: "inactive" });
    await itemCatalogService.restoreCategory(2, { reason: "恢復使用", version: 4, password: "hunter2" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/restore", {
      body: { reason: "恢復使用", version: 4, password: "hunter2" }
    });

    httpClient.post.mockResolvedValue({ id: 2 });
    await itemCatalogService.deleteCategory(2, { reason: "建立錯誤", version: 5, password: "hunter2" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/catalog/categories/2/delete", {
      body: { reason: "建立錯誤", version: 5, password: "hunter2" }
    });
  });
});
