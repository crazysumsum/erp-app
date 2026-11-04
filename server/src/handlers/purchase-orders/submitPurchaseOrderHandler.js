import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_SUBMIT_RESPONSE, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService
} from "../purchasing/purchasingSchemas.js";

/** 按當刻設定決定結果（設計 §5.2）；審批關閉時完整 Draft 直接 Confirmed。 */
export class SubmitPurchaseOrderHandler extends BaseRequestHandler {
  static handlerName = "submitPurchaseOrder";
  static api = { method: "POST", path: "/api/v1/purchase-orders/:id/submit", description: "Submit a Purchase Order Draft",
    authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: PURCHASE_ORDER_SUBMIT_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.orders.submit({ ...purchaseOrderCommand(req, "submit"), purchaseOrderId: Number(req.input.params.id) }));
  }
}
