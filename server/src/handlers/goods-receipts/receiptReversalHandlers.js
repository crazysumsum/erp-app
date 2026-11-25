import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { hasActiveGoodsReceiptInvoiceInTransaction } from "../../modules/accounts-payable/hasActiveGoodsReceiptInvoiceInTransaction.js";
import { issuePurchaseReversalContext } from "../../modules/inventory/InventoryPurchaseContext.js";
import { InventoryPostingService } from "../../modules/inventory/InventoryPostingService.js";
import { normalizePurchasingConfig } from "../../modules/purchasing/normalizePurchasingConfig.js";
import { PurchasingAuditService } from "../../modules/purchasing/PurchasingAuditService.js";
import { PurchasingOperationService } from "../../modules/purchasing/PurchasingOperationService.js";
import { purchasingError } from "../../modules/purchasing/purchasingErrors.js";
import { ReceiptReversalService } from "../../modules/purchasing/ReceiptReversalService.js";
import { readPostedSupplierReturnQuantitiesInTransaction } from "../../modules/returns/readPostedSupplierReturnQuantitiesInTransaction.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import { GOODS_RECEIPT_CONFIRM_PARAMS } from "../purchasing/receivingSchemas.js";

const path = "/api/v1/goods-receipts/:id/reversals";
const policy = [{ name: "hasPermission", options: { permissions: ["purchasing.view", "inventory.adjust"] } }];
const id = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const shape = properties => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties });
const input = shape({
  eventId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
  version: id,
  reason: { type: "string", minLength: 5, maxLength: 500 },
  password: { type: "string", minLength: 1, maxLength: 1024 },
  details: { type: "array", minItems: 1, maxItems: 200, items: shape({ goodsReceiptDetailId: id, baseQuantity: id }) }
});

class ReceiptReversalHandler extends BaseRequestHandler {
  constructor(services) {
    super(services);
    const database = services.require("mysqldatabase"), time = services.require("time");
    const jwt = services.require("jwt"), device = services.require("deviceBinding");
    const { auditDetailMaxBytes } = normalizePurchasingConfig(services.config.purchasing);
    const inventory = new InventoryPostingService({ database, time, logger: this.logger });
    const auth = { database, time, sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds,
      signatureMaxSkewSeconds: device.config.deviceBinding.signatureMaxSkewSeconds };
    this.reversals = new ReceiptReversalService({
      database, time, logger: this.logger, audit: new PurchasingAuditService({ auditDetailMaxBytes }), operations: new PurchasingOperationService(),
      hasActiveInvoice: hasActiveGoodsReceiptInvoiceInTransaction, readReturnedQuantities: readPostedSupplierReturnQuantitiesInTransaction,
      postInventory(tx, req, command, ownerProof) {
        command.context = issuePurchaseReversalContext(req, tx, command, { ...auth, ownerProof });
        return inventory.reversePurchaseReceiptBatchInTransaction(tx, command);
      }
    });
  }
}

export class PreviewGoodsReceiptReversalHandler extends ReceiptReversalHandler {
  static handlerName = "previewGoodsReceiptReversal";
  static api = {
    method: "GET", path: `${path}/preview`, description: "Read receipt correction quantities", authorizationPolicies: policy,
    requestSchema: { params: GOODS_RECEIPT_CONFIRM_PARAMS, query: EMPTY, body: EMPTY },
    responseSchema: { 200: shape({ version: id, details: { type: "array", items: shape({ id, remainingBaseQuantity: { type: "string", pattern: "^[0-9]+$" } }) } }) }
  };

  async execute(req) {
    return this.response(await this.reversals.preview({ id: Number(req.input.params.id), claims: req.auth.claims }));
  }
}

export class ReverseGoodsReceiptHandler extends ReceiptReversalHandler {
  static handlerName = "reverseGoodsReceipt";
  static api = {
    method: "POST", path: `${path}/create`, description: "Post partial or full receipt correction", authType: "jwt-device-password",
    authorizationPolicies: policy, inputCoercion: false, idempotencyPreparation: true, idempotency: { enabled: true },
    requestSchema: { params: GOODS_RECEIPT_CONFIRM_PARAMS, query: EMPTY, body: input },
    responseSchema: { 200: shape({ id, number: { type: "string" }, status: { const: "POSTED" }, version: id, replayed: { type: "boolean" } }) }
  };

  async execute(req) {
    const { password: _password, ...input } = req.input.body;
    if (req.get("Idempotency-Key") !== input.eventId) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "eventId" });
    return this.response(await this.reversals.create({
      id: Number(req.input.params.id), claims: req.auth.claims, input, req,
      context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" }
    }));
  }
}
