import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_EMPTY, CUSTOMER_IMPORT_LIST_QUERY, CUSTOMER_IMPORT_LIST_RESPONSE } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class ListCustomerImportsHandler extends BaseRequestHandler {
  static handlerName = "listCustomerImports";
  static api = {
    method: "GET", path: "/api/v1/customer-imports", description: "列出 Customer 匯入工作。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage],
    requestSchema: { params: CUSTOMER_IMPORT_EMPTY, query: CUSTOMER_IMPORT_LIST_QUERY },
    responseSchema: { 200: CUSTOMER_IMPORT_LIST_RESPONSE }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req) { return this.response(await requireCustomerImport(this.customerImport).list({ ...customerImportActor(req), ...req.input.query })); }
}
