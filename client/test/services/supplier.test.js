import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), postBlob: vi.fn() }
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

  it("exports with the list's filters and sort behind a password (HD-067)", async () => {
    httpClient.postBlob.mockResolvedValue({ blob: "b", fileName: "suppliers-x.csv" });
    const signal = new AbortController().signal;
    const result = await supplierService.exportCsv({
      filter: "SUP", status: null, sortBy: "supplierName", descending: false, password: "pw", signal
    });
    expect(result).toEqual({ blob: "b", fileName: "suppliers-x.csv" });
    expect(httpClient.postBlob).toHaveBeenCalledWith("/api/v1/supplier-exports", {
      body: { password: "pw", filters: { q: "SUP", status: undefined, sortBy: "supplierName", descending: false } }, signal
    });
  });

  it("sends every HD-107 list filter, drops empty ones, and exports with the same filters", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    httpClient.postBlob.mockResolvedValue({ blob: "b", fileName: "x.csv" });
    const filters = {
      status: "", currencyCode: "USD", paymentTermId: 3, missingPrimaryContact: true, missingAddress: false,
      missingBank: true, includeArchived: true, createdFrom: 1000, createdTo: 2000, updatedFrom: undefined, updatedTo: null
    };
    await supplierService.list({ page: 2, rowsPerPage: 20, sortBy: "supplierCode", descending: false, filter: "", ...filters });
    const sent = { currencyCode: "USD", paymentTermId: 3, missingPrimaryContact: true, missingBank: true, includeArchived: true,
      createdFrom: 1000, createdTo: 2000 };
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/suppliers", {
      params: { page: 2, pageSize: 20, q: undefined, ...sent, sortBy: "supplierCode", descending: false }
    });
    await supplierService.exportCsv({ filter: "SUP", sortBy: "supplierCode", descending: false, password: "pw", ...filters });
    expect(httpClient.postBlob.mock.calls[0][1].body.filters).toEqual({ q: "SUP", ...sent, sortBy: "supplierCode", descending: false });
  });

  it("pages addresses and contacts past the detail's 100 (HD-107 G5)", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 100 });
    await supplierService.listAddresses(7, { page: 2, pageSize: 100 });
    await supplierService.listContacts(7, { page: 3, pageSize: 100 });
    expect(httpClient.get.mock.calls).toEqual([
      ["/api/v1/suppliers/7/addresses", { params: { page: 2, pageSize: 100 } }],
      ["/api/v1/suppliers/7/contacts", { params: { page: 3, pageSize: 100 } }]
    ]);
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

  it("uses normal Supplier update and a signed controlled Code correction", async () => {
    httpClient.post.mockResolvedValue({ id: 7 });
    await supplierService.update(7, { supplierName: "Updated", version: 2 });
    await supplierService.changeCode(7, { supplierCode: "SUP-NEW", reason: "Correct typo", password: "secret", version: 3 });
    expect(httpClient.post).toHaveBeenNthCalledWith(1, "/api/v1/suppliers/7/update", {
      body: { supplierName: "Updated", version: 2 }
    });
    expect(httpClient.post).toHaveBeenNthCalledWith(2, "/api/v1/suppliers/7/code/change", {
      body: { supplierCode: "SUP-NEW", reason: "Correct typo", password: "secret", version: 3 },
      signed: true
    });
  });

  it("maps lifecycle commands to their required password and device-signature levels", async () => {
    httpClient.post.mockResolvedValue({ id: 7 });
    const common = { reason: "Lifecycle reason", password: "secret", version: 2 };
    await supplierService.activate(7, { version: 2 });
    await supplierService.suspend(7, common);
    await supplierService.reactivate(7, common);
    await supplierService.block(7, common);
    await supplierService.unblock(7, common);
    await supplierService.archive(7, common);
    await supplierService.restore(7, common);
    await supplierService.deleteSupplier(7, common);
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/suppliers/7/activate", { body: { version: 2 } }],
      ["/api/v1/suppliers/7/suspend", { body: common }],
      ["/api/v1/suppliers/7/reactivate", { body: common }],
      ["/api/v1/suppliers/7/block", { body: common, signed: true }],
      ["/api/v1/suppliers/7/unblock", { body: common, signed: true }],
      ["/api/v1/suppliers/7/archive", { body: common }],
      ["/api/v1/suppliers/7/restore", { body: common }],
      ["/api/v1/suppliers/7/delete", { body: common, signed: true }]
    ]);
  });
});

describe("supplier service: SKU relations (TASK-039)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

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

  it("form options come from the Supplier lookups, with no parameters, as bare item arrays (DEF-036)", async () => {
    httpClient.get.mockImplementation(async (path) => ({ items: [path] }));
    expect(await supplierService.currencyOptions()).toEqual(["/api/v1/supplier-lookups/currencies"]);
    expect(await supplierService.paymentTermOptions()).toEqual(["/api/v1/supplier-lookups/payment-terms"]);
    expect(httpClient.get.mock.calls).toEqual([["/api/v1/supplier-lookups/currencies"], ["/api/v1/supplier-lookups/payment-terms"]]);
  });

  it("searchPurchasableSkus() asks the Supplier lookup, by text or by exact SKU ID, and passes the abort signal", async () => {
    const signal = new AbortController().signal;
    httpClient.get.mockResolvedValue({ items: [], total: 0 });
    await supplierService.searchPurchasableSkus({ q: "tea", signal });
    await supplierService.searchPurchasableSkus({ skuId: 51, signal });
    expect(httpClient.get.mock.calls).toEqual([
      ["/api/v1/supplier-lookups/skus", { params: { q: "tea", skuId: undefined, pageSize: 20 }, signal }],
      ["/api/v1/supplier-lookups/skus", { params: { q: undefined, skuId: 51, pageSize: 20 }, signal }]
    ]);
  });
});
