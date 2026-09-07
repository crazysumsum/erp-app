import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import { EMPTY_OBJECT_SCHEMA, ITEM_VIEW_POLICY, SKU_DETAIL_RESPONSE_SCHEMA, SKU_ID_PARAMS_SCHEMA } from "./skuSchemas.js";

export class GetSkuHandler extends BaseRequestHandler {
  static handlerName = "getSku";

  static api = {
    method: "GET",
    path: "/api/v1/skus/:id",
    description: "回單一 SKU 詳情，含 Item 摘要、UOM、條碼、價格口徑與 version。",
    authorizationPolicies: ITEM_VIEW_POLICY,
    requestSchema: {
      params: SKU_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA
    },
    responseSchema: { 200: SKU_DETAIL_RESPONSE_SCHEMA }
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
    const sku = await this.itemAdmin.getSku({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      id: Number(req.input.params.id)
    });

    return this.response(sku);
  }
}
