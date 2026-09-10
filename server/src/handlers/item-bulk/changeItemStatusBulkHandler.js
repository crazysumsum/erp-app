import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "../items/itemSchemas.js";

const BULK_STATUS_ACTIONS = Object.freeze(["activate", "deactivate", "discontinue", "archive", "restore"]);

const BULK_TARGET_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    version: VERSION_SCHEMA
  }
});

const BULK_STATUS_CHANGE_BODY_SCHEMA = Object.freeze({
  type: "object",
  required: ["targetType", "action", "targets", "reason", "password"],
  additionalProperties: false,
  properties: {
    targetType: { type: "string", enum: ["item", "sku"] },
    action: { type: "string", enum: [...BULK_STATUS_ACTIONS] },
    // 1–100：design_spec §6.4 明確嘅上限，避免一個交易鎖太多 row 太耐。
    targets: { type: "array", minItems: 1, maxItems: 100, items: BULK_TARGET_SCHEMA },
    reason: REASON_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

const BULK_STATUS_CHANGE_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["results"],
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status"],
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
          status: { type: "string" }
        }
      }
    }
  }
});

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
 * 最多 100 筆 Item／SKU 的全有全無批量狀態變更。設計說明見
 * docs/items_management/design_spec.md §6.4、§8.1。`jwt-password`：一次
 * 可以影響 100 筆資料，屬於高風險操作，同單筆 discontinue／archive／restore
 * 一致。實際邏輯全部重用單筆狀態方法抽出嚟嘅 private helper，見
 * `ItemAdminService.bulkChangeStatus()` 的說明。
 */
export class ChangeItemStatusBulkHandler extends BaseRequestHandler {
  static handlerName = "changeItemStatusBulk";

  static api = {
    method: "POST",
    path: "/api/v1/item-bulk/status/change",
    description: "最多 100 筆 Item／SKU 的全有全無批量狀態變更。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: BULK_STATUS_CHANGE_BODY_SCHEMA
    },
    responseSchema: { 200: BULK_STATUS_CHANGE_RESPONSE_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const results = await this.itemAdmin.bulkChangeStatus({
      ...actorContext(req),
      targetType: req.input.body.targetType,
      action: req.input.body.action,
      targets: req.input.body.targets,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response({ results });
  }
}
