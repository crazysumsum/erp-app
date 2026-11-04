import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_LIST_RESPONSE, PURCHASE_ORDER_READ_POLICY, purchaseOrderListRequest, purchasingInquiryService
} from "../purchasing/purchasingSchemas.js";

/** Server pagination；query 喺 handler 驗，錯誤先係 §5.7 嘅 PURCHASING_INPUT_INVALID（同 Sales 一樣）。 */
export class ListPurchaseOrdersHandler extends BaseRequestHandler {
  static handlerName = "listPurchaseOrders";
  static api = { method: "GET", path: "/api/v1/purchase-orders", description: "List Purchase Orders",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY], requestSchema: { params: EMPTY, query: {}, body: EMPTY }, responseSchema: { 200: PURCHASE_ORDER_LIST_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.inquiry.list(purchaseOrderListRequest(req)));
  }
}
