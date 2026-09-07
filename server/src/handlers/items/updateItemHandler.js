import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_DETAIL_RESPONSE_SCHEMA,
  ITEM_ID_PARAMS_SCHEMA,
  ITEM_MGMT_POLICY,
  ITEM_UPDATE_REQUEST_SCHEMA
} from "./itemSchemas.js";

export class UpdateItemHandler extends BaseRequestHandler {
  static handlerName = "updateItem";

  static api = {
    method: "POST",
    path: "/api/v1/items/:id/update",
    description: "整組覆蓋 Item 層欄位；帶 version 做 compare-and-set。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_UPDATE_REQUEST_SCHEMA
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
    const updated = await this.itemAdmin.updateItem({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id),
      ...req.input.body,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });

    return this.response(updated);
  }
}
