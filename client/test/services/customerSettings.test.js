import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import customerSettingsService, { service } from "@/services/customerSettings.js";
import customerCatalogService, { service as catalogService } from "@/services/customerCatalog.js";

describe("customer settings and catalog services", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares discoverable services and signs only settings/catalog writes", async () => {
    expect(service.name).toBe("customerSettings");
    expect(catalogService.name).toBe("customerCatalog");
    await customerSettingsService.get({ signal: new AbortController().signal });
    await customerSettingsService.update({ requireActivationApproval: true, reason: "Policy", password: "pw", version: 1 });
    await customerCatalogService.list("customer-type", { includeInactive: true });
    await customerCatalogService.create("customer-type", { code: "retail", name: "Retail", password: "pw" });

    expect(httpClient.get.mock.calls).toEqual([
      ["/api/v1/customer-settings", expect.objectContaining({ signal: expect.any(AbortSignal) })],
      ["/api/v1/customer-catalog/customer-type", { params: { includeInactive: true } }]
    ]);
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/customer-settings/update", { body: { requireActivationApproval: true, reason: "Policy", password: "pw", version: 1 }, signed: true }],
      ["/api/v1/customer-catalog/customer-type/create", { body: { code: "retail", name: "Retail", password: "pw" }, signed: true }]
    ]);
  });
});
