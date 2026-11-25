import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AP_VIEW_POLICY, EMPTY, INVOICED_RECEIPTS_QUERY, INVOICED_RECEIPTS_RESPONSE, apInquiryService } from "../accounts-payable/apSchemas.js";

export class ListApInvoicedReceiptsHandler extends BaseRequestHandler {
  static handlerName = "listApInvoicedReceipts";
  static api = {
    method: "GET", path: "/api/v1/ap-invoiced-receipts", description: "Find goods receipts reserved by active AP invoices",
    authorizationPolicies: [AP_VIEW_POLICY], requestSchema: { params: EMPTY, query: INVOICED_RECEIPTS_QUERY, body: EMPTY },
    responseSchema: { 200: INVOICED_RECEIPTS_RESPONSE }
  };
  constructor(services = {}) { super(services); this.inquiry = apInquiryService(services); }
  async execute(req) { return this.response(await this.inquiry.invoicedReceipts(req.input.query)); }
}
