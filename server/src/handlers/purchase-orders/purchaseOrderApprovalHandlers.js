import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, MY_APPROVALS_RESPONSE, myApprovalsRequest, purchasingInquiryService, PURCHASE_ORDER_DECISION_POLICY, PURCHASE_ORDER_DECISION_RESPONSE, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService
} from "../purchasing/purchasingSchemas.js";

class ApprovalHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
}
const api = (action, authorization, description) => ({ method: "POST", path: `/api/v1/purchase-orders/:id/approval/${action}`, description, ...authorization, idempotency: { enabled: true },
  requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: PURCHASE_ORDER_DECISION_RESPONSE } });

/** 待我審批（§5.2）：只回指派畀自己嘅 Pending，由 service 按 DB 權限驗。 */
export class ListMyPurchaseOrderApprovalsHandler extends BaseRequestHandler {
  static handlerName = "listMyPurchaseOrderApprovals";
  static api = { method: "GET", path: "/api/v1/purchase-order-approvals/mine", description: "List Purchase Order approvals assigned to me",
    authorizationPolicies: [PURCHASE_ORDER_DECISION_POLICY], requestSchema: { params: EMPTY, query: {}, body: EMPTY }, responseSchema: { 200: MY_APPROVALS_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.inquiry.myApprovals(myApprovalsRequest(req)));
  }
}

/** 審批係職責分離嘅正式決定，要再輸入密碼（§6.2）。Assigned approver 由 service 喺 transaction 入面驗。 */
export class ApprovePurchaseOrderHandler extends ApprovalHandler {
  static handlerName = "approvePurchaseOrder";
  static api = api("approve", { authType: "jwt-password", authorizationPolicies: [PURCHASE_ORDER_DECISION_POLICY] }, "Approve a pending Purchase Order");
  async execute(req) {
    return this.response(await this.orders.approve({ ...purchaseOrderCommand(req, "approve"), purchaseOrderId: Number(req.input.params.id) }));
  }
}

export class RejectPurchaseOrderHandler extends ApprovalHandler {
  static handlerName = "rejectPurchaseOrder";
  static api = api("reject", { authType: "jwt-password", authorizationPolicies: [PURCHASE_ORDER_DECISION_POLICY] }, "Reject a pending Purchase Order");
  async execute(req) {
    return this.response(await this.orders.reject({ ...purchaseOrderCommand(req, "reject"), purchaseOrderId: Number(req.input.params.id) }));
  }
}

/** 只有提交人可以撤回，由 service 驗（§5.2）。 */
export class WithdrawPurchaseOrderApprovalHandler extends ApprovalHandler {
  static handlerName = "withdrawPurchaseOrderApproval";
  static api = api("withdraw", { authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY] }, "Withdraw a pending Purchase Order approval");
  async execute(req) {
    return this.response(await this.orders.withdrawApproval({ ...purchaseOrderCommand(req, "withdrawApproval"), purchaseOrderId: Number(req.input.params.id) }));
  }
}
