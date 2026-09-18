import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierApprovalService } from "../../modules/supplier/SupplierApprovalService.js";
import {
  APPROVAL_APPROVE_SCHEMA,
  APPROVAL_DECISION_RESPONSE_SCHEMA,
  APPROVAL_DETAIL_SCHEMA,
  APPROVAL_ID_PARAMS_SCHEMA,
  APPROVAL_LIST_RESPONSE_SCHEMA,
  APPROVAL_QUEUE_QUERY_SCHEMA,
  APPROVAL_REASSIGN_RESPONSE_SCHEMA,
  APPROVAL_REASSIGN_SCHEMA,
  APPROVAL_REJECT_SCHEMA,
  EMPTY_APPROVAL_SCHEMA,
  SUPPLIER_APPROVAL_POLICY
} from "./approvalSchemas.js";

/**
 * 啟用審批嘅 HTTP 層。規則全部喺 SupplierApprovalService；呢度只做三件事：
 * 定認證強度同 permission、關死 request／response 嘅形狀、將 route 參數交落去。
 *
 * 設計 6.4：approve／reject／reassign 係 jwt-password。Block／unblock 唔喺呢個檔案，
 * 佢哋維持 device-password（見 handlers/suppliers/supplierLifecycleHandlers.js）。
 * 撤回亦都唔喺呢度：佢係建檔人喺 Supplier route 上面做嘅動作。
 */

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function command(req) {
  return {
    ...actor(req),
    id: Number(req.input.params.id),
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || "",
    ...req.input.body
  };
}

class SupplierApprovalHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const database = services.require("mysqldatabase");
    this.approvals = new SupplierApprovalService({
      database,
      logger: services.require("logging").logger,
      time: services.require("time"),
      // 設計 4.5：批准嗰陣要重新確認 Supplier 仍然可以啟用，所以 Business Master
      // 一定要接上 —— service 冇佢就會喺批准時拋 TypeError，而唔係靜靜哋跳過。
      businessMaster: new BusinessMasterLookupProvider({
        provider: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }),
        readiness: new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })
      })
    });
  }
}

export class ListSupplierApprovalsHandler extends SupplierApprovalHandler {
  static handlerName = "listSupplierApprovals";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-approvals",
    description: "分頁查詢啟用審批佇列，預設只看指派給自己的待處理申請。",
    authorizationPolicies: SUPPLIER_APPROVAL_POLICY,
    requestSchema: { params: EMPTY_APPROVAL_SCHEMA, query: APPROVAL_QUEUE_QUERY_SCHEMA, body: EMPTY_APPROVAL_SCHEMA },
    responseSchema: { 200: APPROVAL_LIST_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.approvals.listRequests({ ...actor(req), ...req.input.query }));
  }
}

export class GetSupplierApprovalHandler extends SupplierApprovalHandler {
  static handlerName = "getSupplierApproval";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-approvals/:id",
    description: "取得審批申請的提交快照、供應商現況與兩者差異。",
    authorizationPolicies: SUPPLIER_APPROVAL_POLICY,
    requestSchema: { params: APPROVAL_ID_PARAMS_SCHEMA, query: EMPTY_APPROVAL_SCHEMA, body: EMPTY_APPROVAL_SCHEMA },
    responseSchema: { 200: APPROVAL_DETAIL_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.approvals.getRequest({ ...actor(req), id: Number(req.input.params.id) }));
  }
}

export class ApproveSupplierApprovalHandler extends SupplierApprovalHandler {
  static handlerName = "approveSupplierApproval";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-approvals/:id/approve",
    description: "由指定審批人批准啟用申請。",
    authType: "jwt-password",
    authorizationPolicies: SUPPLIER_APPROVAL_POLICY,
    requestSchema: { params: APPROVAL_ID_PARAMS_SCHEMA, query: EMPTY_APPROVAL_SCHEMA, body: APPROVAL_APPROVE_SCHEMA },
    responseSchema: { 200: APPROVAL_DECISION_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.approvals.approveRequest(command(req)));
  }
}

export class RejectSupplierApprovalHandler extends SupplierApprovalHandler {
  static handlerName = "rejectSupplierApproval";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-approvals/:id/reject",
    description: "由指定審批人拒絕啟用申請並記錄原因。",
    authType: "jwt-password",
    authorizationPolicies: SUPPLIER_APPROVAL_POLICY,
    requestSchema: { params: APPROVAL_ID_PARAMS_SCHEMA, query: EMPTY_APPROVAL_SCHEMA, body: APPROVAL_REJECT_SCHEMA },
    responseSchema: { 200: APPROVAL_DECISION_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.approvals.rejectRequest(command(req)));
  }
}

export class ReassignSupplierApprovalHandler extends SupplierApprovalHandler {
  static handlerName = "reassignSupplierApproval";

  static api = {
    method: "POST",
    path: "/api/v1/supplier-approvals/:id/reassign",
    description: "將待處理的啟用申請重新指派給另一名審批人。",
    authType: "jwt-password",
    authorizationPolicies: SUPPLIER_APPROVAL_POLICY,
    requestSchema: { params: APPROVAL_ID_PARAMS_SCHEMA, query: EMPTY_APPROVAL_SCHEMA, body: APPROVAL_REASSIGN_SCHEMA },
    responseSchema: { 200: APPROVAL_REASSIGN_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.approvals.reassignRequest(command(req)));
  }
}
