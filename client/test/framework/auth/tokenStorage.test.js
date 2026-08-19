import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearToken, getToken, setToken } from "@/framework/auth/tokenStorage.js";
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
});
