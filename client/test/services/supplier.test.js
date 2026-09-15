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
});
