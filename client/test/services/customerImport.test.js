import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() } }));

import { httpClient } from "@/framework/http/HttpClient.js";
import customerImportService, { service } from "@/services/customerImport.js";

describe("customer import/export service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares the discovery name and uses idempotent high-risk writes", async () => {
    expect(service.name).toBe("customerImport");
    await customerImportService.confirmJob(7, { version: 2, activationMode: "draft", password: "pw" });
    await customerImportService.createExport({ filters: { q: "Acme" }, password: "pw" });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/customer-imports/7/confirm", { body: { version: 2, activationMode: "draft", approverUserId: undefined, password: "pw" }, idempotent: true }],
      ["/api/v1/customer-exports/create", { body: { filters: { q: "Acme" }, password: "pw" }, idempotent: true }]
    ]);
  });

  it("sends multipart upload and owner-scoped result downloads", async () => {
    const file = new File(["csv"], "customers.csv", { type: "text/csv" });
    await customerImportService.uploadJob({ file, mode: "upsert" });
    await customerImportService.downloadResult(8);
    await customerImportService.downloadExport(9);
    expect(httpClient.post.mock.calls[0][0]).toBe("/api/v1/customer-imports/upload");
    expect(httpClient.post.mock.calls[0][1]).toMatchObject({ body: expect.any(FormData), idempotent: true });
    expect(httpClient.getBlob).toHaveBeenNthCalledWith(1, "/api/v1/customer-imports/8/result", { signal: undefined });
    expect(httpClient.getBlob).toHaveBeenNthCalledWith(2, "/api/v1/customer-exports/9/result", { signal: undefined });
  });
});
