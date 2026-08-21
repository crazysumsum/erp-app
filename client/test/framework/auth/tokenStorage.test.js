import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearToken,
  getSessionDeadline,
  getToken,
  getTokenDeadline,
  setToken
} from "@/framework/auth/tokenStorage.js";
import { installFakeLocalStorage } from "../../support/fakeLocalStorage.js";

describe("tokenStorage", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("set/get/clear 都用 config 指定嘅 key", () => {
    expect(getToken()).toBeNull();

    setToken("abc123");
    expect(getToken()).toBe("abc123");
    expect(localStorage.getItem("erp.token")).toBe("abc123");

    clearToken();
    expect(getToken()).toBeNull();
  });

  it("token 同 session 兩個到期時刻分開記，唔會互相蓋", () => {
    const before = Date.now();

    // 典型嘅續期回應：token 剩 15 分鐘，但成條 session 只剩 20 分鐘。
    setToken("abc123", 15 * 60, 20 * 60);

    const tokenDeadline = getTokenDeadline();
    const sessionDeadline = getSessionDeadline();

    expect(tokenDeadline).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(sessionDeadline).toBeGreaterThanOrEqual(before + 20 * 60_000);
    // 合成一個嘅話，續期就會把絕對上限一齊推掉——而嗰樣正正係後端花力氣
    // 防住嘅嘢。
    expect(sessionDeadline).toBeGreaterThan(tokenDeadline);
  });

  it("clear 連 session 到期時刻一齊清", () => {
    setToken("abc123", 900, 1200);
    expect(getSessionDeadline()).toBeGreaterThan(0);

    clearToken();

    // 冇記錄當作 0（已經過期）：留低一個舊嘅 session deadline，下一個人登入
    // 之前 watchdog 會攞住佢去比，然後即刻登出。
    expect(getSessionDeadline()).toBe(0);
    expect(getTokenDeadline()).toBe(0);
  });
});
