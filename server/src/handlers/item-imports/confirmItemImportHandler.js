import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  IMPORT_ID_PARAMS_SCHEMA,
  IMPORT_JOB_SUMMARY_SCHEMA,
  ITEM_IMPORT_CONFIRM_BODY_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemImportSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function requestMeta(req) {
  return {
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

/**
 * 確認一個 `ready` 嘅 Import Job，轉做 `queued`，等執行 worker 接手。設計
 * 說明見 docs/items_management/design_spec.md §6.9。`jwt-password`：確認
 * 之後最多可以一次過影響 10,000 筆商品資料，屬於高風險操作。
 */
export class ConfirmItemImportHandler extends BaseRequestHandler {
  static handlerName = "confirmItemImport";

  static api = {
    method: "POST",
    path: "/api/v1/item-imports/:id/confirm",
    description: "確認一個 ready 嘅匯入工作，轉入執行佇列。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: IMPORT_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_IMPORT_CONFIRM_BODY_SCHEMA
    },
    responseSchema: { 200: IMPORT_JOB_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.importService = new ItemImportService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const job = await this.importService.confirmJob({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(job);
  }
}
