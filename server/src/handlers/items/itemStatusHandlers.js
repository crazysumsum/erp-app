import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_ACTIVATE_REQUEST_SCHEMA,
  ITEM_DETAIL_RESPONSE_SCHEMA,
  ITEM_ID_PARAMS_SCHEMA,
  ITEM_MGMT_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "./itemSchemas.js";

/**
 * Item 生命週期狀態動作：activate／deactivate／discontinue／archive／restore。
 * 設計說明見 docs/items_management/design_spec.md §4.2、§6.2、DEC-024。
 *
 * 每支動作獨立一個 endpoint（跟 categoryHandlers.js 的 CategoryStatusHandler
 * 同一個理由）：`static api.authType` 在啟動時就固定，不必由 handler 內部依
 * body 動態決定認證強度。
 */

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

class ItemStatusHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    this.itemAdmin = new ItemAdminService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  /** 子類別覆寫：呼叫 ItemAdminService 的哪一個方法。 */
  async transition(_options) {
    throw new Error(`${this.constructor.name} must implement transition()`);
  }

  async execute(req) {
    const item = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(item);
  }
}

function statusApi({ path, description, authType }) {
  return {
    method: "POST",
    path,
    description,
    ...(authType ? { authType } : {}),
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: authType === "jwt-password" ? ["reason", "version", "password"] : ["reason", "version"],
        additionalProperties: false,
        properties: {
          reason: REASON_SCHEMA,
          version: VERSION_SCHEMA,
          ...(authType === "jwt-password" ? { password: PASSWORD_SCHEMA } : {})
        }
      }
    },
    responseSchema: { 200: ITEM_DETAIL_RESPONSE_SCHEMA }
  };
}

export class ActivateItemHandler extends BaseRequestHandler {
  static handlerName = "activateItem";

  static api = {
    method: "POST",
    path: "/api/v1/items/:id/activate",
    description: "啟用指定 SKU（同交易）；Draft／Inactive Item 因而轉 Active。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_ACTIVATE_REQUEST_SCHEMA
    },
    responseSchema: { 200: ITEM_DETAIL_RESPONSE_SCHEMA }
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
    const item = await this.itemAdmin.activateItem({
      ...actorContext(req),
      id: Number(req.input.params.id),
      skuIds: req.input.body.skuIds,
      reason: req.input.body.reason,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response(item);
  }
}

export class DeactivateItemHandler extends ItemStatusHandler {
  static handlerName = "deactivateItem";
  static api = statusApi({
    path: "/api/v1/items/:id/deactivate",
    description: "停用 Item（Active → Inactive）；同交易將全部 Active SKU 轉 Inactive。"
  });

  async transition(options) {
    return this.itemAdmin.deactivateItem(options);
  }
}

export class DiscontinueItemHandler extends ItemStatusHandler {
  static handlerName = "discontinueItem";
  static api = statusApi({
    path: "/api/v1/items/:id/discontinue",
    description: "停產 Item；同交易將 Active／Inactive SKU 轉 Discontinued 並強制停止採購。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.discontinueItem(options);
  }
}

export class ArchiveItemHandler extends ItemStatusHandler {
  static handlerName = "archiveItem";
  static api = statusApi({
    path: "/api/v1/items/:id/archive",
    description: "封存 Item；同交易將非 Archived SKU 一併轉 Archived。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.archiveItem(options);
  }
}

export class RestoreItemHandler extends ItemStatusHandler {
  static handlerName = "restoreItem";
  static api = statusApi({
    path: "/api/v1/items/:id/restore",
    description: "從封存恢復；只回到 Inactive，SKU 仍為 Archived，需逐一 restore。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.restoreItem(options);
  }
}
