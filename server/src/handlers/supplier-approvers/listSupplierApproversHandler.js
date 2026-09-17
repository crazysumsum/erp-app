import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierApprovalService } from "../../modules/supplier/SupplierApprovalService.js";
import {
  APPROVER_LOOKUP_QUERY_SCHEMA,
  APPROVER_LOOKUP_RESPONSE_SCHEMA,
  EMPTY_APPROVAL_SCHEMA
} from "../supplier-approvals/approvalSchemas.js";

/**
 * 設計 6.4：揀審批人嘅 lookup。建檔人（supplier.mgmt）要用佢先揀得到人，審批人
 * （supplier.approval）要用佢先重新指派得到，所以兩個 permission 任一個就夠。
 *
 * 呢個 route 刻意唔重用 User Admin API：嗰個要 user.mgmt，而且會回 roles、email
 * 同帳號安全狀態。呢度只回 id、username、displayName。
 */
const APPROVER_LOOKUP_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({
    permissions: Object.freeze(["supplier.mgmt", "supplier.approval"]),
    match: "any"
  })
})]);

export class ListSupplierApproversHandler extends BaseRequestHandler {
  static handlerName = "listSupplierApprovers";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-approvers",
    description: "列出目前仍然具備審批權限的有效使用者，供指派審批人使用。",
    authorizationPolicies: APPROVER_LOOKUP_POLICY,
    requestSchema: { params: EMPTY_APPROVAL_SCHEMA, query: APPROVER_LOOKUP_QUERY_SCHEMA, body: EMPTY_APPROVAL_SCHEMA },
    responseSchema: { 200: APPROVER_LOOKUP_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.approvals = new SupplierApprovalService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
      // businessMaster 唔需要：呢條路唔會批准任何嘢。
    });
  }

  async execute(req) {
    return this.response(await this.approvals.listEligibleApprovers({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      ...req.input.query
    }));
  }
}
