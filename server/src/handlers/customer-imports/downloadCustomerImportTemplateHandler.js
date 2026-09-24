import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { buildCustomerImportTemplate, CUSTOMER_IMPORT_TEMPLATE_VERSION } from "../../modules/customer/import/customerCsvSchema.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_EMPTY } from "./customerImportSchemas.js";

export class DownloadCustomerImportTemplateHandler extends BaseRequestHandler {
  static handlerName = "downloadCustomerImportTemplate";
  static api = {
    method: "GET", path: "/api/v1/customer-imports/template", description: "下載 Customer 匯入 CSV v1 template。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], download: { enabled: true },
    requestSchema: { params: CUSTOMER_IMPORT_EMPTY, query: CUSTOMER_IMPORT_EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };
  async execute(_req, res) {
    res.setHeader("X-Customer-Import-Template-Version", CUSTOMER_IMPORT_TEMPLATE_VERSION);
    res.setHeader("Pragma", "no-cache");
    return this.file({
      buffer: Buffer.from(buildCustomerImportTemplate(), "utf8"),
      fileName: `customer-import-template-${CUSTOMER_IMPORT_TEMPLATE_VERSION}.csv`, contentType: "text/csv; charset=utf-8"
    });
  }
}
