import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierApprovalService } from "../../modules/supplier/SupplierApprovalService.js";
import { APPROVAL_DECISION_RESPONSE_SCHEMA } from "../supplier-approvals/approvalSchemas.js";
import { EMPTY_SUPPLIER_SCHEMA, SUPPLIER_ID_PARAMS_SCHEMA, SUPPLIER_MGMT_POLICY } from "./supplierSchemas.js";

/**
 * 設計 6.4：撤回係建檔人嘅動作，唔係 queue 操作 —— 所以佢喺 Supplier route 上面，
 * 要 supplier.mgmt，而且唔要求再確認密碼。只有原提交人撤回得到，呢條規則由
 * SupplierApprovalService 喺交易入面驗。
 *
 * Route 帶 Supplier id，body 帶 request id：service 會確認兩者夾得返，唔夾就當
 * 搵唔到，同設計 6.3 對 child route 嘅做法一致。
 */
const SUPPLIER_APPROVAL_WITHDRAW_SCHEMA = Object.freeze({
  type: "object",
  required: ["requestId", "version"],
  additionalProperties: false,
  properties: {
    requestId: { type: "integer", minimum: 1 },
    version: { type: "integer", minimum: 1 },
    reason: { type: "string", maxLength: 500 }
  }
});

export class WithdrawSupplierApprovalHandler extends BaseRequestHandler {
  static handlerName = "withdrawSupplierApproval";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/approval/withdraw",
    description: "由原提交人撤回待處理的啟用申請，供應商回到草稿。",
    authorizationPolicies: SUPPLIER_MGMT_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_SUPPLIER_SCHEMA, body: SUPPLIER_APPROVAL_WITHDRAW_SCHEMA },
    responseSchema: { 200: APPROVAL_DECISION_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.approvals = new SupplierApprovalService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
      // businessMaster 唔需要：撤回令 Supplier 回 draft，唔會啟用佢。
    });
  }

  async execute(req) {
    const { requestId, ...body } = req.input.body;
    return this.response(await this.approvals.withdrawRequest({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      supplierId: Number(req.input.params.id),
      id: requestId,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || "",
      ...body
    }));
  }
}
