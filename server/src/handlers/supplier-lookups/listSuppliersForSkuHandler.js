import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { assertActorFresh } from "../../modules/authorization/directoryLookups.js";
import { SUPPLIER_VIEW_POLICY } from "../suppliers/supplierSchemas.js";

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const PARAMS = Object.freeze({
  type: "object", required: ["skuId"], additionalProperties: false,
  properties: { skuId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});
const QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    // 控制字元喺呢度擋成 400；唔擋嘅話 service 嘅 TypeError 會變 500（REV-087 L-2）。
    q: { type: "string", maxLength: 190, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]*$", default: "" },
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
});
const nullableInteger = Object.freeze({ type: ["integer", "null"] });
const CANDIDATE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["supplierId", "supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId", "status",
    "version", "usable", "reasons", "rankReason", "relation"],
  properties: {
    supplierId: { type: "integer" }, supplierCode: { type: "string" }, supplierName: { type: "string" },
    displayName: { type: "string" }, defaultCurrencyCode: { type: "string" }, defaultPaymentTermId: nullableInteger,
    status: { type: "string" }, version: { type: "integer" }, usable: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } },
    rankReason: { type: ["string", "null"], enum: ["exact_match", "preferred", "recently_supplied", null] },
    relation: {
      type: ["object", "null"], additionalProperties: false,
      required: ["relationId", "relationshipStatus", "supplierItemCode", "lastSuppliedAt"],
      properties: { relationId: { type: "integer" }, relationshipStatus: { type: "string" }, supplierItemCode: { type: "string" },
        lastSuppliedAt: nullableInteger }
    }
  }
});
const RESPONSE = Object.freeze({
  type: "object", required: ["items", "total", "page", "pageSize"], additionalProperties: false,
  properties: { items: { type: "array", items: CANDIDATE }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } }
});

/**
 * 採購揀 Supplier（設計 §6.8、§8.7）。暫時閘喺 `supplier.view`：Purchasing 未有自己嘅權限（HD-094 1A），
 * 呢度只回 Active Supplier 嘅基本資料同排序原因，`supplier.view` 喺列表本身已經睇得到。
 */
export class ListSuppliersForSkuHandler extends BaseRequestHandler {
  static handlerName = "listSuppliersForSku";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/for-sku/:skuId",
    description: "列出可供採購選擇的 Active 供應商；首選或曾供貨只影響排序，不影響可否選擇。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: PARAMS, query: QUERY, body: EMPTY },
    responseSchema: { 200: RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
  }

  async execute(req) {
    const { claims } = req.auth;
    await assertActorFresh(this.database, { actorId: Number(claims.sub), claimedRoles: claims.roles, claimedPermissions: claims.permissions });
    // supplierCoreProvider 係 eager service，handler 建立時未必初始化完，所以喺請求時先攞（同 salesJobs 一樣）。
    return this.response(await this.services.require("supplierCoreProvider").listForSku(Number(req.input.params.skuId), req.input.query));
  }
}
