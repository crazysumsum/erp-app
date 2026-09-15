import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SUPPLIER_IDENTIFIER_TYPES } from "../../modules/supplier/supplierConstants.js";
import { SupplierIdentifierService } from "../../modules/supplier/SupplierIdentifierService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_MGMT_POLICY } from "./supplierSchemas.js";

const OWNER_PARAMS = Object.freeze({
  type: "object", required: ["supplierId"], additionalProperties: false,
  properties: { supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});
const CHILD_PARAMS = Object.freeze({
  type: "object", required: ["supplierId", "identifierId"], additionalProperties: false,
  properties: {
    supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    identifierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});
const IDENTIFIER_PROPERTIES = Object.freeze({
  identifierType: { type: "string", enum: [...SUPPLIER_IDENTIFIER_TYPES] },
  issuerCountryCode: { type: "string", pattern: "^[A-Z]{2}$" },
  identifierValue: { type: "string", minLength: 1, maxLength: 190 },
  notes: { type: "string", maxLength: 500, default: "" }
});
const CREATE_BODY = Object.freeze({
  type: "object", required: ["identifierType", "issuerCountryCode", "identifierValue"],
  additionalProperties: false, properties: IDENTIFIER_PROPERTIES
});
const UPDATE_BODY = Object.freeze({
  type: "object", required: ["identifierType", "issuerCountryCode", "identifierValue", "version", "reason"],
  additionalProperties: false,
  properties: { ...IDENTIFIER_PROPERTIES, version: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 1, maxLength: 500 } }
});
const DELETE_BODY = Object.freeze({
  type: "object", required: ["version", "reason"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 }, reason: { type: "string", minLength: 1, maxLength: 500 } }
});
const IDENTIFIER_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierId", "identifierType", "issuerCountryCode", "identifierValue", "notes", "version", "updatedAt"],
  properties: {
    id: { type: "integer" }, supplierId: { type: "integer" }, identifierType: { type: "string", enum: [...SUPPLIER_IDENTIFIER_TYPES] },
    issuerCountryCode: { type: "string" }, identifierValue: { type: "string" }, notes: { type: "string" },
    version: { type: "integer" }, updatedAt: { type: "integer" }
  }
});
const DELETE_RESPONSE = Object.freeze({
  type: "object", required: ["id", "deleted"], additionalProperties: false,
  properties: { id: { type: "integer" }, deleted: { const: true } }
});

function context(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
    requestId: req.requestId, ip: req.ip || req.socket?.remoteAddress || "",
    supplierId: Number(req.input.params.supplierId)
  };
}

class SupplierIdentifierHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.identifiers = new SupplierIdentifierService({
      database: services.require("mysqldatabase"), logger: services.require("logging").logger, time: services.require("time")
    });
  }
}

export class CreateSupplierIdentifierHandler extends SupplierIdentifierHandler {
  static handlerName = "createSupplierIdentifier";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/identifiers/create", description: "新增全公司唯一的供應商識別資料。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: OWNER_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: CREATE_BODY }, responseSchema: { 201: IDENTIFIER_RESPONSE }
  };
  async execute(req) { return this.response(await this.identifiers.create({ ...context(req), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateSupplierIdentifierHandler extends SupplierIdentifierHandler {
  static handlerName = "updateSupplierIdentifier";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/identifiers/:identifierId/update", description: "按版本及原因更新供應商識別資料。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: UPDATE_BODY }, responseSchema: { 200: IDENTIFIER_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.identifiers.update({ ...context(req), identifierId: Number(req.input.params.identifierId), ...req.input.body }));
  }
}

export class DeleteSupplierIdentifierHandler extends SupplierIdentifierHandler {
  static handlerName = "deleteSupplierIdentifier";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/identifiers/:identifierId/delete", description: "按版本及原因刪除未引用的供應商識別資料。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: DELETE_BODY }, responseSchema: { 200: DELETE_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.identifiers.delete({ ...context(req), identifierId: Number(req.input.params.identifierId), ...req.input.body }));
  }
}
