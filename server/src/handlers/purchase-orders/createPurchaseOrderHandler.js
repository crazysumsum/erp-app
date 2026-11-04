import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY, PURCHASE_ORDER_COMMAND_RESPONSE, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService } from "../purchasing/purchasingSchemas.js";

/** 建立 PO Draft＋月度編號＋完整 Lines（設計 §5.2）。 */
export class CreatePurchaseOrderHandler extends BaseRequestHandler {
  static handlerName = "createPurchaseOrder";
  static api = { method: "POST", path: "/api/v1/purchase-orders/create", description: "Create a Purchase Order Draft",
    authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: EMPTY, query: EMPTY, body: {} }, responseSchema: { 201: PURCHASE_ORDER_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
  async execute(req) { return this.response(await this.orders.create(purchaseOrderCommand(req, "create")), { statusCode: 201 }); }
}
