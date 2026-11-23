import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_LIST_RESPONSE, PURCHASE_ORDER_READ_POLICY, purchaseOrderListRequest, purchasingInquiryService
} from "../purchasing/purchasingSchemas.js";

// Handler discovery sorts paths. Register this literal route before GET /purchase-orders/:id.
export class GetOutstandingPurchaseOrdersHandler extends BaseRequestHandler {
  static handlerName = "getOutstandingPurchaseOrders";
  static api = { method: "GET", path: "/api/v1/purchase-orders/outstanding", description: "List outstanding Purchase Orders",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY], requestSchema: { params: EMPTY, query: {}, body: EMPTY }, responseSchema: { 200: PURCHASE_ORDER_LIST_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.inquiry.list(purchaseOrderListRequest(req, { outstandingOnly: true })));
  }
}
