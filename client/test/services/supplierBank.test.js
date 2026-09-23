import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import supplierBankService from "@/services/supplierBank.js";

describe("supplierBank service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the masked list without asking for plaintext", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, maskedAccountNumber: "****1234" }] });
    const items = await supplierBankService.list(7);
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/suppliers/7/bank-accounts");
    expect(items).toEqual([{ id: 1, maskedAccountNumber: "****1234" }]);
  });

  /**
   * 設計 §6.6：四條寫入 route 係 `jwt-device-password`，reveal 係 `jwt-password`。
   * 客戶端要對得上 —— `signed: true` 就係裝置簽章。少咗佢，寫入會喺伺服器度
   * 400 DEVICE_SIGNATURE_REQUIRED；多咗佢喺 reveal 度就係要求一個唔需要嘅條件，
   * 會令一個只得 bank.view、台機未綁定嘅稽核人員睇唔到嘢。
   */
  it("signs the four writes with the device and does not sign reveal", async () => {
    httpClient.post.mockResolvedValue({});
    await supplierBankService.create(7, { accountNumber: "123", password: "p", reason: "r" });
    await supplierBankService.update(7, 41, { version: 1, password: "p", reason: "r" });
    await supplierBankService.setDefault(7, 41, { version: 1, password: "p", reason: "r" });
    await supplierBankService.deactivate(7, 41, { version: 1, password: "p", reason: "r" });
    for (const call of httpClient.post.mock.calls) {
      expect(call[1].signed, `${call[0]} must carry a device signature`).toBe(true);
    }

    httpClient.post.mockClear();
    await supplierBankService.reveal(7, 41, { password: "p", reason: "r" });
    expect(httpClient.post).toHaveBeenCalledWith(
      "/api/v1/suppliers/7/bank-accounts/41/reveal",
      { body: { password: "p", reason: "r" } }
    );
    expect(httpClient.post.mock.calls[0][1].signed).toBeUndefined();
  });

  it("puts the account number in the body, never in the path or a query string", async () => {
    httpClient.post.mockResolvedValue({});
    await supplierBankService.create(7, { accountNumber: "12345678", password: "p", reason: "r" });
    const [path, options] = httpClient.post.mock.calls[0];
    expect(path).toBe("/api/v1/suppliers/7/bank-accounts/create");
    expect(path).not.toContain("12345678");
    expect(options.params).toBeUndefined();
    expect(options.body.accountNumber).toBe("12345678");
  });
});
