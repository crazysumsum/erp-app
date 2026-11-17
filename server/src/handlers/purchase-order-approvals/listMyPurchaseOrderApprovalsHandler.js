import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY, MY_APPROVALS_RESPONSE, myApprovalsRequest, purchasingInquiryService, PURCHASE_ORDER_DECISION_POLICY } from "../purchasing/purchasingSchemas.js";

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
