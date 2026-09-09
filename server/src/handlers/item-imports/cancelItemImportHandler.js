import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemImportService } from "../../modules/item/ItemImportService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  IMPORT_ID_PARAMS_SCHEMA,
  IMPORT_JOB_SUMMARY_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemImportSchemas.js";

function actorContext(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

/**
 * 取消一個匯入工作。淨係 `uploaded／ready／queued` 可以取消——`validating／
 * running` 代表 worker 正在處理緊，冇安全嘅方式喺中途打斷。設計說明見
 * docs/items_management/design_spec.md §6.9。冇用 `jwt-password`：取消係
 * 一個保守、可逆嘅動作（未曾套用任何商品變更），唔屬於高風險範圍。
 */
export class CancelItemImportHandler extends BaseRequestHandler {
  static handlerName = "cancelItemImport";

  static api = {
    method: "POST",
    path: "/api/v1/item-imports/:id/cancel",
    description: "取消一個未執行嘅匯入工作。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: IMPORT_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: EMPTY_OBJECT_SCHEMA
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
    const job = await this.importService.cancelJob({
      ...actorContext(req),
      id: Number(req.input.params.id)
    });

    return this.response(job);
  }
}
