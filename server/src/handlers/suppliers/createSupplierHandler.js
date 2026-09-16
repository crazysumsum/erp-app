import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierAdminService } from "../../modules/supplier/SupplierAdminService.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_CREATE_SCHEMA, SUPPLIER_DETAIL_SCHEMA, SUPPLIER_MGMT_POLICY } from "./supplierSchemas.js";

export class CreateSupplierHandler extends BaseRequestHandler {
  static handlerName = "createSupplier";
  static api = {
    method: "POST", path: "/api/v1/suppliers/create", description: "建立草稿供應商，或在審批關閉時直接啟用。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY, idempotency: { enabled: true },
    requestSchema: { params: EMPTY_SUPPLIER_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_CREATE_SCHEMA },
    responseSchema: { 201: SUPPLIER_DETAIL_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    const logger = services.require("logging").logger;
    const time = services.require("time");
    const provider = new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    const businessMaster = new BusinessMasterLookupProvider({
      provider,
      readiness: new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })
    });
    this.suppliers = new SupplierAdminService({ database, logger, time, businessMaster });
  }

  async execute(req) {
    const result = await this.suppliers.createSupplier({
      ...req.input.body,
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });
    return this.response(result, { statusCode: 201 });
  }
}
