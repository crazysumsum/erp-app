import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { EMPTY, QUOTATION_COMMAND_RESPONSE, SALES_WRITE_POLICY, quotationActorClaims, quotationCommandRequest } from "./salesQuotationSchemas.js";

export class CreateSalesQuotationHandler extends BaseRequestHandler {
  static handlerName = "createSalesQuotation";
  static api = { method: "POST", path: "/api/v1/sales-quotations/create", description: "Create a Sales Quotation Draft",
    authorizationPolicies: [SALES_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: EMPTY, query: EMPTY, body: {} }, responseSchema: { 201: QUOTATION_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  authorizeRequest(req) { return this.quotation.authorizeWrite(quotationActorClaims(req)); }
  async execute(req) { return this.response(await this.quotation.create(quotationCommandRequest(req)), { statusCode: 201 }); }
}
