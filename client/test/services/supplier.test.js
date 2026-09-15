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

  it("uses ownership-scoped versioned Address routes", async () => {
    httpClient.post.mockResolvedValue({ id: 12 });
    await supplierService.createAddress(7, { label: "總部", purposes: [] });
    await supplierService.updateAddress(7, 12, { label: "新總部", purposes: [], version: 2 });
    await supplierService.deactivateAddress(7, 12, { version: 3 });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/suppliers/7/addresses/create", { body: { label: "總部", purposes: [] } }],
      ["/api/v1/suppliers/7/addresses/12/update", { body: { label: "新總部", purposes: [], version: 2 } }],
      ["/api/v1/suppliers/7/addresses/12/deactivate", { body: { version: 3 } }]
    ]);
  });

  it("uses ownership-scoped versioned Contact routes", async () => {
    httpClient.post.mockResolvedValue({ id: 21 });
    await supplierService.createContact(7, { name: "Amy Chan", purposes: [] });
    await supplierService.updateContact(7, 21, { name: "Amy Lee", purposes: [], version: 2 });
    await supplierService.deactivateContact(7, 21, { version: 3 });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/suppliers/7/contacts/create", { body: { name: "Amy Chan", purposes: [] } }],
      ["/api/v1/suppliers/7/contacts/21/update", { body: { name: "Amy Lee", purposes: [], version: 2 } }],
      ["/api/v1/suppliers/7/contacts/21/deactivate", { body: { version: 3 } }]
    ]);
  });

  it("uses ownership-scoped reasoned Identifier routes", async () => {
    httpClient.post.mockResolvedValue({ id: 31 });
    await supplierService.createIdentifier(7, { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1" });
    await supplierService.updateIdentifier(7, 31, { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-2", version: 2, reason: "correct" });
    await supplierService.deleteIdentifier(7, 31, { version: 3, reason: "entered in error" });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/suppliers/7/identifiers/create", { body: { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-1" } }],
      ["/api/v1/suppliers/7/identifiers/31/update", { body: { identifierType: "tax", issuerCountryCode: "HK", identifierValue: "T-2", version: 2, reason: "correct" } }],
      ["/api/v1/suppliers/7/identifiers/31/delete", { body: { version: 3, reason: "entered in error" } }]
    ]);
  });
});
