import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AGING_QUERY, AGING_RESPONSE, AP_VIEW_POLICY, EMPTY, apInquiryService } from "../accounts-payable/apSchemas.js";

/** 帳齡表：今日的未付額，按供應商及幣別分桶。 */
export class GetApAgingHandler extends BaseRequestHandler {
  static handlerName = "getApAging";
  static api = { method: "GET", path: "/api/v1/ap-aging", description: "Read today's AP aging by supplier and currency", authorizationPolicies: [AP_VIEW_POLICY],
    requestSchema: { params: EMPTY, query: AGING_QUERY, body: EMPTY }, responseSchema: { 200: AGING_RESPONSE } };
  constructor(services = {}) { super(services); this.inquiry = apInquiryService(services); }
  async execute(req) { return this.response(await this.inquiry.aging({ query: req.input.query })); }
}
