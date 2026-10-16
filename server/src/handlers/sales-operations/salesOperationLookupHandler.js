import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOperationService } from "../../modules/sales/SalesOperationService.js";
import { EMPTY,SALES_ORDER_READ_POLICY,SALES_OPERATION_EVENT_PARAMS,SALES_OPERATION_LOOKUP_RESPONSE,salesActorClaims } from "../sales/salesSchemas.js";

export class SalesOperationLookupHandler extends BaseRequestHandler {
  static handlerName = "salesOperationLookup";
  static api = { method: "GET",path: "/api/v1/sales-operations/by-event/:eventId",description: "Read the current original actor's Sales operation",
    authorizationPolicies: [SALES_ORDER_READ_POLICY],requestSchema: { params: SALES_OPERATION_EVENT_PARAMS,query: EMPTY,body: EMPTY },
    responseSchema: { 200: SALES_OPERATION_LOOKUP_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.operations = new SalesOperationService();this.database=services.require("mysqldatabase");
  }
  async execute(req) { return this.response(await this.operations.lookup(this.database,{ claims: salesActorClaims(req),eventId: req.input.params.eventId })); }
}
