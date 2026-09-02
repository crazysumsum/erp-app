import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AuditLogService } from "../../modules/audit/AuditLogService.js";
import {
  AUDIT_LOG_LIST_RESPONSE_SCHEMA,
  AUDIT_LOG_POLICY,
  AUDIT_LOG_QUERY_SCHEMA,
  EMPTY_OBJECT_SCHEMA
} from "./auditSchemas.js";

export class ListAuditLogsHandler extends BaseRequestHandler {
  static handlerName = "listAuditLogs";

  static api = {
    method: "GET",
    path: "/api/v1/audit/logs",
    description: "分頁查詢用戶與角色管理的變更紀錄，可依時間範圍、操作者、對象與動作篩選。",
    authorizationPolicies: AUDIT_LOG_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: AUDIT_LOG_QUERY_SCHEMA
    },
    responseSchema: { 200: AUDIT_LOG_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.auditLog = new AuditLogService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { page, pageSize, from, to, actor, target, action } = req.input.query;
    const result = await this.auditLog.list({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      page,
      pageSize,
      from,
      to,
      actor,
      target,
      action
    });

    return this.response(result);
  }
}
