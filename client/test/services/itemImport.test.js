import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), getBlob: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import itemImportService, { service } from "@/services/itemImport.js";

describe("itemImport service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
    httpClient.post.mockReset();
    httpClient.getBlob.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("itemImport");
  });

  it("downloadTemplate() 打 GET template 用 getBlob()", async () => {
    const fakeResult = { blob: new Blob(["x"]), contentType: "text/csv" };
    httpClient.getBlob.mockResolvedValue(fakeResult);

    const result = await itemImportService.downloadTemplate();

    expect(result).toBe(fakeResult);
    expect(httpClient.getBlob).toHaveBeenCalledWith("/api/v1/item-imports/template", { signal: undefined });
  });

  it("uploadJob() 帶 FormData 同 idempotent:true（route 有 idempotency: enabled）", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });
    const file = new File(["a,b\n1,2"], "import.csv", { type: "text/csv" });

    await itemImportService.uploadJob({ file, mode: "create_only" });

    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v1/item-imports/upload",
      expect.objectContaining({ body: expect.any(FormData), idempotent: true })
    );
    const body = httpClient.post.mock.calls[0][1].body;
    expect(body.get("mode")).toBe("create_only");
    expect(body.get("file")).toBe(file);
  });

  it("listJobs() 帶 page／pageSize／status query", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await itemImportService.listJobs({ page: 2, pageSize: 10, status: "ready" });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/item-imports", {
      params: { page: 2, pageSize: 10, status: "ready" },
      signal: undefined
    });
  });

  it("getJob() 打 GET :id，帶分頁及 rowStatus query", async () => {
    httpClient.get.mockResolvedValue({ job: {}, rows: { items: [], total: 0, page: 1, pageSize: 20 } });

    await itemImportService.getJob(5, { page: 1, pageSize: 20, rowStatus: "invalid" });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/item-imports/5", {
      params: { page: 1, pageSize: 20, rowStatus: "invalid" },
      signal: undefined
    });
  });

  it("confirmJob() 帶 reason／version／password", async () => {
    httpClient.post.mockResolvedValue({ id: 1, status: "queued" });

    await itemImportService.confirmJob(5, { reason: "整合測試", version: 3, password: "pw" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/item-imports/5/confirm", {
      body: { reason: "整合測試", version: 3, password: "pw" }
    });
  });

  it("cancelJob() 帶空 body", async () => {
    httpClient.post.mockResolvedValue({ id: 1, status: "cancelled" });

    await itemImportService.cancelJob(5);

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/item-imports/5/cancel", { body: {} });
  });

  it("downloadResult() 打 GET :id/result 用 getBlob()", async () => {
    const fakeResult = { blob: new Blob(["x"]), contentType: "text/csv" };
    httpClient.getBlob.mockResolvedValue(fakeResult);

    const result = await itemImportService.downloadResult(5);

    expect(result).toBe(fakeResult);
    expect(httpClient.getBlob).toHaveBeenCalledWith("/api/v1/item-imports/5/result", { signal: undefined });
  });

  it("exportSkus() 淨係送有提供嘅篩選欄位做 query string", async () => {
    const fakeResult = { blob: new Blob(["x"]), contentType: "text/csv" };
    httpClient.getBlob.mockResolvedValue(fakeResult);

    await itemImportService.exportSkus({ q: "牌子", status: "active" });

    expect(httpClient.getBlob).toHaveBeenCalledWith("/api/v1/item-exports/skus?q=%E7%89%8C%E5%AD%90&status=active", {
      signal: undefined
    });
  });

  it("exportSkus() 冇任何篩選就打冇 query string 嘅路徑", async () => {
    httpClient.getBlob.mockResolvedValue({ blob: new Blob(["x"]), contentType: "text/csv" });

    await itemImportService.exportSkus();

    expect(httpClient.getBlob).toHaveBeenCalledWith("/api/v1/item-exports/skus", { signal: undefined });
  });
});
