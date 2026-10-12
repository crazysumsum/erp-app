import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemLookupService } from "../../modules/item/ItemLookupService.js";
import { SUPPLIER_SKU_RELATIONSHIP_STATUSES, SupplierRelationService } from "../../modules/supplier/SupplierRelationService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_MGMT_POLICY, SUPPLIER_VIEW_POLICY } from "./supplierSchemas.js";

const ID = Object.freeze({ type: "string", pattern: "^[1-9][0-9]{0,18}$" });
const OWNER_PARAMS = Object.freeze({ type: "object", required: ["id"], additionalProperties: false, properties: { id: ID } });
const CHILD_PARAMS = Object.freeze({
  type: "object", required: ["id", "relationId"], additionalProperties: false, properties: { id: ID, relationId: ID }
});
const LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    q: { type: "string", maxLength: 190, default: "" },
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }
  }
});
// 冇價格欄位，additionalProperties: false 會拒絕 price／quote 之類（FR-SKU-006、SKU-007）。
const FIELDS = Object.freeze({
  supplierItemCode: { type: "string", maxLength: 190, default: "" },
  supplierItemName: { type: "string", maxLength: 190, default: "" },
  purchaseSkuUomId: { type: ["integer", "null"], minimum: 1, default: null },
  minimumOrderQty: { type: ["integer", "null"], minimum: 1, maximum: 4_294_967_295, default: null },
  standardLeadTimeDays: { type: ["integer", "null"], minimum: 0, maximum: 3650, default: null },
  relationshipStatus: { type: "string", enum: [...SUPPLIER_SKU_RELATIONSHIP_STATUSES], default: "alternative" }
});
const CREATE_BODY = Object.freeze({
  type: "object", required: ["skuId"], additionalProperties: false,
  properties: { skuId: { type: "integer", minimum: 1 }, ...FIELDS }
});
// 修改要帶齊所有欄位：唔可以有 default，否則 validator 會先填 default，漏帶嘅欄位會被靜靜雞清空（REV-085 M1）。
const NO_DEFAULTS = Object.fromEntries(Object.entries(FIELDS).map(([name, { default: _ignored, ...schema }]) => [name, schema]));
const UPDATE_BODY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["supplierItemCode", "supplierItemName", "purchaseSkuUomId", "minimumOrderQty", "standardLeadTimeDays", "relationshipStatus", "version"],
  properties: { ...NO_DEFAULTS, version: { type: "integer", minimum: 1 } }
});
const nullableInteger = Object.freeze({ type: ["integer", "null"] });
const nullableString = Object.freeze({ type: ["string", "null"] });
const RELATION = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierId", "skuId", "skuCode", "skuName", "skuStatus", "itemStatus", "supplierItemCode", "supplierItemName",
    "purchaseSkuUomId", "minimumOrderQty", "standardLeadTimeDays", "relationshipStatus", "firstSuppliedAt", "lastSuppliedAt", "source",
    "version", "updatedAt"],
  properties: {
    id: { type: "integer" }, supplierId: { type: "integer" }, skuId: { type: "integer" },
    skuCode: nullableString, skuName: nullableString, skuStatus: nullableString, itemStatus: nullableString,
    supplierItemCode: { type: "string" }, supplierItemName: { type: "string" },
    purchaseSkuUomId: nullableInteger, minimumOrderQty: nullableInteger, standardLeadTimeDays: nullableInteger,
    relationshipStatus: { type: "string", enum: [...SUPPLIER_SKU_RELATIONSHIP_STATUSES] },
    firstSuppliedAt: nullableInteger, lastSuppliedAt: nullableInteger, source: { type: "string", enum: ["manual", "purchasing"] },
    version: { type: "integer" }, updatedAt: { type: "integer" }
  }
});
const LIST_RESPONSE = Object.freeze({
  type: "object", required: ["items", "total", "page", "pageSize"], additionalProperties: false,
  properties: { items: { type: "array", items: RELATION }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } }
});

function context(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
    requestId: req.requestId, ip: req.ip || req.socket?.remoteAddress || "", supplierId: Number(req.input.params.id)
  };
}

class SupplierSkuRelationHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    const logger = services.require("logging").logger;
    const time = services.require("time");
    this.relations = new SupplierRelationService({ database, logger, time, items: new ItemLookupService({ database, logger, time }) });
  }
}

export class ListSupplierSkuRelationsHandler extends SupplierSkuRelationHandler {
  static handlerName = "listSupplierSkuRelations";
  static api = {
    method: "GET", path: "/api/v1/suppliers/:id/sku-relations", description: "分頁列出供應商的 SKU 供貨關係；可搜 SKU 或供應商商品代碼。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: OWNER_PARAMS, query: LIST_QUERY, body: EMPTY_SUPPLIER_SCHEMA }, responseSchema: { 200: LIST_RESPONSE }
  };
  async execute(req) { return this.response(await this.relations.list({ ...context(req), ...req.input.query })); }
}

export class CreateSupplierSkuRelationHandler extends SupplierSkuRelationHandler {
  static handlerName = "createSupplierSkuRelation";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:id/sku-relations/create", description: "建立軟性供貨關係；不改變採購資格。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: OWNER_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: CREATE_BODY }, responseSchema: { 201: RELATION }
  };
  async execute(req) { return this.response(await this.relations.create({ ...context(req), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateSupplierSkuRelationHandler extends SupplierSkuRelationHandler {
  static handlerName = "updateSupplierSkuRelation";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:id/sku-relations/:relationId/update", description: "按版本更新採購單位、MOQ、交期或關係狀態。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: UPDATE_BODY }, responseSchema: { 200: RELATION }
  };
  async execute(req) {
    return this.response(await this.relations.update({ ...context(req), relationId: Number(req.input.params.relationId), ...req.input.body }));
  }
}
