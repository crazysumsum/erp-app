import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_COMMAND_RESPONSE, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService
} from "../purchasing/purchasingSchemas.js";

/** 建新 Draft、新編號；重驗所有主檔，唔抄狀態（設計 §5.2）。 */
export class CopyPurchaseOrderHandler extends BaseRequestHandler {
  static handlerName = "copyPurchaseOrder";
  static api = { method: "POST", path: "/api/v1/purchase-orders/:id/copy", description: "Copy a Purchase Order to a new Draft",
    authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 201: PURCHASE_ORDER_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.orders.copy({ ...purchaseOrderCommand(req, "copy"), purchaseOrderId: Number(req.input.params.id) }), { statusCode: 201 });
  }
}
