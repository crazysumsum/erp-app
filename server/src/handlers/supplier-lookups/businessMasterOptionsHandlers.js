import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";

/**
 * Supplier 表單揀幣別同付款條件用嘅選項（DEF-036、HD-126 A）。
 *
 * 點解唔叫 `/api/v1/business-master/currencies`：嗰條要 `business_master.view`，CLERK（supplier.view＋supplier.mgmt）
 * 攞到 403，喺 UI 開唔到 Supplier。設計 §6 要 supplier.view 讀得到；Business Master DES-001 講 consumer 用自己嘅
 * handler 同權限讀，同 HD-022 嘅 readiness lookup 一樣。經共用 provider 讀，所以只有 Active，欄位亦只係 provider 嘅投影。
 *
 * Business Master 未 ready 就 503 BUSINESS_MASTER_NOT_READY，同建立 Supplier 一樣；唔會回一個空清單扮冇選項。
 */

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

const SUPPLIER_VIEW_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.view"]) })
})]);

// ponytail: 只回頭 100 個 Active 值，同原本表單攞嘅一樣；選項多過 100 先要加 q／分頁。
const PAGE = Object.freeze({ page: 1, pageSize: 100 });

const VERSION = { type: "integer", minimum: 1 };
const STATUS = { type: "string", enum: ["ACTIVE"] };

const CURRENCY_OPTIONS = Object.freeze({
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["code", "name", "decimalPlaces", "status", "version"],
    properties: { code: { type: "string", pattern: "^[A-Z]{3}$" }, name: { type: "string" }, decimalPlaces: { type: "integer", minimum: 0, maximum: 4 },
      status: STATUS, version: VERSION }
  } } }
});

const PAYMENT_TERM_OPTIONS = Object.freeze({
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["id", "code", "name", "calculationType", "dueDays", "status", "version"],
    properties: { id: { type: "integer", minimum: 1 }, code: { type: "string" }, name: { type: "string" },
      calculationType: { type: "string", enum: ["IMMEDIATE", "NET_DAYS", "END_OF_MONTH", "MANUAL"] }, dueDays: { type: ["integer", "null"] },
      status: STATUS, version: VERSION }
  } } }
});

class BusinessMasterOptionsHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    this.businessMaster = new BusinessMasterLookupProvider({
      provider: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }),
      readiness: new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })
    });
  }
}

export class ListSupplierCurrencyOptionsHandler extends BusinessMasterOptionsHandler {
  static handlerName = "listSupplierCurrencyOptions";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/currencies",
    description: "列出供應商表單可選的 Active 貨幣。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: EMPTY, query: EMPTY, body: EMPTY },
    responseSchema: { 200: CURRENCY_OPTIONS }
  };

  async execute() {
    await this.businessMaster.assertReady();
    return this.response({ items: await this.businessMaster.listCurrencies(PAGE) });
  }
}

export class ListSupplierPaymentTermOptionsHandler extends BusinessMasterOptionsHandler {
  static handlerName = "listSupplierPaymentTermOptions";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/payment-terms",
    description: "列出供應商表單可選的 Active 付款條件。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: EMPTY, query: EMPTY, body: EMPTY },
    responseSchema: { 200: PAYMENT_TERM_OPTIONS }
  };

  async execute() {
    await this.businessMaster.assertReady();
    return this.response({ items: await this.businessMaster.listPaymentTerms(PAGE) });
  }
}
