import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderConfirmationService } from "../../modules/sales/SalesOrderConfirmationService.js";
import { EMPTY,SALES_ORDER_WRITE_POLICY,SALES_OPERATION_EVENT_PARAMS,SALES_OPERATION_LOOKUP_RESPONSE,salesActorClaims } from "../sales/salesSchemas.js";

export class SalesOperationLookupHandler extends BaseRequestHandler {
  static handlerName = "salesOperationLookup";
  static api = { method: "GET",path: "/api/v1/sales-operations/by-event/:eventId",description: "Read the current original actor's Sales operation",
    authorizationPolicies: [SALES_ORDER_WRITE_POLICY],requestSchema: { params: SALES_OPERATION_EVENT_PARAMS,query: EMPTY,body: EMPTY },
    responseSchema: { 200: SALES_OPERATION_LOOKUP_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.confirmation = new SalesOrderConfirmationService({ database: services.require("mysqldatabase"),time: services.require("time"),logger: this.logger,config: services.config.sales });
  }
  async execute(req) { return this.response(await this.confirmation.lookup({ claims: salesActorClaims(req),eventId: req.input.params.eventId })); }
}
