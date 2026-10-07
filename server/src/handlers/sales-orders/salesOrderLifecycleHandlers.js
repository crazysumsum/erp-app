import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderLifecycleService, validateSalesLifecycleInput } from "../../modules/sales/SalesOrderLifecycleService.js";
import { EMPTY, SALES_ORDER_ID_PARAMS, SALES_ORDER_WRITE_POLICY, SALES_LIFECYCLE_RESPONSE, salesActorClaims } from "../sales/salesSchemas.js";
const api = path => ({ method: "POST",description: `Sales Order ${path}`,path: `/api/v1/sales-orders/:id/${path}`,authorizationPolicies: [SALES_ORDER_WRITE_POLICY],idempotency: { enabled: true },
  requestSchema: { params: SALES_ORDER_ID_PARAMS,query: EMPTY,body: {} },responseSchema: { 200: SALES_LIFECYCLE_RESPONSE } });
// Private base is not exported: registry discovers only concrete route handlers.
class LifecycleHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.lifecycle = new SalesOrderLifecycleService({ database: services.require("mysqldatabase"),time: services.require("time"),logger: this.logger,services,config: services.config.sales });
  }
  authorizeRequest(req) { return this.lifecycle.order.authorizeWrite(salesActorClaims(req)); }
  command(req) { return { claims: salesActorClaims(req),id: Number(req.input.params.id),input: validateSalesLifecycleInput(req.input.body),signal: req.requestTimeout?.signal,
    trace: { requestId: req.requestId ?? "",correlationId: req.correlationId ?? "",ipAddress: req.ip ?? "" } }; }
}
export class WithdrawSalesOrderHandler extends LifecycleHandler {
  static handlerName = "withdrawSalesOrder";static api = api("confirmation/withdraw");
  async execute(req) { return this.response(await this.lifecycle.withdrawConfirmation(this.command(req))); }
}
export class CancelSalesOrderHandler extends LifecycleHandler {
  static handlerName = "cancelSalesOrder";static api = api("cancel");
  async execute(req) { return this.response(await this.lifecycle.cancel(this.command(req))); }
}
export class CloseRemainingSalesOrderHandler extends LifecycleHandler {
  static handlerName = "closeRemainingSalesOrder";static api = api("close-remaining");
  async execute(req) { return this.response(await this.lifecycle.closeRemaining(this.command(req))); }
}
