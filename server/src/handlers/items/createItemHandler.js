import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { ItemAdminService } from "../../modules/item/ItemAdminService.js";
import {
  EMPTY_OBJECT_SCHEMA,
  ITEM_CREATE_REQUEST_SCHEMA,
  ITEM_DETAIL_RESPONSE_SCHEMA,
  ITEM_MGMT_POLICY
} from "./itemSchemas.js";

export class CreateItemHandler extends BaseRequestHandler {
  static handlerName = "createItem";

  static api = {
    method: "POST",
    path: "/api/v1/items/create",
    description:
      "原子建立 Item＋一個 SKU（T14 只做 Standard；Variant 建檔留到 T23），activate:true 時同交易直接啟用。",
    authorizationPolicies: ITEM_MGMT_POLICY,
    // TTL 沿用 config/idempotency.js 的 defaultTtlMs（1 小時），符合
    // design_spec.md §6.1「建立 command 啟用 framework idempotency，TTL 1
    // 小時」。
    idempotency: { enabled: true },
    requestSchema: {
      params: EMPTY_OBJECT_SCHEMA,
      query: EMPTY_OBJECT_SCHEMA,
      body: ITEM_CREATE_REQUEST_SCHEMA
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
    const { item, skus, activate, activationReason } = req.input.body;

    const created = await this.itemAdmin.createItem({
      actorId: Number(req.auth.claims.sub),
      claimedRoles: req.auth.claims.roles,
      claimedPermissions: req.auth.claims.permissions,
      item,
      skus,
      activate,
      activationReason,
      requestId: req.requestId,
      ip: req.ip || req.socket?.remoteAddress || ""
    });

    return this.response(created, { statusCode: 201 });
  }
}
