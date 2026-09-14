import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_MGMT_POLICY,
  SKU_CREATE_REQUEST_SCHEMA,
  SKU_DETAIL_RESPONSE_SCHEMA
} from "./skuSchemas.js";

export class CreateSkuHandler extends BaseRequestHandler {
  static handlerName = "createSku";

  static api = {
    method: "POST",
    path: "/api/v1/skus/create",
    description: "為既有多規格商品原子新增一個 Draft SKU，包含 UOM、條碼與規格組合。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    idempotency: { enabled: true },
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: SKU_CREATE_REQUEST_SCHEMA
    },
    responseSchema: { 201: SKU_DETAIL_RESPONSE_SCHEMA }
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
    const created = await this.itemAdmin.createSku({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      ...req.input.body,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });

    return this.response(created, { statusCode: 201 });
  }
}
