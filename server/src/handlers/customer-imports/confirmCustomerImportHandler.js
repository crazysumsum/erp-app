import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_IMPORT_CONFIRM_BODY, CUSTOMER_IMPORT_EMPTY, CUSTOMER_IMPORT_ID_PARAMS, CUSTOMER_IMPORT_JOB } from "./customerImportSchemas.js";
import { customerImportActor, customerImportService, requireCustomerImport } from "./customerImportSupport.js";

export class ConfirmCustomerImportHandler extends BaseRequestHandler {
  static handlerName = "confirmCustomerImport";
  static api = {
    method: "POST", path: "/api/v1/customer-imports/:id/confirm", authType: "jwt-password",
    description: "確認並排程 Customer 匯入。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage],
    idempotency: { enabled: true }, requestSchema: { params: CUSTOMER_IMPORT_ID_PARAMS, query: CUSTOMER_IMPORT_EMPTY, body: CUSTOMER_IMPORT_CONFIRM_BODY },
    responseSchema: { 200: CUSTOMER_IMPORT_JOB }
  };
  constructor(services = {}) { super(services); this.customerImport = customerImportService(services); }
  async execute(req) {
    return this.response(await requireCustomerImport(this.customerImport).confirm({
      ...customerImportActor(req), id: req.input.params.id, ...req.input.body,
      idempotencyKey: req.get("Idempotency-Key"),
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    }));
  }
}
