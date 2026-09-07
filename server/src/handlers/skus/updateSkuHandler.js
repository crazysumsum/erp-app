import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  SKU_DETAIL_RESPONSE_SCHEMA,
  SKU_ID_PARAMS_SCHEMA,
  SKU_UPDATE_REQUEST_SCHEMA
} from "./skuSchemas.js";

export class UpdateSkuHandler extends BaseRequestHandler {
  static handlerName = "updateSku";

  static api = {
    method: "POST",
    path: "/api/v1/skus/:id/update",
    description:
      "整組覆蓋 SKU（除 skuCode／variantValues）連同 UOM／Barcode 完整集合；帶 version 做 compare-and-set；Base UOM／換算係數／追蹤政策變更必須帶 reason。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    requestSchema: {
      params: SKU_ID_PARAMS_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: SKU_UPDATE_REQUEST_SCHEMA
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
    const updated = await this.itemAdmin.updateSku({
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
