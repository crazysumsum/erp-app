import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { agingCsv } from "../../modules/aging/agingCsv.js";
import { AGING_QUERY, AR_VIEW_POLICY, EMPTY, arInquiryService } from "../ar/arSchemas.js";

export class ExportArAgingHandler extends BaseRequestHandler {
  static handlerName = "exportArAging";
  static api = {
    method: "GET",
    path: "/api/v1/ar-aging/export",
    description: "Download today's filtered AR aging as CSV",
    authorizationPolicies: [AR_VIEW_POLICY],
    download: { enabled: true },
    requestSchema: { params: EMPTY, query: AGING_QUERY, body: EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) { super(services); this.inquiry = arInquiryService(services); }

  async execute(req) {
    const report = await this.inquiry.aging({ query: req.input.query });
    return this.file({
      buffer: Buffer.from(agingCsv(report, "customer"), "utf8"),
      contentType: "text/csv; charset=utf-8",
      fileName: "ar-aging-" + report.asOfDate + ".csv"
    });
  }
}
