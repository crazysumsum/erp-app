import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { SupplierAdminService } from "../../modules/supplier/SupplierAdminService.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import {
  EMPTY_SUPPLIER_SCHEMA,
  SUPPLIER_CODE_CHANGE_SCHEMA,
  SUPPLIER_DETAIL_SCHEMA,
  SUPPLIER_ID_PARAMS_SCHEMA,
  SUPPLIER_MGMT_POLICY,
  SUPPLIER_UPDATE_SCHEMA
} from "./supplierSchemas.js";

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions,
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

function supplierService(services) {
  const database = services.require("mysqldatabase");
  const provider = new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
  return new SupplierAdminService({
    database,
    logger: services.require("logging").logger,
    time: services.require("time"),
    businessMaster: new BusinessMasterLookupProvider({
      provider,
      readiness: new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })
    })
  });
}

export class UpdateSupplierHandler extends BaseRequestHandler {
  static handlerName = "updateSupplier";
  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/update",
    description: "以版本控制更新供應商一般主資料；不接受 Supplier Code。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_UPDATE_SCHEMA },
    responseSchema: { 200: SUPPLIER_DETAIL_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.suppliers = supplierService(services);
  }

  async execute(req) {
    return this.response(await this.suppliers.updateSupplier({
      ...actor(req),
      ...req.input.body,
      id: Number(req.input.params.id)
    }));
  }
}

export class ChangeSupplierCodeHandler extends BaseRequestHandler {
  static handlerName = "changeSupplierCode";
  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/code/change",
    description: "僅為未被引用的供應商受控修正 Supplier Code。",
    authType: "jwt-device-password",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_CODE_CHANGE_SCHEMA },
    responseSchema: { 200: SUPPLIER_DETAIL_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.suppliers = supplierService(services);
  }

  async execute(req) {
    return this.response(await this.suppliers.changeSupplierCode({
      ...actor(req),
      supplierCode: req.input.body.supplierCode,
      reason: req.input.body.reason,
      version: req.input.body.version,
      id: Number(req.input.params.id)
    }));
  }
}
