import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { EMPTY, QUOTATION_ID_PARAMS, QUOTATION_READ_RESPONSE, SALES_READ_POLICY, quotationActorClaims } from "./salesQuotationSchemas.js";

export class GetSalesQuotationHandler extends BaseRequestHandler {
  static handlerName = "getSalesQuotation";
  static api = { method: "GET", path: "/api/v1/sales-quotations/:id", description: "Read a Sales Quotation",
    authorizationPolicies: [SALES_READ_POLICY], requestSchema: { params: QUOTATION_ID_PARAMS, query: EMPTY, body: EMPTY }, responseSchema: { 200: QUOTATION_READ_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  async execute(req) { return this.response(await this.quotation.get({ claims: quotationActorClaims(req), id: Number(req.input.params.id) })); }
}
