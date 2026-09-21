import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierAddressService, SUPPLIER_ADDRESS_PURPOSES } from "../../modules/supplier/SupplierAddressService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_MGMT_POLICY } from "./supplierSchemas.js";

const OWNER_PARAMS = Object.freeze({
  type: "object", required: ["supplierId"], additionalProperties: false,
  properties: { supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});
const CHILD_PARAMS = Object.freeze({
  type: "object", required: ["supplierId", "addressId"], additionalProperties: false,
  properties: {
    supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    addressId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});
const PURPOSE_SCHEMA = Object.freeze({
  type: "object", required: ["purposeCode", "isPrimary"], additionalProperties: false,
  properties: { purposeCode: { type: "string", enum: [...SUPPLIER_ADDRESS_PURPOSES] }, isPrimary: { type: "boolean" } }
});
const ADDRESS_PROPERTIES = Object.freeze({
  label: { type: "string", minLength: 1, maxLength: 100 },
  addressLine1: { type: "string", maxLength: 190, default: "" },
  addressLine2: { type: "string", maxLength: 190, default: "" },
  addressLine3: { type: "string", maxLength: 190, default: "" },
  city: { type: "string", maxLength: 100, default: "" },
  stateRegion: { type: "string", maxLength: 100, default: "" },
  postalCode: { type: "string", maxLength: 100, default: "" },
  countryCode: { type: ["string", "null"], pattern: "^[A-Z]{2}$" },
  phone: { type: "string", maxLength: 50, default: "" },
  notes: { type: "string", maxLength: 500, default: "" },
  purposes: { type: "array", maxItems: SUPPLIER_ADDRESS_PURPOSES.length, items: PURPOSE_SCHEMA }
});
const CREATE_BODY = Object.freeze({
  type: "object", required: ["label", "purposes"], additionalProperties: false, properties: ADDRESS_PROPERTIES
});
const UPDATE_BODY = Object.freeze({
  type: "object", required: ["label", "purposes", "version"], additionalProperties: false,
  properties: { ...ADDRESS_PROPERTIES, version: { type: "integer", minimum: 1 } }
});
const DEACTIVATE_BODY = Object.freeze({
  type: "object", required: ["version"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 } }
});
const ADDRESS_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierId", "label", "addressLine1", "addressLine2", "addressLine3", "city", "stateRegion", "postalCode", "countryCode", "phone", "notes", "status", "purposes", "version", "updatedAt"],
  properties: {
    id: { type: "integer" }, supplierId: { type: "integer" }, label: { type: "string" }, addressLine1: { type: "string" },
    addressLine2: { type: "string" }, addressLine3: { type: "string" }, city: { type: "string" }, stateRegion: { type: "string" },
    postalCode: { type: "string" }, countryCode: { type: ["string", "null"] }, phone: { type: "string" }, notes: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] }, purposes: { type: "array", items: PURPOSE_SCHEMA },
    version: { type: "integer" }, updatedAt: { type: "integer" }
  }
});

function context(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
    requestId: req.requestId, ip: req.ip || req.socket?.remoteAddress || "",
    supplierId: Number(req.input.params.supplierId)
  };
}

class SupplierAddressHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.addresses = new SupplierAddressService({
      database: services.require("mysqldatabase"), logger: services.require("logging").logger, time: services.require("time")
    });
  }
}

export class CreateSupplierAddressHandler extends SupplierAddressHandler {
  static handlerName = "createSupplierAddress";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/addresses/create", description: "新增供應商地址及用途。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: OWNER_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: CREATE_BODY }, responseSchema: { 201: ADDRESS_RESPONSE }
  };
  async execute(req) { return this.response(await this.addresses.create({ ...context(req), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateSupplierAddressHandler extends SupplierAddressHandler {
  static handlerName = "updateSupplierAddress";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/addresses/:addressId/update", description: "按版本更新供應商地址及完整用途集合。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: UPDATE_BODY }, responseSchema: { 200: ADDRESS_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.addresses.update({ ...context(req), addressId: Number(req.input.params.addressId), ...req.input.body }));
  }
}

export class DeactivateSupplierAddressHandler extends SupplierAddressHandler {
  static handlerName = "deactivateSupplierAddress";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/addresses/:addressId/deactivate", description: "停用供應商地址並清除其主要用途標記。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: DEACTIVATE_BODY }, responseSchema: { 200: ADDRESS_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.addresses.deactivate({ ...context(req), addressId: Number(req.input.params.addressId), ...req.input.body }));
  }
}
