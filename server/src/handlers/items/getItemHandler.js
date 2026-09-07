import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_DETAIL_RESPONSE_SCHEMA, ITEM_ID_PARAMS_SCHEMA, ITEM_VIEW_POLICY } from "./itemSchemas.js";

export class GetItemHandler extends BaseRequestHandler {
  static handlerName = "getItem";

  static api = {
    method: "GET",
    path: "/api/v1/items/:id",
    description: "回單一 Item 詳情，含全部 SKU 摘要與 version。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: ITEM_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
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
    const item = await this.itemAdmin.getItem({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id)
    });

    return this.response(item);
  }
}
