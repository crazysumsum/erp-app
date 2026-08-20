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
    httpClient.post.mockResolvedValue({
      token: "tok-1",
      tokenType: "Bearer",
      expiresIn: "15m",
      expiresInSeconds: 900,
      user
    });
    const session = useSessionStore();

    const returnedUser = await session.login("sam", "secret", "Chrome on Mac");

    expect(returnedUser).toEqual(user);
    expect(session.isAuthenticated).toBe(true);
    expect(session.roles).toEqual(["admin"]);
    expect(session.permissions).toEqual(["order.read"]);
    expect(localStorage.getItem("erp.token")).toBe("tok-1");
    // deadline 一定要同 token 一齊寫低：得 token 冇 deadline 嘅話，watchdog 會
    // 當成已經過期而即刻登出。
    expect(Number(localStorage.getItem("erp.token.deadline"))).toBeGreaterThan(Date.now());
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/user/login", {
      body: { username: "sam", password: "secret", deviceLabel: "Chrome on Mac" },
      // 冇簽章嘅登入請求會直接被後端拒絕。
      signed: true,
      includePublicKey: true
    });
  });

  it("設備被擋唔算登入失敗，會記低係邊一種", async () => {
    for (const code of ["DEVICE_PENDING_APPROVAL", "DEVICE_REJECTED", "DEVICE_REVOKED"]) {
      setActivePinia(createPinia());
      installFakeLocalStorage();
      httpClient.post.mockRejectedValue(Object.assign(new Error("blocked"), { code }));
      const session = useSessionStore();

      await expect(session.login("sam", "secret")).rejects.toThrow("blocked");

      // 密碼係啱嘅，擋住佢嘅係設備。等待審批頁靠呢個值決定顯示乜——冇咗佢
      // 就只可以一律顯示「待審批」，連「已被拒絕」都講唔出。
      expect(session.deviceStatus).toBe(code);
      expect(session.isAuthenticated).toBe(false);
      expect(localStorage.getItem("erp.token")).toBeNull();
    }
  });

  it("refresh 會換新 token、順手更新 user，而且唔帶公鑰", async () => {
    httpClient.post.mockResolvedValue({
      token: "tok-2",
      tokenType: "Bearer",
      expiresIn: "15m",
      expiresInSeconds: 900,
      user: { ...user, permissions: ["order.read", "order.write"] }
    });
    const session = useSessionStore();

    await session.refresh();

    expect(localStorage.getItem("erp.token")).toBe("tok-2");
    expect(Number(localStorage.getItem("erp.token.deadline"))).toBeGreaterThan(Date.now());
    // 後端每次續期都會重讀 roles/permissions，所以權限變更會喺一次續期之內
    // 反映到畫面上，唔使等重新登入。
    expect(session.permissions).toEqual(["order.read", "order.write"]);
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/user/token/refresh", {
      // 續期嘅前提就係呢台設備已經綁定過，所以後端一律用資料庫嗰把公鑰；
      // 帶 includePublicKey 上去毫無意義。
      signed: true
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

  it("restore：/me 確認 401（token 本身無效）先至清返 storage 當未登入", async () => {
    localStorage.setItem("erp.token", "expired");
    const error = new Error("Unauthorized");
    error.status = 401;
    httpClient.get.mockRejectedValue(error);
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBeNull();
  });

  it("restore：網路錯誤（冇 status）當呢次未登入，但唔清 token——留返下次重試", async () => {
    localStorage.setItem("erp.token", "tok-1");
    httpClient.get.mockRejectedValue(new Error("網路錯誤"));
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBe("tok-1");
  });

  it("restore：503（例如撤銷快照未 ready）當呢次未登入，但唔清 token——留返下次重試", async () => {
    localStorage.setItem("erp.token", "tok-1");
    const error = new Error("Service unavailable");
    error.status = 503;
    httpClient.get.mockRejectedValue(error);
    const session = useSessionStore();

    await session.restore();

    expect(session.isAuthenticated).toBe(false);
    expect(localStorage.getItem("erp.token")).toBe("tok-1");
  });
});
