import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { CUSTOMER_EXPORT_CREATE_BODY, CUSTOMER_EXPORT_EMPTY, CUSTOMER_EXPORT_ID_PARAMS, CUSTOMER_EXPORT_JOB } from "./customerExportSchemas.js";
import { customerExportActor, customerExportService, requireCustomerExport } from "./customerExportSupport.js";

export class CreateCustomerExportHandler extends BaseRequestHandler {
  static handlerName = "createCustomerExport";
  static api = {
    method: "POST", path: "/api/v1/customer-exports/create", authType: "jwt-password",
    description: "依目前 Customer 篩選條件建立安全 CSV 匯出。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], idempotency: { enabled: true },
    requestSchema: { params: CUSTOMER_EXPORT_EMPTY, query: CUSTOMER_EXPORT_EMPTY, body: CUSTOMER_EXPORT_CREATE_BODY },
    responseSchema: { 201: CUSTOMER_EXPORT_JOB }
  };
  constructor(services = {}) { super(services); this.customerExport = customerExportService(services); }
  async execute(req) {
    return this.response(await requireCustomerExport(this.customerExport).create({
      ...customerExportActor(req), idempotencyKey: req.get("Idempotency-Key"), filters: req.input.body.filters,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    }), { statusCode: 201 });
  }
}

export class GetCustomerExportHandler extends BaseRequestHandler {
  static handlerName = "getCustomerExport";
  static api = {
    method: "GET", path: "/api/v1/customer-exports/:id", description: "取得本人建立的 Customer 匯出工作。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage],
    requestSchema: { params: CUSTOMER_EXPORT_ID_PARAMS, query: CUSTOMER_EXPORT_EMPTY }, responseSchema: { 200: CUSTOMER_EXPORT_JOB }
  };
  constructor(services = {}) { super(services); this.customerExport = customerExportService(services); }
  async execute(req) {
    return this.response(await requireCustomerExport(this.customerExport).get({ ...customerExportActor(req), id: req.input.params.id }));
  }
}

export class DownloadCustomerExportHandler extends BaseRequestHandler {
  static handlerName = "downloadCustomerExport";
  static api = {
    method: "GET", path: "/api/v1/customer-exports/:id/result", description: "下載本人未過期的 Customer 匯出 CSV。",
    authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalManage], download: { enabled: true },
    requestSchema: { params: CUSTOMER_EXPORT_ID_PARAMS, query: CUSTOMER_EXPORT_EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };
  constructor(services = {}) { super(services); this.customerExport = customerExportService(services); }
  async execute(req, res) {
    const result = await requireCustomerExport(this.customerExport).download({
      ...customerExportActor(req), id: req.input.params.id,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    });
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache");
    return this.file({ ...result, contentType: "text/csv; charset=utf-8" });
  }
}
