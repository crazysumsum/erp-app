import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { actorInput, adminService } from "./handlerSupport.js";
import { AUDIT_LIST, EMPTY, VIEW_POLICY, listInput } from "./businessMasterSchemas.js";

const AUDIT_QUERY = Object.freeze({ type: "object", additionalProperties: false, properties: { entityType: { type: "string", enum: ["CURRENCY", "PAYMENT_TERM"] }, entityKey: { type: "string", maxLength: 80 }, action: { type: "string", maxLength: 50 }, actorUserId: { type: "string", pattern: "^[1-9][0-9]*$" }, from: { type: "string", pattern: "^[0-9]+$" }, to: { type: "string", pattern: "^[0-9]+$" }, page: { type: "string", pattern: "^[1-9][0-9]*$" }, pageSize: { type: "string", enum: ["10", "20", "50", "100"] } } });

export class ListBusinessMasterAuditHandler extends BaseRequestHandler {
  static handlerName = "listBusinessMasterAudit";
  static api = { method: "GET", path: "/api/v1/business-master/audit", description: "List Business Master audit entries.", authorizationPolicies: VIEW_POLICY, requestSchema: { params: EMPTY, query: AUDIT_QUERY }, responseSchema: { 200: AUDIT_LIST } };
  constructor(services = {}) { super(services); this.admin = adminService(services); }
  async execute(req) {
    const query = req.input.query ?? {};
    return this.response(await this.admin.listAudit({ ...actorInput(req), ...listInput(query), entityType: query.entityType, entityKey: query.entityKey, action: query.action, actorUserId: query.actorUserId ? Number(query.actorUserId) : undefined, from: query.from ? Number(query.from) : undefined, to: query.to ? Number(query.to) : undefined }));
  }
}
