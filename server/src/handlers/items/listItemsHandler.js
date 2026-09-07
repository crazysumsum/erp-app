import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_LIST_QUERY_SCHEMA,
  ITEM_LIST_RESPONSE_SCHEMA,
  ITEM_VIEW_POLICY
} from "./itemSchemas.js";

export class ListItemsHandler extends BaseRequestHandler {
  static handlerName = "listItems";

  static api = {
    method: "GET",
    path: "/api/v1/items",
    description: "分頁查詢 Item，q 同時搜 Item 名稱及其任一 SKU 的 Code／名稱／條碼。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: ITEM_LIST_QUERY_SCHEMA
    },
    responseSchema: { 200: ITEM_LIST_RESPONSE_SCHEMA }
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
    const { page, pageSize, q, categoryId, brandId, status, sortBy, descending } = req.input.query;
    const result = await this.itemAdmin.listItems({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      page,
      pageSize,
      q,
      categoryId,
      brandId,
      status,
      sortBy,
      descending
    });

    return this.response(result);
  }
}
