import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  EMPTY, PURCHASE_ORDER_ID_PARAMS, PURCHASE_ORDER_LIFECYCLE_RESPONSE, PURCHASE_ORDER_WRITE_POLICY, purchaseOrderCommand, purchaseOrderService
} from "../purchasing/purchasingSchemas.js";

class LifecycleHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.orders = purchaseOrderService(services, this.logger);
  }
}
// §5.2：三個都係 jwt／purchasing.mgmt；有冇收過貨、狀態同 version 由 service 喺 transaction 入面驗（§8.4）。
const api = (path, description) => ({ method: "POST", path: `/api/v1/purchase-orders/:id/${path}`, description, authorizationPolicies: [PURCHASE_ORDER_WRITE_POLICY],
  idempotency: { enabled: true }, requestSchema: { params: PURCHASE_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: PURCHASE_ORDER_LIFECYCLE_RESPONSE } });

export class WithdrawConfirmedPurchaseOrderHandler extends LifecycleHandler {
  static handlerName = "withdrawConfirmedPurchaseOrder";
  static api = api("confirmation/withdraw", "Withdraw a Confirmed Purchase Order with no receipt back to Draft");
  async execute(req) {
    return this.response(await this.orders.withdrawConfirmation({ ...purchaseOrderCommand(req, "withdrawConfirmation"), purchaseOrderId: Number(req.input.params.id) }));
  }
}

export class CancelPurchaseOrderHandler extends LifecycleHandler {
  static handlerName = "cancelPurchaseOrder";
  static api = api("cancel", "Cancel a Draft, Pending or unreceived Confirmed Purchase Order");
  async execute(req) {
    return this.response(await this.orders.cancel({ ...purchaseOrderCommand(req, "cancel"), purchaseOrderId: Number(req.input.params.id) }));
  }
}

export class ClosePurchaseOrderRemainingHandler extends LifecycleHandler {
  static handlerName = "closePurchaseOrderRemaining";
  static api = api("close-remaining", "Close the remaining quantity of selected or all outstanding Purchase Order lines");
  async execute(req) {
    return this.response(await this.orders.closeRemaining({ ...purchaseOrderCommand(req, "closeRemaining"), purchaseOrderId: Number(req.input.params.id) }));
  }
}
