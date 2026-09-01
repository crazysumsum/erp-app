import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import roleService, { service } from "@/services/role.js";

describe("role service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
    httpClient.post.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("role");
  });

  it("list() 淨係攞信封入面嘅 items，唔分頁", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, name: "system-admin" }] });

    expect(await roleService.list()).toEqual([{ id: 1, name: "system-admin" }]);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/roles");
  });

  it("create() 打新增角色嘅路徑，唔簽章", async () => {
    httpClient.post.mockResolvedValue({ id: 2, name: "staff" });

    await roleService.create({ name: "staff", description: "一般同事" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/roles/create", {
      body: { name: "staff", description: "一般同事" }
    });
  });

  it("update() 改名稱／描述", async () => {
    httpClient.post.mockResolvedValue({ id: 2, name: "staff2" });

    await roleService.update(2, { name: "staff2", description: "改咗" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/roles/2/update", {
      body: { name: "staff2", description: "改咗" }
    });
  });

  it("delete() 帶 reason 同 password", async () => {
    httpClient.post.mockResolvedValue({ id: 2 });

    await roleService.delete(2, { reason: "唔再用", password: "hunter2" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/roles/2/delete", {
      body: { reason: "唔再用", password: "hunter2" }
    });
  });

  it("assignPermissions() 帶 expectedPermissionIds 做 compare-and-set，簽章", async () => {
    httpClient.post.mockResolvedValue({ id: 2, permissions: ["device.mgmt"] });

    await roleService.assignPermissions(2, {
      permissionIds: [3],
      expectedPermissionIds: [1, 3],
      reason: "前線自助",
      password: "hunter2"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/roles/2/permissions/assign", {
      body: { permissionIds: [3], expectedPermissionIds: [1, 3], reason: "前線自助", password: "hunter2" },
      signed: true
    });
  });

  it("listPermissions() 淨係攞信封入面嘅 items", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, name: "user.mgmt", description: "..." }] });

    expect(await roleService.listPermissions()).toEqual([
      { id: 1, name: "user.mgmt", description: "..." }
    ]);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/permissions");
  });
});
