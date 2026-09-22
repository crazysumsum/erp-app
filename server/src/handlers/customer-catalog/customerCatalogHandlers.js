import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerCatalogService } from "../../modules/customer/CustomerCatalogService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CATALOG_CREATE, CATALOG_DEACTIVATE, CATALOG_ID_PARAMS, CATALOG_ITEM, CATALOG_LIST,
  CATALOG_PARAMS, CATALOG_UPDATE, EMPTY_OBJECT_SCHEMA
} from "./customerCatalogSchemas.js";

function actorContext(req) {
  return { actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions };
}

class CustomerCatalogHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.catalogs = new CustomerCatalogService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }
}

export class ListCustomerCatalogHandler extends CustomerCatalogHandler {
  static handlerName = "listCustomerCatalog";
  static api = { method: "GET", path: "/api/v1/customer-catalog/:catalog", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CATALOG_PARAMS, query: Object.freeze({ type: "object", additionalProperties: false, properties: { includeInactive: { type: "boolean", default: false } } }), body: EMPTY_OBJECT_SCHEMA }, responseSchema: { 200: CATALOG_LIST } };
  async execute(req) { return this.response(await this.catalogs.list(req.input.params.catalog, { ...actorContext(req), includeInactive: req.input.query.includeInactive })); }
}

export class CreateCustomerCatalogHandler extends CustomerCatalogHandler {
  static handlerName = "createCustomerCatalog";
  static api = { method: "POST", path: "/api/v1/customer-catalog/:catalog/create", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.settings], requestSchema: { params: CATALOG_PARAMS, query: EMPTY_OBJECT_SCHEMA, body: CATALOG_CREATE }, responseSchema: { 201: CATALOG_ITEM } };
  async execute(req) { return this.response(await this.catalogs.create(req.input.params.catalog, { ...actorContext(req), ...req.input.body, requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || "" }), { statusCode: 201 }); }
}

export class UpdateCustomerCatalogHandler extends CustomerCatalogHandler {
  static handlerName = "updateCustomerCatalog";
  static api = { method: "POST", path: "/api/v1/customer-catalog/:catalog/:id/update", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.settings], requestSchema: { params: CATALOG_ID_PARAMS, query: EMPTY_OBJECT_SCHEMA, body: CATALOG_UPDATE }, responseSchema: { 200: CATALOG_ITEM } };
  async execute(req) { return this.response(await this.catalogs.update(req.input.params.catalog, { ...actorContext(req), ...req.input.body, id: Number(req.input.params.id), requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || "" })); }
}

export class DeactivateCustomerCatalogHandler extends CustomerCatalogHandler {
  static handlerName = "deactivateCustomerCatalog";
  static api = { method: "POST", path: "/api/v1/customer-catalog/:catalog/:id/deactivate", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.settings], requestSchema: { params: CATALOG_ID_PARAMS, query: EMPTY_OBJECT_SCHEMA, body: CATALOG_DEACTIVATE }, responseSchema: { 200: CATALOG_ITEM } };
  async execute(req) { return this.response(await this.catalogs.deactivate(req.input.params.catalog, { ...actorContext(req), ...req.input.body, id: Number(req.input.params.id), requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || "" })); }
}

for (const Handler of [ListCustomerCatalogHandler, CreateCustomerCatalogHandler, UpdateCustomerCatalogHandler, DeactivateCustomerCatalogHandler]) {
  Handler.api.description = `${Handler.handlerName} endpoint.`;
}
