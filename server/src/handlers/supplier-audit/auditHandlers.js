import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierAuditLogService } from "../../modules/supplier/SupplierAuditLogService.js";

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const POLICY = Object.freeze([Object.freeze({ name: "hasPermission", options: Object.freeze({ permissions: Object.freeze(["supplier.view"]) }) })]);
const QUERY = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 },
    actor: { type: "string", maxLength: 190, default: "" }, target: { type: "string", maxLength: 190, default: "" },
    action: { type: "string", maxLength: 80 }, targetType: { type: "string", maxLength: 30 },
    supplierId: { type: "integer", minimum: 1 }
  }
});
const ENTRY = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["id", "occurredAt", "actorUserId", "actorUsername", "action", "targetType", "targetId", "supplierId", "targetLabel", "reason", "detail", "requestId", "ip"],
  properties: {
    id: { type: "integer" }, occurredAt: { type: "integer" }, actorUserId: { type: ["integer", "null"] }, actorUsername: { type: "string" },
    action: { type: "string" }, targetType: { type: "string" }, targetId: { type: ["integer", "null"] }, supplierId: { type: ["integer", "null"] },
    targetLabel: { type: "string" }, reason: { type: "string" }, detail: { type: ["object", "null"], additionalProperties: true },
    requestId: { type: "string" }, ip: { type: "string" }
  }
});
const RESPONSE = Object.freeze({
  type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"],
  properties: { items: { type: "array", items: ENTRY }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } }
});

export class ListSupplierAuditLogsHandler extends BaseRequestHandler {
  static handlerName = "listSupplierAuditLogs";
  static api = {
    method: "GET", path: "/api/v1/supplier-audit/logs", description: "查詢供應商變更紀錄。",
    authorizationPolicies: POLICY, requestSchema: { params: EMPTY, query: QUERY }, responseSchema: { 200: RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.audit = new SupplierAuditLogService({
      database: services.require("mysqldatabase"), logger: services.require("logging").logger, time: services.require("time")
    });
  }

  async execute(req) {
    return this.response(await this.audit.list({
      ...req.input.query,
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions
    }));
  }
}
