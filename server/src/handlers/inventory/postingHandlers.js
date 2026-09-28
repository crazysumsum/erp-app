import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { InventoryPostingService } from "../../modules/inventory/InventoryPostingService.js";
import {
  EMPTY,
  OPERATION_POLICY,
  RECEIPT_CREATE,
  RECEIPT_RESPONSE
} from "./inventorySchemas.js";

export class PostInventoryReceiptHandler extends BaseRequestHandler {
  static handlerName = "postInventoryReceipt";
  static api = {
    method: "POST",
    path: "/api/v1/inventory/receipts",
    description: "以正式來源原子過帳庫存收貨。",
    authorizationPolicies: OPERATION_POLICY,
    idempotency: Object.freeze({ enabled: true }),
    requestSchema: { params: EMPTY, query: EMPTY, body: RECEIPT_CREATE },
    responseSchema: { 200: RECEIPT_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.inventory = new InventoryPostingService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time")
    });
  }

  async execute(req) {
    const { source, ...payload } = req.input.body;
    return this.response(await this.inventory.postReceipt({
      actor: {
        userId: Number(req.auth.claims.sub),
        serviceName: "",
        claimedRoles: req.auth.claims.roles,
        claimedPermissions: req.auth.claims.permissions
      },
      authorization: { purpose: "receipt.post", requiredCallerPermission: "inventory.operation" },
      source,
      correlationId: req.requestId ?? "",
      payload
    }));
  }
}
