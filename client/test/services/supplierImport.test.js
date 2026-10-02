import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierImportService from "@/services/supplierImport.js";

describe("supplier import service (T44)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the job list to the DataTable shape and drops an empty status filter", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 3 }], total: 41, page: 2, pageSize: 20 });
    await expect(supplierImportService.listJobs({ page: 2, rowsPerPage: 20, status: "" }))
      .resolves.toEqual({ rows: [{ id: 3 }], rowsNumber: 41 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-imports",
      { params: { page: 2, pageSize: 20, status: undefined }, signal: undefined });
  });

  it("keeps the job summary beside the paged rows", async () => {
    httpClient.get.mockResolvedValue({ job: { id: 7, status: "ready" }, rows: [{ rowNumber: 1 }], total: 9, page: 1, pageSize: 50 });
    await expect(supplierImportService.getJob(7, { page: 1, rowsPerPage: 50, rowStatus: "invalid" }))
      .resolves.toEqual({ job: { id: 7, status: "ready" }, rows: [{ rowNumber: 1 }], rowsNumber: 9 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-imports/7",
      { params: { page: 1, pageSize: 50, rowStatus: "invalid" }, signal: undefined });
  });

  it("cancels with the job version and an idempotency key", async () => {
    await supplierImportService.cancelJob(7, 4);
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/supplier-imports/7/cancel", { body: { version: 4 }, idempotent: true });
  });
});
