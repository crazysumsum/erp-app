import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemMediaService } from "../../modules/item/ItemMediaService.js";
import { EMPTY_OBJECT_SCHEMA } from "../items/itemSchemas.js";
import {
  ITEM_MEDIA_UPDATE_BODY_SCHEMA,
  ITEM_MGMT_POLICY,
  MEDIA_ID_PARAMS_SCHEMA,
  MEDIA_SUMMARY_SCHEMA
} from "./itemMediaSchemas.js";

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
 * 改 media 的 display name／sort order／primary。設計說明見
 * docs/items_management/design_spec.md §6.6、§8.5。
 */
export class UpdateItemMediaHandler extends BaseRequestHandler {
  static handlerName = "updateItemMedia";

  static api = {
    method: "POST",
    path: "/api/v1/item-media/:id/update",
    description: "改 media 的 display name、sort order 或 primary。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: MEDIA_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_MEDIA_UPDATE_BODY_SCHEMA
    },
    responseSchema: { 200: MEDIA_SUMMARY_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.itemMedia = new ItemMediaService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      imageMaxBytes: services.config.item.imageMaxBytes,
      attachmentMaxBytes: services.config.item.attachmentMaxBytes
    });
  }

  async execute(req) {
    const id = Number(req.input.params.id);
    const summary = await this.itemMedia.update({
      ...actorContext(req),
      id,
      displayName: req.input.body.displayName,
      sortOrder: req.input.body.sortOrder,
      isPrimary: req.input.body.isPrimary,
      ...requestMeta(req)
    });

    return this.response(summary);
  }
}
