import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_EMPTY, CUSTOMER_IMPORT_ID_PARAMS } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class DownloadCustomerImportResultHandler extends BaseRequestHandler {
  static handlerName = "downloadCustomerImportResult";
  static api = {
    method: "GET", path: "/api/v1/customer-imports/:id/result", description: "下載 Customer 匯入安全結果 CSV。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], download: { enabled: true },
    requestSchema: { params: CUSTOMER_IMPORT_ID_PARAMS, query: CUSTOMER_IMPORT_EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req, res) {
    const result = await requireCustomerImport(this.customerImport).downloadResult({
      ...customerImportActor(req), id: req.input.params.id,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return this.file({ ...result, contentType: "text/csv; charset=utf-8" });
  }
}
