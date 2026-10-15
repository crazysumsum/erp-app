import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierAdminService } from "../../modules/supplier/SupplierAdminService.js";
import {
  EMPTY_SUPPLIER_SCHEMA,
  SUPPLIER_COMPLETENESS_SCHEMA,
  SUPPLIER_DETAIL_SCHEMA,
  SUPPLIER_DUPLICATE_CHECK_SCHEMA,
  SUPPLIER_DUPLICATE_RESPONSE_SCHEMA,
  SUPPLIER_ID_PARAMS_SCHEMA,
  SUPPLIER_LIST_QUERY_SCHEMA,
  SUPPLIER_LIST_RESPONSE_SCHEMA,
  SUPPLIER_MGMT_POLICY,
  SUPPLIER_VIEW_POLICY
} from "./supplierSchemas.js";
import { ADDRESS_RESPONSE } from "./supplierAddressHandlers.js";
import { CONTACT_RESPONSE } from "./supplierContactHandlers.js";

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

class SupplierQueryHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.suppliers = new SupplierAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      // These read paths do not assign Business Master values.
      businessMaster: {}
    });
  }
}

export class ListSuppliersHandler extends SupplierQueryHandler {
  static handlerName = "listSuppliers";
  static api = {
    method: "GET", path: "/api/v1/suppliers", description: "分頁搜尋供應商主資料。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: EMPTY_SUPPLIER_SCHEMA, query: SUPPLIER_LIST_QUERY_SCHEMA },
    responseSchema: { 200: SUPPLIER_LIST_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.suppliers.listSuppliers({ ...actor(req), ...req.input.query }));
  }
}

export class GetSupplierHandler extends SupplierQueryHandler {
  static handlerName = "getSupplier";
  static api = {
    method: "GET", path: "/api/v1/suppliers/:id", description: "取得供應商詳情與已遮罩的子資料摘要。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA },
    responseSchema: { 200: SUPPLIER_DETAIL_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.suppliers.getSupplier({ ...actor(req), id: Number(req.input.params.id) }));
  }
}

export class CheckSupplierDuplicatesHandler extends SupplierQueryHandler {
  static handlerName = "checkSupplierDuplicates";
  static api = {
    method: "POST", path: "/api/v1/suppliers/duplicates/check", description: "檢查 Supplier Code 衝突及名稱近似提示。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: EMPTY_SUPPLIER_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_DUPLICATE_CHECK_SCHEMA },
    responseSchema: { 200: SUPPLIER_DUPLICATE_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.suppliers.findSupplierDuplicateCandidates({ ...actor(req), ...req.input.body }));
  }
}

export class GetSupplierCompletenessHandler extends SupplierQueryHandler {
  static handlerName = "getSupplierCompleteness";
  static api = {
    method: "GET", path: "/api/v1/suppliers/:id/completeness", description: "取得供應商啟用問題及非阻擋完整度提示。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA },
    responseSchema: { 200: SUPPLIER_COMPLETENESS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.suppliers.getSupplierCompleteness({ ...actor(req), id: Number(req.input.params.id) }));
  }
}

const CHILD_PAGE_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: { page: { type: "integer", minimum: 1, maximum: 1_000_000, default: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
});
const childPageResponse = (item) => Object.freeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: {
    items: { type: "array", items: item }, total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }
  }
});

export class ListSupplierAddressesHandler extends SupplierQueryHandler {
  static handlerName = "listSupplierAddresses";
  static api = {
    method: "GET", path: "/api/v1/suppliers/:id/addresses", description: "分頁列出供應商地址（超過詳情上限時用）。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: CHILD_PAGE_QUERY },
    responseSchema: { 200: childPageResponse(ADDRESS_RESPONSE) }
  };

  async execute(req) {
    return this.response(await this.suppliers.listSupplierAddresses({ ...actor(req), id: Number(req.input.params.id), ...req.input.query }));
  }
}

export class ListSupplierContactsHandler extends SupplierQueryHandler {
  static handlerName = "listSupplierContacts";
  static api = {
    method: "GET", path: "/api/v1/suppliers/:id/contacts", description: "分頁列出供應商聯絡人（超過詳情上限時用）。",
    authorizationPolicies: SUPPLIER_VIEW_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: CHILD_PAGE_QUERY },
    responseSchema: { 200: childPageResponse(CONTACT_RESPONSE) }
  };

  async execute(req) {
    return this.response(await this.suppliers.listSupplierContacts({ ...actor(req), id: Number(req.input.params.id), ...req.input.query }));
  }
}
