import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_VIEW_POLICY,
  SKU_LIST_QUERY_SCHEMA,
  SKU_LIST_RESPONSE_SCHEMA
} from "./skuSchemas.js";

export class ListSkusHandler extends BaseRequestHandler {
  static handlerName = "listSkus";

  static api = {
    method: "GET",
    path: "/api/v1/skus",
    description: "SKU 平鋪分頁查詢，q 搜 Code、條碼、Item／SKU 名稱，完全相符優先於前綴、前綴優先於 contains。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: SKU_LIST_QUERY_SCHEMA
    },
    responseSchema: { 200: SKU_LIST_RESPONSE_SCHEMA }
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
    const {
      page,
      pageSize,
      q,
      itemId,
      categoryId,
      brandId,
      status,
      includeArchived,
      purchasable,
      sellable,
      sortBy,
      descending
    } = req.input.query;
    const result = await this.itemAdmin.listSkus({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      page,
      pageSize,
      q,
      itemId,
      categoryId,
      brandId,
      status,
      includeArchived,
      purchasable,
      sellable,
      sortBy,
      descending
    });

    return this.response(result);
  }
}
