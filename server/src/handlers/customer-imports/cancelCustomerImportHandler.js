import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_CANCEL_BODY, CUSTOMER_IMPORT_EMPTY, CUSTOMER_IMPORT_ID_PARAMS, CUSTOMER_IMPORT_JOB } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class CancelCustomerImportHandler extends BaseRequestHandler {
  static handlerName = "cancelCustomerImport";
  static api = {
    method: "POST", path: "/api/v1/customer-imports/:id/cancel", description: "取消尚未執行的 Customer 匯入。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: { enabled: true },
    requestSchema: { params: CUSTOMER_IMPORT_ID_PARAMS, query: CUSTOMER_IMPORT_EMPTY, body: CUSTOMER_IMPORT_CANCEL_BODY },
    responseSchema: { 200: CUSTOMER_IMPORT_JOB }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req) {
    return this.response(await requireCustomerImport(this.customerImport).cancel({
      ...customerImportActor(req), id: req.input.params.id, version: req.input.body.version,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}
