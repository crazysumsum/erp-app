import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderService } from "../../modules/sales/SalesOrderService.js";
import { EMPTY, SALES_ORDER_ID_PARAMS, SALES_ORDER_COMMAND_RESPONSE, SALES_ORDER_WRITE_POLICY, salesActorClaims, salesOrderCommandRequest } from "../sales/salesSchemas.js";

export class UpdateSalesOrderHandler extends BaseRequestHandler {
  static handlerName = "updateSalesOrder";
  static api = { method: "POST", path: "/api/v1/sales-orders/:id/update", description: "Update an editable Sales Order Draft",
    authorizationPolicies: [SALES_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: SALES_ORDER_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: SALES_ORDER_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.order = new SalesOrderService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  authorizeRequest(req) { return this.order.authorizeWrite(salesActorClaims(req)); }
  async execute(req) { return this.response(await this.order.update({ ...salesOrderCommandRequest(req, true), id: Number(req.input.params.id) })); }
}
