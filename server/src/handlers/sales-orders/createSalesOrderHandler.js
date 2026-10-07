import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderService } from "../../modules/sales/SalesOrderService.js";
import { EMPTY, SALES_ORDER_COMMAND_RESPONSE, SALES_ORDER_WRITE_POLICY, salesActorClaims, salesOrderCommandRequest } from "../sales/salesSchemas.js";

export class CreateSalesOrderHandler extends BaseRequestHandler {
  static handlerName = "createSalesOrder";
  static api = { method: "POST", path: "/api/v1/sales-orders/create", description: "Create a Sales Order Draft",
    authorizationPolicies: [SALES_ORDER_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: EMPTY, query: EMPTY, body: {} }, responseSchema: { 201: SALES_ORDER_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.order = new SalesOrderService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  authorizeRequest(req) { return this.order.authorizeWrite(salesActorClaims(req)); }
  async execute(req) { return this.response(await this.order.create(salesOrderCommandRequest(req)), { statusCode: 201 }); }
}
