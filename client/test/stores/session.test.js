import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { post: vi.fn(), get: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import { useSessionStore } from "@/stores/session.js";
import { installFakeLocalStorage } from "../support/fakeLocalStorage.js";

const user = { id: 1, username: "sam", displayName: "Sam", roles: ["admin"], permissions: ["order.read"] };

describe("session store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installFakeLocalStorage();
    httpClient.post.mockReset();
    httpClient.get.mockReset();
  });

  it("login 成功會存 token、記低 user，仲會回傳 user", async () => {
    httpClient.post.mockResolvedValue({ token: "tok-1", tokenType: "Bearer", expiresIn: "2h", user });
    const session = useSessionStore();

    const returnedUser = await session.login("sam", "secret");

    expect(returnedUser).toEqual(user);
    expect(session.isAuthenticated).toBe(true);
    expect(session.roles).toEqual(["admin"]);
    expect(session.permissions).toEqual(["order.read"]);
    expect(localStorage.getItem("erp.token")).toBe("tok-1");
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/user/login", {
      body: { username: "sam", password: "secret" }
    });
  });

  it("login 失敗會拋出，唔會存到 token 或改到 user", async () => {
    httpClient.post.mockRejectedValue(new Error("Invalid username or password"));
    const session = useSessionStore();

    await expect(session.login("sam", "wrong")).rejects.toThrow("Invalid username or password");
    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  it("logout 會叫後端撤銷，然後清 user 同 token", async () => {
    localStorage.setItem("erp.token", "tok-1");
    httpClient.post.mockResolvedValue({ revoked: true });
    const session = useSessionStore();
    session.user = user;

    await session.logout();

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/user/logout");
    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  it("logout 就算後端請求失敗，都要清返本地 session（用戶已經主動要求登出）", async () => {
    localStorage.setItem("erp.token", "tok-1");
    httpClient.post.mockRejectedValue(new Error("network error"));
    const session = useSessionStore();
    session.user = user;

    await expect(session.logout()).rejects.toThrow("network error");
    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  it("restore：冇 token 就直接當未登入，唔會叫 /me", async () => {
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(false);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it("restore：有 token 就叫 /me 攞返 user", async () => {
    localStorage.setItem("erp.token", "tok-1");
    httpClient.get.mockResolvedValue(user);
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(true);
    expect(session.roles).toEqual(["admin"]);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/user/me");
  });

  it("restore：token 已失效（/me 拋錯）就清返 storage 當未登入", async () => {
    localStorage.setItem("erp.token", "expired");
    httpClient.get.mockRejectedValue(new Error("Unauthorized"));
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });
});
