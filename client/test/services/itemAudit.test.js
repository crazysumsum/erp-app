import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import itemAuditService, { service } from "@/services/itemAudit.js";

describe("item audit service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
  });

  it("list() 將 DataTable 參數及 Item audit 篩選轉成 API query", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 3, page: 1, pageSize: 20 });

    await expect(
      itemAuditService.list({
        page: 1,
        rowsPerPage: 20,
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        actor: "sam",
        target: "SKU-001",
        action: "sku.update",
        targetType: "sku"
      })
    ).resolves.toEqual({ rows: [{ id: 1 }], rowsNumber: 3 });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/item-audit/logs", {
      params: {
        page: 1,
        pageSize: 20,
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        actor: "sam",
        target: "SKU-001",
        action: "sku.update",
        targetType: "sku"
      }
    });
  });

  it("list() 省略空白篩選，讓後端使用預設值", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await itemAuditService.list({
      page: 1,
      rowsPerPage: 20,
      from: undefined,
      to: undefined,
      actor: "",
      target: "",
      action: null,
      targetType: null
    });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/item-audit/logs", {
      params: {
        page: 1,
        pageSize: 20,
        from: undefined,
        to: undefined,
        actor: undefined,
        target: undefined,
        action: undefined,
        targetType: undefined
      }
    });
  });

  it("exports the service discovery metadata", () => {
    expect(service).toEqual({ name: "itemAudit" });
  });
});
