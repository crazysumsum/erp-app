import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerApprovalService } from "../../modules/customer/CustomerApprovalService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_APPROVER_QUERY, CUSTOMER_APPROVER_RESPONSE, EMPTY } from "../customers/customerSchemas.js";

export class ListCustomerApproversHandler extends BaseRequestHandler {
  static handlerName = "listCustomerApprovers";
  static api = { method: "GET", path: "/api/v1/customer-approvers", description: "查詢可指派的客戶審批人。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approverLookup], requestSchema: { params: EMPTY, query: CUSTOMER_APPROVER_QUERY, body: EMPTY }, responseSchema: { 200: CUSTOMER_APPROVER_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.approvals = new CustomerApprovalService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }
  async execute(req) {
    return this.response(await this.approvals.listEligibleApprovers({ actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions, ...req.input.query }));
  }
}
