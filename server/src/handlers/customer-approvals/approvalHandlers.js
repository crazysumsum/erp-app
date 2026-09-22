import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerApprovalService } from "../../modules/customer/CustomerApprovalService.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import {
  CUSTOMER_APPROVAL_APPROVE, CUSTOMER_APPROVAL_DECISION_RESPONSE, CUSTOMER_APPROVAL_DETAIL,
  CUSTOMER_APPROVAL_ID_PARAMS, CUSTOMER_APPROVAL_LIST_RESPONSE, CUSTOMER_APPROVAL_QUEUE_QUERY,
  CUSTOMER_APPROVAL_REASSIGN, CUSTOMER_APPROVAL_REASSIGN_RESPONSE, CUSTOMER_APPROVAL_REJECT, EMPTY
} from "../customers/customerSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });
const actor = (req) => ({ actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles, claimedPermissions: req.auth.claims.permissions });
const command = (req) => ({ ...actor(req), id: Number(req.input.params.id), idempotencyKey: req.get("Idempotency-Key"), requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || "", ...req.input.body });

class CustomerApprovalHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.approvals = new CustomerApprovalService({ database: services.require("mysqldatabase"), time: services.require("time") });
  }
}

export class ListCustomerApprovalsHandler extends CustomerApprovalHandler {
  static handlerName = "listCustomerApprovals";
  static api = { method: "GET", path: "/api/v1/customer-approvals", description: "查詢客戶啟用審批佇列。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approval], requestSchema: { params: EMPTY, query: CUSTOMER_APPROVAL_QUEUE_QUERY, body: EMPTY }, responseSchema: { 200: CUSTOMER_APPROVAL_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.listRequests({ ...actor(req), ...req.input.query })); }
}

export class GetCustomerApprovalHandler extends CustomerApprovalHandler {
  static handlerName = "getCustomerApproval";
  static api = { method: "GET", path: "/api/v1/customer-approvals/:id", description: "取得客戶啟用審批快照與目前差異。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approval], requestSchema: { params: CUSTOMER_APPROVAL_ID_PARAMS, query: EMPTY, body: EMPTY }, responseSchema: { 200: CUSTOMER_APPROVAL_DETAIL } };
  async execute(req) { return this.response(await this.approvals.getRequest({ ...actor(req), id: Number(req.input.params.id) })); }
}

export class ApproveCustomerApprovalHandler extends CustomerApprovalHandler {
  static handlerName = "approveCustomerApproval";
  static api = { method: "POST", path: "/api/v1/customer-approvals/:id/approve", description: "批准客戶啟用審批。", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approval], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_APPROVAL_ID_PARAMS, query: EMPTY, body: CUSTOMER_APPROVAL_APPROVE }, responseSchema: { 200: CUSTOMER_APPROVAL_DECISION_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.approve(command(req))); }
}

export class RejectCustomerApprovalHandler extends CustomerApprovalHandler {
  static handlerName = "rejectCustomerApproval";
  static api = { method: "POST", path: "/api/v1/customer-approvals/:id/reject", description: "拒絕客戶啟用審批。", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approval], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_APPROVAL_ID_PARAMS, query: EMPTY, body: CUSTOMER_APPROVAL_REJECT }, responseSchema: { 200: CUSTOMER_APPROVAL_DECISION_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.reject(command(req))); }
}

export class ReassignCustomerApprovalHandler extends CustomerApprovalHandler {
  static handlerName = "reassignCustomerApproval";
  static api = { method: "POST", path: "/api/v1/customer-approvals/:id/reassign", description: "改派客戶啟用審批人。", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.approval], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_APPROVAL_ID_PARAMS, query: EMPTY, body: CUSTOMER_APPROVAL_REASSIGN }, responseSchema: { 200: CUSTOMER_APPROVAL_REASSIGN_RESPONSE } };
  async execute(req) { return this.response(await this.approvals.reassign(command(req))); }
}
