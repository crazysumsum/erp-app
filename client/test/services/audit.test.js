import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import auditService, { service } from "@/services/audit.js";

describe("audit service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("audit");
  });

  it("list() 將 DataTable 嘅參數形狀加埋篩選欄位翻做後端 query，回應翻做 { rows, rowsNumber }", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 3, page: 1, pageSize: 20 });

    const result = await auditService.list({
      page: 1,
      rowsPerPage: 20,
      from: 1_700_000_000_000,
      to: 1_700_086_400_000,
      actor: "sam",
      target: "amy",
      action: "user.roles"
    });

    expect(result).toEqual({ rows: [{ id: 1 }], rowsNumber: 3 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/audit/logs", {
      params: {
        page: 1,
        pageSize: 20,
        from: 1_700_000_000_000,
        to: 1_700_086_400_000,
        actor: "sam",
        target: "amy",
        action: "user.roles"
      }
    });
  });

  it("list() 冇任何篩選就唔帶嗰幾個 query key（等後端用返自己嘅預設值）", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await auditService.list({
      page: 1,
      rowsPerPage: 20,
      from: undefined,
      to: undefined,
      actor: "",
      target: "",
      action: null
    });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/audit/logs", {
      params: {
        page: 1,
        pageSize: 20,
        from: undefined,
        to: undefined,
        actor: undefined,
        target: undefined,
        action: undefined
      }
    });
  });
});
