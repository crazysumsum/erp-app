import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAuditLogService } from "../../modules/item/ItemAuditLogService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_AUDIT_LOG_LIST_RESPONSE_SCHEMA,
  ITEM_AUDIT_LOG_POLICY,
  ITEM_AUDIT_LOG_QUERY_SCHEMA
} from "./itemAuditSchemas.js";

export class ListItemAuditLogsHandler extends BaseRequestHandler {
  static handlerName = "listItemAuditLogs";

  static api = {
    method: "GET",
    path: "/api/v1/item-audit/logs",
    description: "分頁查詢商品管理的變更紀錄，可依時間範圍、操作者、對象、動作與對象種類篩選。",
    authorizationPolicies: ITEM_AUDIT_LOG_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: ITEM_AUDIT_LOG_QUERY_SCHEMA
    },
    responseSchema: { 200: ITEM_AUDIT_LOG_LIST_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemAuditLog = new ItemAuditLogService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { page, pageSize, from, to, actor, target, action, targetType } = req.input.query;
    const result = await this.itemAuditLog.list({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      page,
      pageSize,
      from,
      to,
      actor,
      target,
      action,
      targetType
    });

    return this.response(result);
  }
}
