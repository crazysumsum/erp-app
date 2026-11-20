import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AGING_QUERY, AGING_RESPONSE, AR_VIEW_POLICY, EMPTY, arInquiryService } from "../ar/arSchemas.js";

/** 帳齡表：今日的未收額，按客戶及幣別分桶。 */
export class GetArAgingHandler extends BaseRequestHandler {
  static handlerName = "getArAging";
  static api = { method: "GET", path: "/api/v1/ar-aging", description: "Read today's AR aging by customer and currency", authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: EMPTY, query: AGING_QUERY, body: EMPTY }, responseSchema: { 200: AGING_RESPONSE } };
  constructor(services = {}) { super(services); this.inquiry = arInquiryService(services); }
  async execute(req) { return this.response(await this.inquiry.aging({ query: req.input.query })); }
}
