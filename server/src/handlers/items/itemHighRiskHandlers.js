import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_COPY_REQUEST_SCHEMA,
  ITEM_DELETE_RESULT_SCHEMA,
  ITEM_DETAIL_RESPONSE_SCHEMA,
  ITEM_ID_PARAMS_SCHEMA,
  ITEM_MGMT_POLICY,
  PASSWORD_SCHEMA,
  REASON_SCHEMA,
  VERSION_SCHEMA
} from "./itemSchemas.js";

/**
 * Item 嘅高風險／一次性操作：永久刪除、複製。設計說明見
 * docs/items_management/design_spec.md §6.2。
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

export class DeleteItemHandler extends BaseRequestHandler {
  static handlerName = "deleteItem";

  static api = {
    method: "POST",
    path: "/api/v1/items/:id/delete",
    description: "永久刪除 Draft Item 連同其 Draft children；不可復原。",
    authType: "jwt-password",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: {
        type: "object",
        required: ["reason", "version", "password"],
        additionalProperties: false,
        properties: {
          reason: REASON_SCHEMA,
          version: VERSION_SCHEMA,
          password: PASSWORD_SCHEMA
        }
      }
    },
    responseSchema: { 200: ITEM_DELETE_RESULT_SCHEMA }
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
    const id = Number(req.input.params.id);
    await this.itemAdmin.deleteItem({
      ...actorContext(req),
      id,
      reason: req.input.body.reason,
      version: req.input.body.version,
      ...requestMeta(req)
    });

    return this.response({ id });
  }
}

export class CopyItemHandler extends BaseRequestHandler {
  static handlerName = "copyItem";

  static api = {
    method: "POST",
    path: "/api/v1/items/:id/copy",
    description: "複製成新的 Draft Item；不複製 Barcode，每個來源 SKU 需提供新 Code。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    idempotency: { enabled: true },
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_COPY_REQUEST_SCHEMA
    },
    responseSchema: { 201: ITEM_DETAIL_RESPONSE_SCHEMA }
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
    const copy = await this.itemAdmin.copyItem({
      ...actorContext(req),
      id: Number(req.input.params.id),
      skus: req.input.body.skus,
      ...requestMeta(req)
    });

    return this.response(copy, { statusCode: 201 });
  }
}
