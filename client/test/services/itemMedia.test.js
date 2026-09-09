import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { post: vi.fn(), getBlob: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import itemMediaService, { service } from "@/services/itemMedia.js";

describe("itemMedia service", () => {
  beforeEach(() => {
    httpClient.post.mockReset();
    httpClient.getBlob.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("itemMedia");
  });

  it("uploadItemMedia() 打 items/:id/media/upload，帶 FormData 唔係 JSON body", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });
    const file = new File(["bytes"], "logo.png", { type: "image/png" });

    await itemMediaService.uploadItemMedia({
      itemId: 5,
      kind: "image",
      isPrimary: true,
      sortOrder: 2,
      version: 3,
      file
    });

    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v1/items/5/media/upload",
      expect.objectContaining({ body: expect.any(FormData) })
    );
    const body = httpClient.post.mock.calls[0][1].body;
    expect(body.get("kind")).toBe("image");
    expect(body.get("isPrimary")).toBe("true");
    expect(body.get("sortOrder")).toBe("2");
    expect(body.get("version")).toBe("3");
    expect(body.get("file")).toBe(file);
  });

  it("uploadItemMedia() 冇提供 isPrimary／sortOrder 就唔送呢兩個欄位（唔係送空字串或者 undefined 字面值）", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });
    const file = new File(["bytes"], "spec.pdf", { type: "application/pdf" });

    await itemMediaService.uploadItemMedia({ itemId: 5, kind: "attachment", version: 1, file });

    const body = httpClient.post.mock.calls[0][1].body;
    expect(body.has("isPrimary")).toBe(false);
    expect(body.has("sortOrder")).toBe(false);
  });

  it("isPrimary 一定序列化做完全等於 \"true\" 或 \"false\" 嘅字串，唔會出現任意 truthy 字串", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });
    const file = new File(["bytes"], "logo.png", { type: "image/png" });

    await itemMediaService.uploadItemMedia({ itemId: 5, kind: "image", isPrimary: false, version: 1, file });

    expect(httpClient.post.mock.calls[0][1].body.get("isPrimary")).toBe("false");
  });

  it("uploadSkuMedia() 打 skus/:id/media/upload", async () => {
    httpClient.post.mockResolvedValue({ id: 2 });
    const file = new File(["bytes"], "spec.pdf", { type: "application/pdf" });

    await itemMediaService.uploadSkuMedia({ skuId: 7, kind: "attachment", version: 1, file });

    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v1/skus/7/media/upload",
      expect.objectContaining({ body: expect.any(FormData) })
    );
  });

  it("downloadMedia() 打 GET item-media/:id/download 用 getBlob()，唔套用 JSON envelope", async () => {
    const fakeResult = { blob: new Blob(["x"]), contentType: "image/png" };
    httpClient.getBlob.mockResolvedValue(fakeResult);

    const result = await itemMediaService.downloadMedia(9);

    expect(result).toBe(fakeResult);
    expect(httpClient.getBlob).toHaveBeenCalledWith("/api/v1/item-media/9/download", { signal: undefined });
  });

  it("updateMedia() 淨係送有提供嘅欄位", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });

    await itemMediaService.updateMedia(1, { sortOrder: 3 });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/item-media/1/update", { body: { sortOrder: 3 } });
  });

  it("deleteMedia() 帶 reason／password", async () => {
    httpClient.post.mockResolvedValue({ id: 1 });

    await itemMediaService.deleteMedia(1, { reason: "唔要喇", password: "pw" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/item-media/1/delete", {
      body: { reason: "唔要喇", password: "pw" }
    });
  });
});
