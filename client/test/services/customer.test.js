import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import customerService, { service } from "@/services/customer.js";

describe("customer service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares the discovery name", () => {
    expect(service.name).toBe("customer");
  });

  it("maps a cancellable Customer list to DataTable shape", async () => {
    const signal = new AbortController().signal;
    httpClient.get.mockResolvedValue({ items: [{ id: 7 }], total: 1 });

    await expect(customerService.list({ page: 1, rowsPerPage: 20, sortBy: "code", descending: false, filter: "CUS", status: "active", signal }))
      .resolves.toEqual({ rows: [{ id: 7 }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/customers", {
      params: expect.objectContaining({ page: 1, pageSize: 20, q: "CUS", status: "active", sortBy: "code", sortDirection: "asc" }),
      signal
    });
  });

  it("uses idempotency for root and party writes, signing only device-password routes", async () => {
    const root = { customerCode: "CUS-007", legalName: "Customer Seven" };
    const lifecycle = { reason: "Compliance block", password: "pw", version: 2 };
    await customerService.create(root);
    await customerService.update(7, { ...root, version: 1 });
    await customerService.changeCode(7, { customerCode: "CUS-NEW", reason: "Correct typo", password: "pw", version: 2 });
    await customerService.block(7, lifecycle);
    await customerService.createAddress(7, { label: "Head office", purposes: [] });

    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/customers/create", { idempotent: true, body: root }],
      ["/api/v1/customers/7/update", { idempotent: true, body: { ...root, version: 1 } }],
      ["/api/v1/customers/7/code/change", { idempotent: true, signed: true, body: { customerCode: "CUS-NEW", reason: "Correct typo", password: "pw", version: 2 } }],
      ["/api/v1/customers/7/block", { idempotent: true, signed: true, body: lifecycle }],
      ["/api/v1/customers/7/addresses/create", { idempotent: true, body: { label: "Head office", purposes: [] } }]
    ]);
  });

  it("moves a caller-supplied retry key to the idempotency header without adding it to the strict body", async () => {
    await customerService.activate(7, { version: 2, idempotencyKey: "customer-activate-7-v2" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/customers/7/activate", {
      idempotent: true,
      idempotencyKey: "customer-activate-7-v2",
      body: { version: 2 }
    });
  });

  it("preserves versioned child and credit-policy routes", async () => {
    await customerService.updateContact(7, 3, { name: "Amy", purposes: [], version: 2 });
    await customerService.deactivateIdentifier(7, 4, { reason: "Expired", version: 3 });
    await customerService.saveCreditPolicy(7, { creditLimit: "100.0000", creditCurrencyCode: "HKD", creditStatus: "normal", creditNotes: "Reviewed", reason: "Set policy", version: 1 });
    await customerService.clearCreditPolicy(7, { reason: "Review", password: "pw", version: 2 });

    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/customers/7/contacts/3/update", { idempotent: true, body: { name: "Amy", purposes: [], version: 2 } }],
      ["/api/v1/customers/7/identifiers/4/deactivate", { idempotent: true, body: { reason: "Expired", version: 3 } }],
      ["/api/v1/customers/7/credit-policy/save", { idempotent: true, body: { creditLimit: "100.0000", creditCurrencyCode: "HKD", creditStatus: "normal", creditNotes: "Reviewed", reason: "Set policy", version: 1 } }],
      ["/api/v1/customers/7/credit-policy/clear", { idempotent: true, body: { reason: "Review", password: "pw", version: 2 } }]
    ]);
  });

  it("passes child-list pagination and cancellation through unchanged", async () => {
    const signal = new AbortController().signal;
    await customerService.addresses(7, { page: 2, rowsPerPage: 50, signal });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/customers/7/addresses", {
      params: { page: 2, pageSize: 50 }, signal
    });
  });
});
