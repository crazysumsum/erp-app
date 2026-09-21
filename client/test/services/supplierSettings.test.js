import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierSettingsService from "@/services/supplierSettings.js";

describe("supplier settings service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the settings singleton without a password", async () => {
    await supplierSettingsService.get();
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-settings");
  });

  it("signs the update, because the backend demands an approved device and a password", async () => {
    // 設計 §6.7：寫入設定同 Bank／封鎖同一個認證強度。冇 signed: true 就會喺
    // 後端變成 401，而唔係一個睇得出嘅前端錯誤。
    const payload = { requireActivationApproval: true, version: 3, reason: "公司政策改變", password: "pw" };
    await supplierSettingsService.update(payload);
    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v1/supplier-settings/update",
      { body: payload, signed: true }
    );
  });

  it("reads Business Master readiness through the Supplier lookup, never the owner's endpoint", async () => {
    // HD-022：直接叫 /api/v1/business-master/... 會要求 business_master.view，
    // 而設定頁閘嘅係 supplier.settings。
    await supplierSettingsService.businessMasterReadiness();
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-lookups/business-master");
    const touched = httpClient.get.mock.calls.concat(httpClient.post.mock.calls).map(([path]) => path);
    expect(touched.some((path) => path.startsWith("/api/v1/business-master"))).toBe(false);
  });
});
