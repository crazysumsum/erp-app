import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({ httpClient: { get: vi.fn() } }));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierAuditService from "@/services/supplierAudit.js";

describe("supplier audit service (DEF-035)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pages the read-only audit API and drops empty filters", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 31, page: 2, pageSize: 20 });
    const result = await supplierAuditService.list({ page: 2, rowsPerPage: 20, from: 100, to: undefined, actor: "", target: "SUP-007",
      action: null, targetType: "bank", supplierId: 7 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/supplier-audit/logs", { params: {
      page: 2, pageSize: 20, from: 100, to: undefined, actor: undefined, target: "SUP-007", action: undefined, targetType: "bank", supplierId: 7
    } });
    expect(result).toEqual({ rows: [{ id: 1 }], rowsNumber: 31 });
  });
});
