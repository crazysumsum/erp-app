import { describe, expect, it } from "vitest";
import { buildSigningInput, deviceIdFor } from "@/framework/auth/deviceKey.js";

// 前端簽嘅字串同後端重組嘅字串必須逐字元一樣。兩邊漂移嘅症狀係「每一次登入
// 都話簽章無效」，而錯誤訊息唔會提到格式——所以兩邊各釘住同一個 golden 值。
//
// 對應嘅後端測試：server/test/deviceBinding.test.js 入面同名嘅 golden。
// 改呢個字串嘅時候，兩條測試一定要一齊改，否則就係一次會令全部人登入唔到嘅
// 部署。
const GOLDEN_INPUT =
  '{"accessTokenHash":"","bodyHash":"Xr4t8g","deviceId":"aaaa","method":"POST","nonce":"n-1","path":"/api/v1/user/login","timestamp":1755600000000}';

describe("deviceKey", () => {
  it("待簽字串嘅格式同鍵順序係固定嘅", () => {
    expect(
      buildSigningInput({
        bodyHash: "Xr4t8g",
        deviceId: "aaaa",
        method: "POST",
        nonce: "n-1",
        path: "/api/v1/user/login",
        timestamp: 1755600000000
      })
    ).toBe(GOLDEN_INPUT);
  });

  it("鍵順序唔會跟住傳入嘅次序走", () => {
    // 物件實字嘅鍵順序係插入順序，所以呢度特登用一個亂序嘅物件——如果實作
    // 改成 JSON.stringify(input) 直接吐出去，呢條就會紅。
    expect(
      buildSigningInput({
        timestamp: 1755600000000,
        path: "/api/v1/user/login",
        nonce: "n-1",
        method: "POST",
        deviceId: "aaaa",
        bodyHash: "Xr4t8g"
      })
    ).toBe(GOLDEN_INPUT);
  });

  it("method 一律轉大寫，同後端一致", () => {
    expect(buildSigningInput({ method: "post" })).toContain('"method":"POST"');
  });

  it("device id 係公鑰 SPKI 嘅 SHA-256 hex", async () => {
    const id = await deviceIdFor(new Uint8Array([1, 2, 3]));

    expect(id).toMatch(/^[0-9a-f]{64}$/);
    // 同一份輸入一定得出同一個 id，否則每次開機都會變成一台新設備。
    expect(await deviceIdFor(new Uint8Array([1, 2, 3]))).toBe(id);
    expect(await deviceIdFor(new Uint8Array([1, 2, 4]))).not.toBe(id);
  });
});
