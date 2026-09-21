import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierContactService, SUPPLIER_CONTACT_PURPOSES } from "../../modules/supplier/SupplierContactService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_MGMT_POLICY } from "./supplierSchemas.js";

const OWNER_PARAMS = Object.freeze({
  type: "object", required: ["supplierId"], additionalProperties: false,
  properties: { supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" } }
});
const CHILD_PARAMS = Object.freeze({
  type: "object", required: ["supplierId", "contactId"], additionalProperties: false,
  properties: {
    supplierId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    contactId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});
const PURPOSE_SCHEMA = Object.freeze({
  type: "object", required: ["purposeCode", "isPrimary"], additionalProperties: false,
  properties: { purposeCode: { type: "string", enum: [...SUPPLIER_CONTACT_PURPOSES] }, isPrimary: { type: "boolean" } }
});
const CONTACT_PROPERTIES = Object.freeze({
  name: { type: "string", minLength: 1, maxLength: 190 },
  jobTitle: { type: "string", maxLength: 100, default: "" },
  department: { type: "string", maxLength: 100, default: "" },
  email: { type: "string", maxLength: 254, default: "" },
  phone: { type: "string", maxLength: 50, default: "" },
  mobile: { type: "string", maxLength: 50, default: "" },
  preferredLanguage: { type: "string", maxLength: 20, default: "" },
  notes: { type: "string", maxLength: 500, default: "" },
  purposes: { type: "array", maxItems: SUPPLIER_CONTACT_PURPOSES.length, items: PURPOSE_SCHEMA }
});
const CREATE_BODY = Object.freeze({
  type: "object", required: ["name", "purposes"], additionalProperties: false, properties: CONTACT_PROPERTIES
});
const UPDATE_BODY = Object.freeze({
  type: "object", required: ["name", "purposes", "version"], additionalProperties: false,
  properties: { ...CONTACT_PROPERTIES, version: { type: "integer", minimum: 1 } }
});
const DEACTIVATE_BODY = Object.freeze({
  type: "object", required: ["version"], additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 } }
});
const CONTACT_RESPONSE = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["id", "supplierId", "name", "jobTitle", "department", "email", "phone", "mobile", "preferredLanguage", "notes", "status", "purposes", "version", "updatedAt"],
  properties: {
    id: { type: "integer" }, supplierId: { type: "integer" }, name: { type: "string" }, jobTitle: { type: "string" },
    department: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, mobile: { type: "string" },
    preferredLanguage: { type: "string" }, notes: { type: "string" }, status: { type: "string", enum: ["active", "inactive"] },
    purposes: { type: "array", items: PURPOSE_SCHEMA }, version: { type: "integer" }, updatedAt: { type: "integer" }
  }
});

function context(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions,
    requestId: req.requestId, ip: req.ip || req.socket?.remoteAddress || "",
    supplierId: Number(req.input.params.supplierId)
  };
}

class SupplierContactHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.contacts = new SupplierContactService({
      database: services.require("mysqldatabase"), logger: services.require("logging").logger, time: services.require("time")
    });
  }
}

export class CreateSupplierContactHandler extends SupplierContactHandler {
  static handlerName = "createSupplierContact";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/contacts/create", description: "新增供應商聯絡人及用途。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: OWNER_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: CREATE_BODY }, responseSchema: { 201: CONTACT_RESPONSE }
  };
  async execute(req) { return this.response(await this.contacts.create({ ...context(req), ...req.input.body }), { statusCode: 201 }); }
}

export class UpdateSupplierContactHandler extends SupplierContactHandler {
  static handlerName = "updateSupplierContact";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/contacts/:contactId/update", description: "按版本更新供應商聯絡人及完整用途集合。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: UPDATE_BODY }, responseSchema: { 200: CONTACT_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.contacts.update({ ...context(req), contactId: Number(req.input.params.contactId), ...req.input.body }));
  }
}

export class DeactivateSupplierContactHandler extends SupplierContactHandler {
  static handlerName = "deactivateSupplierContact";
  static api = {
    method: "POST", path: "/api/v1/suppliers/:supplierId/contacts/:contactId/deactivate", description: "停用供應商聯絡人並清除其主要用途標記。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: CHILD_PARAMS, query: EMPTY_SUPPLIER_SCHEMA, body: DEACTIVATE_BODY }, responseSchema: { 200: CONTACT_RESPONSE }
  };
  async execute(req) {
    return this.response(await this.contacts.deactivate({ ...context(req), contactId: Number(req.input.params.contactId), ...req.input.body }));
  }
}
