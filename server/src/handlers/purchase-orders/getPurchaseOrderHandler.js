import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_DETAIL_RESPONSE, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_READ_POLICY, purchasingInquiryService
} from "../purchasing/purchasingSchemas.js";

/** 交易快照、進度同 allowedActions；目前主資料另外放（設計 §5.6）。 */
export class GetPurchaseOrderHandler extends BaseRequestHandler {
  static handlerName = "getPurchaseOrder";
  static api = { method: "GET", path: "/api/v1/purchase-orders/:id", description: "Read a Purchase Order",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY], requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: EMPTY },
    responseSchema: { 200: PURCHASE_ORDER_DETAIL_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.inquiry.get({ claims: req.auth.claims, id: Number(req.input.params.id) }));
  }
}
