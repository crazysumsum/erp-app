import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { EMPTY, QUOTATION_ID_PARAMS, QUOTATION_COMMAND_RESPONSE, SALES_WRITE_POLICY, quotationActorClaims, quotationCommandRequest } from "./salesQuotationSchemas.js";

export class UpdateSalesQuotationHandler extends BaseRequestHandler {
  static handlerName = "updateSalesQuotation";
  static api = { method: "POST", path: "/api/v1/sales-quotations/:id/update", description: "Update an editable Sales Quotation Draft",
    authorizationPolicies: [SALES_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: QUOTATION_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: QUOTATION_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  authorizeRequest(req) { return this.quotation.authorizeWrite(quotationActorClaims(req)); }
  async execute(req) { return this.response(await this.quotation.update({ ...quotationCommandRequest(req, true), id: Number(req.input.params.id) })); }
}
