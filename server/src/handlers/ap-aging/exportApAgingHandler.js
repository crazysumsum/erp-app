import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { agingCsv } from "../../modules/aging/agingCsv.js";
import { AGING_QUERY, AP_VIEW_POLICY, EMPTY, apInquiryService } from "../accounts-payable/apSchemas.js";

export class ExportApAgingHandler extends BaseRequestHandler {
  static handlerName = "exportApAging";
  static api = {
    method: "GET",
    path: "/api/v1/ap-aging/export",
    description: "Download today's filtered AP aging as CSV",
    authorizationPolicies: [AP_VIEW_POLICY],
    download: { enabled: true },
    requestSchema: { params: EMPTY, query: AGING_QUERY, body: EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) { super(services); this.inquiry = apInquiryService(services); }

  async execute(req) {
    const report = await this.inquiry.aging({ query: req.input.query });
    return this.file({
      buffer: Buffer.from(agingCsv(report, "supplier"), "utf8"),
      contentType: "text/csv; charset=utf-8",
      fileName: "ap-aging-" + report.asOfDate + ".csv"
    });
  }
}
