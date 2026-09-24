import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_DETAIL_RESPONSE, CUSTOMER_IMPORT_GET_QUERY, CUSTOMER_IMPORT_ID_PARAMS } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class GetCustomerImportHandler extends BaseRequestHandler {
  static handlerName = "getCustomerImport";
  static api = {
    method: "GET", path: "/api/v1/customer-imports/:id", description: "取得 Customer 匯入預檢結果。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage],
    requestSchema: { params: CUSTOMER_IMPORT_ID_PARAMS, query: CUSTOMER_IMPORT_GET_QUERY },
    responseSchema: { 200: CUSTOMER_IMPORT_DETAIL_RESPONSE }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req) { return this.response(await requireCustomerImport(this.customerImport).get({ ...customerImportActor(req), id: req.input.params.id, ...req.input.query })); }
}
