import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierService, { service } from "@/services/supplier.js";

describe("supplier service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declares its discovery name", () => {
    expect(service.name).toBe("supplier");
  });

  it("creates a supplier with framework idempotency", async () => {
    httpClient.post.mockResolvedValue({ id: 41, supplierCode: "SUP-041" });

    await supplierService.create({
      supplierCode: "SUP-041",
      supplierName: "Evergreen Trading",
      defaultCurrencyCode: "HKD",
      defaultCurrencyVersion: 3,
      activate: true
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/suppliers/create", {
      idempotent: true,
      body: {
        supplierCode: "SUP-041",
        supplierName: "Evergreen Trading",
        defaultCurrencyCode: "HKD",
        defaultCurrencyVersion: 3,
        activate: true
      }
    });
  });

  it("checks duplicate candidates without marking a read as idempotent", async () => {
    httpClient.post.mockResolvedValue({ duplicateCandidates: [] });

    await supplierService.checkDuplicates({ supplierCode: "SUP-041", supplierName: "Evergreen Trading" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/suppliers/duplicates/check", {
      body: { supplierCode: "SUP-041", supplierName: "Evergreen Trading" }
    });
  });

  it("maps paged Supplier results to DataTable shape", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 7 }], total: 1, page: 1, pageSize: 20 });
    const result = await supplierService.list({
      page: 1, rowsPerPage: 20, sortBy: "supplierCode", descending: false, filter: "SUP", status: "active"
    });
    expect(result).toEqual({ rows: [{ id: 7 }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/suppliers", {
      params: expect.objectContaining({ page: 1, pageSize: 20, q: "SUP", status: "active", sortBy: "supplierCode" })
    });
  });

  it("loads detail and completeness by Supplier id", async () => {
    httpClient.get.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ supplierId: 7, issues: [], warnings: [] });
    expect(await supplierService.getById(7)).toEqual({ id: 7 });
    expect(await supplierService.completeness(7)).toEqual({ supplierId: 7, issues: [], warnings: [] });
    expect(httpClient.get.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/suppliers/7",
      "/api/v1/suppliers/7/completeness"
    ]);
  });
});
