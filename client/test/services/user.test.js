import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import userService, { service } from "@/services/user.js";

describe("user service", () => {
  beforeEach(() => {
    httpClient.get.mockReset();
    httpClient.post.mockReset();
  });

  it("宣告咗 service registry 需要嘅 name", () => {
    expect(service.name).toBe("user");
  });

  it("list() 將 DataTable 嘅參數形狀翻做後端 query，回應翻做 { rows, rowsNumber }", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1 }], total: 42, page: 2, pageSize: 20 });

    const result = await userService.list({
      page: 2,
      rowsPerPage: 20,
      sortBy: "createdAt",
      descending: true,
      filter: "sam",
      status: "active"
    });

    expect(result).toEqual({ rows: [{ id: 1 }], rowsNumber: 42 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/users", {
      params: { page: 2, pageSize: 20, q: "sam", status: "active", sortBy: "createdAt", descending: true }
    });
  });

  it("list() 冇 filter／status／sortBy 就唔帶呢幾個 query key（等後端用返自己嘅預設值）", async () => {
    httpClient.get.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await userService.list({ page: 1, rowsPerPage: 20, sortBy: null, descending: false, filter: "", status: undefined });

    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/users", {
      params: { page: 1, pageSize: 20, q: undefined, status: undefined, sortBy: undefined, descending: false }
    });
  });

  it("get() 打單一用戶嘅路徑", async () => {
    httpClient.get.mockResolvedValue({ id: 5, username: "amy" });

    expect(await userService.get(5)).toEqual({ id: 5, username: "amy" });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/users/5");
  });

  it("create() 帶埋 signed: true，body 含新用戶密碼同操作者自己嘅密碼", async () => {
    httpClient.post.mockResolvedValue({ id: 9 });

    await userService.create({
      username: "amy",
      displayName: "Amy Chan",
      newUserPassword: "Passw0rdPassw0rd",
      roleIds: [1, 2],
      password: "hunter2"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/users/create", {
      body: {
        username: "amy",
        displayName: "Amy Chan",
        newUserPassword: "Passw0rdPassw0rd",
        roleIds: [1, 2],
        password: "hunter2"
      },
      signed: true
    });
  });

  it("update() 淨係帶 displayName，username 唔可以喺呢度改", async () => {
    httpClient.post.mockResolvedValue({ id: 9, displayName: "Amy C" });

    await userService.update(9, { displayName: "Amy C" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/users/9/update", {
      body: { displayName: "Amy C" }
    });
  });

  it("disable()／enable() 帶 reason 同 password，唔簽章", async () => {
    httpClient.post.mockResolvedValue({ id: 9, status: "disabled" });
    await userService.disable(9, { reason: "離職", password: "hunter2" });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/users/9/disable", {
      body: { reason: "離職", password: "hunter2" }
    });

    httpClient.post.mockResolvedValue({ id: 9, status: "active" });
    await userService.enable(9, { reason: "復職", password: "hunter2" });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/users/9/enable", {
      body: { reason: "復職", password: "hunter2" }
    });
  });

  it("assignRoles() 帶 expectedRoleIds 做 compare-and-set，簽章", async () => {
    httpClient.post.mockResolvedValue({ id: 9, roles: ["staff"] });

    await userService.assignRoles(9, {
      roleIds: [1],
      expectedRoleIds: [2],
      reason: "轉組",
      password: "hunter2"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/users/9/roles/assign", {
      body: { roleIds: [1], expectedRoleIds: [2], reason: "轉組", password: "hunter2" },
      signed: true
    });
  });

  it("resetPassword() 簽章，body 帶新密碼、原因、操作者密碼", async () => {
    httpClient.post.mockResolvedValue({ id: 9 });

    await userService.resetPassword(9, {
      newUserPassword: "Passw0rdPassw0rd",
      reason: "忘記密碼",
      password: "hunter2"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/users/9/password/reset", {
      body: { newUserPassword: "Passw0rdPassw0rd", reason: "忘記密碼", password: "hunter2" },
      signed: true
    });
  });

  it("changeOwnPassword() 唔簽章，body 係 { password, newPassword }", async () => {
    httpClient.post.mockResolvedValue({ changed: true });

    await userService.changeOwnPassword({ password: "old", newPassword: "NewPassw0rd" });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/user/password/change", {
      body: { password: "old", newPassword: "NewPassw0rd" }
    });
  });
});
