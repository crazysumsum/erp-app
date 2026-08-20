import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import deviceService, { service } from "@/services/device.js";
import { discoverPages } from "@/framework/discovery/pages.js";
import { validatePages } from "@/framework/discovery/validatePages.js";

describe("device service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
    httpClient.post.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    // 冇呢個 export，buildServiceRegistry 會喺開機嗰陣掉個錯，指名係邊個檔案。
    expect(service.name).toBe("device");
  });

  it("清單只攞信封入面嘅 items", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }] });

    expect(await deviceService.listPending()).toEqual([{ id: 1 }]);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/device/bindings/pending");

    httpClient.get.mockResolvedValue({ items: [] });
    expect(await deviceService.listMine()).toEqual([]);
    expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/device/bindings");
  });

  it("三個審批動作各自打各自嘅路徑", async () => {
    httpClient.post.mockResolvedValue({ id: 5, status: "approved" });

    // 路徑打錯字嘅症狀係 404，而畫面上淨係會見到一句「操作失敗」——所以逐條
    // 釘住。
    await deviceService.approve(5, "已致電確認");
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/device/bindings/5/approve", {
      body: { note: "已致電確認" }
    });

    await deviceService.reject(6);
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/device/bindings/6/reject", {
      body: { note: "" }
    });

    await deviceService.revoke(7);
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/device/bindings/7/revoke", {
      body: { note: "" }
    });
  });
});

describe("device pages", () => {
  it("真正嘅頁面 metadata 過得到開機驗證", () => {
    // 開機時 validatePages 唔過就係 fatal 畫面。喺呢度跑一次真嘅 pages glob，
    // 等新增一頁而 metadata 寫錯（例如 menu.group 打錯字）會喺測試就紅，
    // 而唔係要等有人開個瀏覽器先發現。
    expect(validatePages(discoverPages())).toEqual([]);
  });

  it("審批頁要求 device.approve，我的設備頁唔使", () => {
    const pages = Object.fromEntries(
      discoverPages().map(({ page }) => [page.name, page])
    );

    expect(pages["device-approvals"].requires).toEqual({
      permissions: ["device.approve"]
    });
    // 呢一頁淨係顯示自己嘅設備，後端亦都只回 claims.sub 自己嗰啲——加一條
    // 權限要求反而會令普通用戶睇唔到自己嘅設備。
    expect(pages["my-devices"].requires).toBeUndefined();
    // 等待審批頁一定要係 public：用戶喺嗰一刻**冇** token。
    expect(pages["device-pending"].public).toBe(true);
  });
});
