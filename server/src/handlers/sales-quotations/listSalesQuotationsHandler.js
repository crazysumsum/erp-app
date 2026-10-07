import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesQuotationService } from "../../modules/sales/SalesQuotationService.js";
import { EMPTY, QUOTATION_LIST_RESPONSE, SALES_READ_POLICY, quotationListRequest } from "./salesQuotationSchemas.js";

export class ListSalesQuotationsHandler extends BaseRequestHandler {
  static handlerName = "listSalesQuotations";
  static api = { method: "GET", path: "/api/v1/sales-quotations", description: "List Sales Quotations",
    authorizationPolicies: [SALES_READ_POLICY], requestSchema: { params: EMPTY, query: {}, body: EMPTY }, responseSchema: { 200: QUOTATION_LIST_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.quotation = new SalesQuotationService({ database: services.require("mysqldatabase"), time: services.require("time"), logger: this.logger });
  }
  async execute(req) { return this.response(await this.quotation.list(quotationListRequest(req))); }
}
