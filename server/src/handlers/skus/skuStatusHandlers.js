import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  SKU_DETAIL_RESPONSE_SCHEMA,
  SKU_ID_PARAMS_SCHEMA,
  VERSION_SCHEMA
} from "./skuSchemas.js";

/**
 * SKU 生命週期狀態動作：activate／deactivate／discontinue／archive／restore。
 * 設計說明見 docs/items_management/design_spec.md §4.2、§6.3。
 *
 * 跟 itemStatusHandlers.js／categoryHandlers.js 同一個模式：每支動作獨立一個
 * endpoint，`static api.authType` 在啟動時就固定。
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

class SkuStatusHandler extends BaseRequestHandler {
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
    const sku = await this.transition({
      ...actorContext(req),
      id: Number(req.input.params.id),
      version: req.input.body.version,
      reason: req.input.body.reason,
      ...requestMeta(req)
    });

    return this.response(sku);
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
      params: SKU_ID_PARAMS_SCHEMA,
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
    responseSchema: { 200: SKU_DETAIL_RESPONSE_SCHEMA }
  };
}

export class ActivateSkuHandler extends SkuStatusHandler {
  static handlerName = "activateSku";
  static api = statusApi({
    path: "/api/v1/skus/:id/activate",
    description: "啟用 SKU（Draft／Inactive → Active）；父 Item 必須已經 Active。"
  });

  async transition(options) {
    return this.itemAdmin.activateSku(options);
  }
}

export class DeactivateSkuHandler extends SkuStatusHandler {
  static handlerName = "deactivateSku";
  static api = statusApi({
    path: "/api/v1/skus/:id/deactivate",
    description: "停用 SKU（Active → Inactive）；不可停用父 Item 最後一個 Active SKU。"
  });

  async transition(options) {
    return this.itemAdmin.deactivateSku(options);
  }
}

export class DiscontinueSkuHandler extends SkuStatusHandler {
  static handlerName = "discontinueSku";
  static api = statusApi({
    path: "/api/v1/skus/:id/discontinue",
    description: "停產 SKU；強制停止採購，sellable 保留現狀清貨。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.discontinueSku(options);
  }
}

export class ArchiveSkuHandler extends SkuStatusHandler {
  static handlerName = "archiveSku";
  static api = statusApi({
    path: "/api/v1/skus/:id/archive",
    description: "封存 SKU。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.archiveSku(options);
  }
}

export class RestoreSkuHandler extends SkuStatusHandler {
  static handlerName = "restoreSku";
  static api = statusApi({
    path: "/api/v1/skus/:id/restore",
    description: "從封存恢復；只回到 Inactive。",
    authType: "jwt-password"
  });

  async transition(options) {
    return this.itemAdmin.restoreSku(options);
  }
}
