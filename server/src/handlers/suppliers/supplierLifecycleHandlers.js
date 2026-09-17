import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { getActivationPolicy } from "../../modules/supplier/SupplierSettingsService.js";
import { SupplierAdminService } from "../../modules/supplier/SupplierAdminService.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import {
  EMPTY_SUPPLIER_SCHEMA,
  SUPPLIER_ACTIVATE_SCHEMA,
  SUPPLIER_DELETE_RESPONSE_SCHEMA,
  SUPPLIER_DETAIL_SCHEMA,
  SUPPLIER_ID_PARAMS_SCHEMA,
  SUPPLIER_LIFECYCLE_SCHEMA,
  SUPPLIER_MGMT_POLICY
} from "./supplierSchemas.js";

const SUPPLIER_BLOCK_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.view", "supplier.approval"]) })
})]);

function context(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions,
    id: Number(req.input.params.id),
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || "",
    ...req.input.body
  };
}

class SupplierLifecycleHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    const provider = new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
    this.suppliers = new SupplierAdminService({
      database,
      logger: services.require("logging").logger,
      time: services.require("time"),
      businessMaster: new BusinessMasterLookupProvider({
        provider,
        readiness: new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })
      }),
      approvalRequired: getActivationPolicy
    });
  }
}

function api({ path, description, authType, policy = SUPPLIER_MGMT_POLICY, body = SUPPLIER_LIFECYCLE_SCHEMA, response = SUPPLIER_DETAIL_SCHEMA }) {
  return {
    method: "POST", path, description, ...(authType ? { authType } : {}), authorizationPolicies: policy,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body },
    responseSchema: { 200: response }
  };
}

export class ActivateSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "activateSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/activate", description: "啟用供應商；審批模式由設定決定。", body: SUPPLIER_ACTIVATE_SCHEMA });
  async execute(req) { return this.response(await this.suppliers.activateSupplier(context(req))); }
}

export class SuspendSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "suspendSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/suspend", description: "暫停啟用中的供應商。", authType: "jwt-password" });
  async execute(req) { return this.response(await this.suppliers.suspendSupplier(context(req))); }
}

export class ReactivateSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "reactivateSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/reactivate", description: "重新啟用已暫停供應商。", authType: "jwt-password" });
  async execute(req) { return this.response(await this.suppliers.reactivateSupplier(context(req))); }
}

export class BlockSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "blockSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/block", description: "由供應商審批權限持有人封鎖供應商。", authType: "jwt-device-password", policy: SUPPLIER_BLOCK_POLICY });
  async execute(req) { return this.response(await this.suppliers.blockSupplier(context(req))); }
}

export class UnblockSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "unblockSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/unblock", description: "解除供應商封鎖並回到已暫停。", authType: "jwt-device-password", policy: SUPPLIER_BLOCK_POLICY });
  async execute(req) { return this.response(await this.suppliers.unblockSupplier(context(req))); }
}

export class ArchiveSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "archiveSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/archive", description: "在沒有未完成流程時封存供應商。", authType: "jwt-password" });
  async execute(req) { return this.response(await this.suppliers.archiveSupplier(context(req))); }
}

export class RestoreSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "restoreSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/restore", description: "從封存還原供應商到已暫停。", authType: "jwt-password" });
  async execute(req) { return this.response(await this.suppliers.restoreSupplier(context(req))); }
}

export class DeleteSupplierHandler extends SupplierLifecycleHandler {
  static handlerName = "deleteSupplier";
  static api = api({ path: "/api/v1/suppliers/:id/delete", description: "永久刪除從未被引用的草稿供應商。", authType: "jwt-device-password", response: SUPPLIER_DELETE_RESPONSE_SCHEMA });
  async execute(req) { return this.response(await this.suppliers.deleteSupplier(context(req))); }
}
