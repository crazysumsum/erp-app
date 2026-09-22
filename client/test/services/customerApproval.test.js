import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import customerApprovalService, { service } from "@/services/customerApproval.js";

describe("customer approval service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares the discovery name and maps a cancellable queue", async () => {
    const signal = new AbortController().signal;
    httpClient.get.mockResolvedValue({ items: [{ id: 11 }], total: 1 });
    expect(service.name).toBe("customerApproval");
    await expect(customerApprovalService.queue({ scope: "mine", status: "pending", requesterId: 8, requestedFrom: 1_700_000_000_000, requestedTo: 1_700_086_400_000, page: 1, rowsPerPage: 20, signal }))
      .resolves.toEqual({ rows: [{ id: 11 }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/customer-approvals", {
      params: { scope: "mine", status: "pending", requesterId: 8, requestedFrom: 1_700_000_000_000, requestedTo: 1_700_086_400_000, page: 1, pageSize: 20 }, signal
    });
  });

  it("uses idempotent password decisions without a device signature", async () => {
    await customerApprovalService.approve(11, { password: "pw", version: 1 });
    await customerApprovalService.reject(11, { reason: "Incomplete", password: "pw", version: 1 });
    await customerApprovalService.reassign(11, { approverUserId: 4, password: "pw", version: 1 });
    expect(httpClient.post.mock.calls).toEqual([
      ["/api/v1/customer-approvals/11/approve", { idempotent: true, body: { password: "pw", version: 1 } }],
      ["/api/v1/customer-approvals/11/reject", { idempotent: true, body: { reason: "Incomplete", password: "pw", version: 1 } }],
      ["/api/v1/customer-approvals/11/reassign", { idempotent: true, body: { approverUserId: 4, password: "pw", version: 1 } }]
    ]);
  });

  it("keeps an approval retry key out of the strict decision body", async () => {
    await customerApprovalService.approve(11, { password: "pw", version: 1, idempotencyKey: "approval-11-v1" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/customer-approvals/11/approve", {
      idempotent: true,
      idempotencyKey: "approval-11-v1",
      body: { password: "pw", version: 1 }
    });
  });
});
