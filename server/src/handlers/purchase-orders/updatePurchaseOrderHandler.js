import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_COMMAND_RESPONSE, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService
} from "../purchasing/purchasingSchemas.js";

/** DRAFT 先改得；完整取代 editable projection＋version（設計 §5.2）。 */
export class UpdatePurchaseOrderHandler extends BaseRequestHandler {
  static handlerName = "updatePurchaseOrder";
  static api = { method: "POST", path: "/api/v1/purchase-orders/:id/update", description: "Replace a Purchase Order Draft",
    authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: PURCHASE_ORDER_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.orders.update({ ...purchaseOrderCommand(req, true), purchaseOrderId: Number(req.input.params.id) }));
  }
}
