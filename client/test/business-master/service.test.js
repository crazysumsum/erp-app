import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/http/HttpClient.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }
}));

import { httpClient } from "@/framework/http/HttpClient.js";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";
import businessMasterService, { service } from "@/services/businessMaster.js";

describe("TC-016 Business Master frontend service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("宣告 registry name，並把 Currency 清單映射為 DataTable 形狀", async () => {
    httpClient.get.mockResolvedValue({ items: [{ code: "HKD" }], total: 1 });

    const result = await businessMasterService.currencyList({
      page: 2,
      rowsPerPage: 10,
      sortBy: "name",
      descending: true,
      filter: "港",
      status: "ACTIVE"
    });

    expect(service.name).toBe("businessMaster");
    expect(result).toEqual({ rows: [{ code: "HKD" }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/business-master/currencies", {
      params: { page: 2, pageSize: 10, sort: "name", descending: true, q: "港", status: "ACTIVE" }
    });
  });

  it("Currency create/update 只傳契約允許欄位，寫入一律啟用 idempotency", async () => {
    await businessMasterService.createCurrency({ code: "HKD", name: "港幣", decimalPlaces: 2 });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/currencies", {
      body: { code: "HKD", name: "港幣", decimalPlaces: 2 },
      idempotent: true
    });

    await businessMasterService.updateCurrency("HKD", { name: "香港元", version: 3, decimalPlaces: 4 });
    expect(httpClient.patch).toHaveBeenCalledWith("/api/v1/business-master/currencies/HKD", {
      body: { name: "香港元", version: 3 },
      idempotent: true
    });
  });

  it("Currency 高影響操作先 preview，再以 token、reason、version 執行", async () => {
    await businessMasterService.previewCurrencyImpact("HKD", {
      operation: "CHANGE_PRECISION", version: 2, proposedChange: { decimalPlaces: 0 }
    });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/currencies/HKD/impact-preview", {
      body: { operation: "CHANGE_PRECISION", version: 2, proposedChange: { decimalPlaces: 0 } },
      idempotent: true
    });

    await businessMasterService.changeCurrencyPrecision("HKD", {
      decimalPlaces: 0, version: 2, reason: "法定精度更新", impactToken: "impact-token"
    });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/business-master/currencies/HKD/change-precision", {
      body: { decimalPlaces: 0, version: 2, reason: "法定精度更新", impactToken: "impact-token" },
      idempotent: true
    });
  });

  it("高影響命令可沿用 caller-supplied idempotency key 查回未知結果", async () => {
    await businessMasterService.deactivateCurrency("HKD", {
      version: 2,
      reason: "停止新交易使用",
      impactToken: "impact-token",
      idempotencyKey: "currency-deactivate-intent"
    });

    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/currencies/HKD/deactivate", {
      body: { version: 2, reason: "停止新交易使用", impactToken: "impact-token" },
      idempotent: true,
      idempotencyKey: "currency-deactivate-intent"
    });
  });

  it("Payment Term 清單映射為 DataTable 形狀", async () => {
    httpClient.get.mockResolvedValue({ items: [{ id: 1, code: "NET30" }], total: 1 });

    const result = await businessMasterService.paymentTermList({
      page: 1, rowsPerPage: 20, sortBy: "code", descending: false, filter: "NET", status: null
    });

    expect(result).toEqual({ rows: [{ id: 1, code: "NET30" }], rowsNumber: 1 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/business-master/payment-terms", {
      params: { page: 1, pageSize: 20, sort: "code", descending: false, q: "NET", status: undefined }
    });
  });

  it("Payment Term create/update 與規則變更符合契約", async () => {
    const fields = {
      code: "NET30", name: "30 日", description: "發票後 30 日", calculationType: "NET_DAYS", dueDays: 30
    };
    await businessMasterService.createPaymentTerm(fields);
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/payment-terms", {
      body: fields,
      idempotent: true
    });

    await businessMasterService.updatePaymentTerm(7, { ...fields, name: "月結 30 日", version: 4 });
    expect(httpClient.patch).toHaveBeenCalledWith("/api/v1/business-master/payment-terms/7", {
      body: { name: "月結 30 日", description: "發票後 30 日", version: 4 },
      idempotent: true
    });

    await businessMasterService.changePaymentTermRule(7, {
      calculationType: "END_OF_MONTH", dueDays: 0, version: 4,
      reason: "統一月結規則", impactToken: "impact-token"
    });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/business-master/payment-terms/7/change-rule", {
      body: {
        calculationType: "END_OF_MONTH", dueDays: 0, version: 4,
        reason: "統一月結規則", impactToken: "impact-token"
      },
      idempotent: true
    });
  });

  it("Payment Term due date preview 傳 baseDate 與 expectedVersion", async () => {
    await businessMasterService.calculatePaymentTerm(7, { baseDate: "2026-09-14", expectedVersion: 4 });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/payment-terms/7/calculate", {
      body: { baseDate: "2026-09-14", expectedVersion: 4 },
      idempotent: true
    });
  });

  it("activate/deactivate 與 audit filter 使用明確端點", async () => {
    await businessMasterService.activateCurrency("HKD", { version: 2, reason: "重新使用" });
    expect(httpClient.post).toHaveBeenCalledWith("/api/v1/business-master/currencies/HKD/activate", {
      body: { version: 2, reason: "重新使用" }, idempotent: true
    });

    await businessMasterService.deactivatePaymentTerm(7, {
      version: 4, reason: "不再提供此條款", impactToken: "impact-token"
    });
    expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/business-master/payment-terms/7/deactivate", {
      body: { version: 4, reason: "不再提供此條款", impactToken: "impact-token" }, idempotent: true
    });

    await businessMasterService.auditList({ entityType: "PAYMENT_TERM", entityKey: "7", page: 1, rowsPerPage: 10 });
    expect(httpClient.get).toHaveBeenCalledWith("/api/v1/business-master/audit", {
      params: { entityType: "PAYMENT_TERM", entityKey: "7", page: 1, pageSize: 10 }
    });
  });

  it("Business Master 的穩定錯誤碼都有中文訊息", () => {
    for (const code of [
      "CURRENCY_CODE_TAKEN",
      "PAYMENT_TERM_CODE_TAKEN",
      "VERSION_CONFLICT",
      "IMPACT_CHECK_UNAVAILABLE",
      "IMPACT_TOKEN_EXPIRED",
      "IMPACT_CHANGED"
    ]) {
      expect(ERROR_CODE_MESSAGES[code], code).toMatch(/[\u3400-\u9fff]/u);
    }
  });
});
