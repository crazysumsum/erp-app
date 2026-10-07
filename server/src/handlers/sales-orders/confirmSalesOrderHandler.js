import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderConfirmationService } from "../../modules/sales/SalesOrderConfirmationService.js";
import { SalesOrderService } from "../../modules/sales/SalesOrderService.js";
import { EMPTY,SALES_ORDER_ID_PARAMS,SALES_ORDER_WRITE_POLICY,SALES_CONFIRMATION_RESPONSE,SALES_CONFIRMATION_PENDING_RESPONSE,
  salesActorClaims,validateSalesConfirmationInput } from "../sales/salesSchemas.js";

export class ConfirmSalesOrderHandler extends BaseRequestHandler {
  static handlerName = "confirmSalesOrder";
  static api = { method: "POST",path: "/api/v1/sales-orders/:id/confirm",description: "Confirm a Sales Order with durable recovery",
    authorizationPolicies: [SALES_ORDER_WRITE_POLICY],idempotency: { enabled: true,retryAfterSeconds: 2 },
    requestSchema: { params: SALES_ORDER_ID_PARAMS,query: EMPTY,body: {} },responseSchema: { 200: SALES_CONFIRMATION_RESPONSE,202: SALES_CONFIRMATION_PENDING_RESPONSE } };
  constructor(services = {}) {
    super(services);
    const options = { database: services.require("mysqldatabase"),time: services.require("time"),logger: this.logger };
    this.order = new SalesOrderService(options);
    this.confirmation = new SalesOrderConfirmationService({ ...options,config: services.config.sales });
  }
  authorizeRequest(req) { return this.order.authorizeWrite(salesActorClaims(req)); }
  async execute(req, res) {
    const result = await this.confirmation.confirm({ claims: salesActorClaims(req),id: Number(req.input.params.id),input: validateSalesConfirmationInput(req.input.body),
      trace: { requestId: req.requestId ?? "",correlationId: req.correlationId ?? "",ipAddress: req.ip ?? "" } });
    if (result.statusCode === 202) res.setHeader("Retry-After", String(result.retryAfterSeconds));
    return this.response(result.data, { statusCode: result.statusCode });
  }
}
