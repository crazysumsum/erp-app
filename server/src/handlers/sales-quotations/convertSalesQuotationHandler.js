import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { EMPTY, QUOTATION_ID_PARAMS, QUOTATION_CONVERT_RESPONSE, SALES_WRITE_POLICY, quotationActorClaims, quotationLifecycleRequest } from "./salesQuotationSchemas.js";

export class ConvertSalesQuotationHandler extends BaseRequestHandler {
  static handlerName = "convertSalesQuotation";
  static api = { method: "POST", path: "/api/v1/sales-quotations/:id/convert", description: "Convert Sales Quotation",
    authorizationPolicies: [SALES_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: QUOTATION_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 201: QUOTATION_CONVERT_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  authorizeRequest(req) { return this.quotation.authorizeWrite(quotationActorClaims(req)); }
  async execute(req) { return this.response(await this.quotation.convert(quotationLifecycleRequest(req, "CONVERT")), { statusCode: 201 }); }
}
