import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { InventoryPostingService } from "../../modules/inventory/InventoryPostingService.js";
import { GoodsReceiptPostingService } from "../../modules/purchasing/GoodsReceiptPostingService.js";
import { GoodsReceiptService } from "../../modules/purchasing/GoodsReceiptService.js";
import { normalizePurchasingConfig } from "../../modules/purchasing/normalizePurchasingConfig.js";
import { PurchasingAuditService } from "../../modules/purchasing/PurchasingAuditService.js";
import { purchasingError } from "../../modules/purchasing/purchasingErrors.js";
import { PurchasingOperationService } from "../../modules/purchasing/PurchasingOperationService.js";
import { PurchasingSequenceService } from "../../modules/purchasing/PurchasingSequenceService.js";
import { PURCHASE_ORDER_ID_PARAMS, validated } from "./purchasingSchemas.js";

const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const EVENT_ID = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" };
const DATE = { type: "string", format: "date" }, OPTIONAL_DATE = { type: ["string", "null"], format: "date" };
// 原因長度同格式由 service 驗（一般原因 §5.1；傳去 Inventory 嘅兩個原因按 byte，TL RULING Q3）；schema 只擋超長。
const REASON = { type: "string", maxLength: 2000 };

export const GOODS_RECEIPT_ID_PARAMS = PURCHASE_ORDER_ID_PARAMS;
/** Confirm 嘅 id 保持字串（唔 coerce）：Inventory issuer 要求 params.id 同 source.documentId 字串完全相等（provider v1 §2）。 */
export const GOODS_RECEIPT_CONFIRM_PARAMS = Object.freeze({ type: "object", required: ["id"], additionalProperties: false,
  properties: { id: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } } });
// 設計 §5.3、§6.1：GR Draft 寫入要 purchasing.view＋receiving.operation（權限唔繼承）；service 喺 transaction 入面再驗。
export const GOODS_RECEIPT_WRITE_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["purchasing.view", "receiving.operation"] } });

export const GOODS_RECEIPT_CREATE_INPUT = Object.freeze({
  type: "object", required: ["eventId", "purchaseOrderId", "businessReceiptDate"], additionalProperties: false,
  properties: { eventId: EVENT_ID, purchaseOrderId: ID, businessReceiptDate: DATE,
    supplierDeliveryNote: { type: "string", maxLength: 190 }, notes: { type: "string", maxLength: 2000 } }
});
// 完整 replace：detail 唔收 id；Base quantity、超收量、warning codes 同 Inventory IDs 一律由 server 計（§5.3）。
const DETAIL = {
  type: "object", required: ["inputUomId", "receivedQuantity", "warehouseId", "binId", "stockStatus"], additionalProperties: false,
  properties: {
    inputUomId: ID, receivedQuantity: { type: "string", maxLength: 64 }, warehouseId: ID, binId: ID,
    lotNumber: { type: "string", maxLength: 200 }, expiryDate: OPTIONAL_DATE, manufactureDate: OPTIONAL_DATE,
    stockStatus: { enum: ["AVAILABLE", "QUARANTINED", "DAMAGED"] }, expiryOverrideReason: REASON
  }
};
export const GOODS_RECEIPT_UPDATE_INPUT = Object.freeze({
  type: "object", required: ["eventId", "version", "businessReceiptDate", "lines"], additionalProperties: false,
  properties: {
    eventId: EVENT_ID, version: ID, businessReceiptDate: DATE, supplierDeliveryNote: { type: "string", maxLength: 190 },
    notes: { type: "string", maxLength: 2000 }, supplierExceptionReason: REASON,
    lines: { type: "array", maxItems: 100, items: { type: "object", required: ["purchaseOrderLineId", "details"], additionalProperties: false,
      properties: { purchaseOrderLineId: ID, overReceiptReason: REASON, skuExceptionReason: REASON,
        details: { type: "array", minItems: 1, maxItems: 200, items: DETAIL } } } }
  }
});
export const GOODS_RECEIPT_CANCEL_INPUT = Object.freeze({ type: "object", required: ["eventId", "version", "reason"], additionalProperties: false,
  properties: { eventId: EVENT_ID, version: ID, reason: REASON } });

export const GOODS_RECEIPT_COMMAND_RESPONSE = Object.freeze({
  type: "object", required: ["id", "number", "status", "version", "warnings", "replayed"], additionalProperties: false,
  properties: {
    id: ID, number: { type: "string", pattern: "^GR-\\d{6}-\\d{6}$" }, status: { enum: ["DRAFT", "CANCELLED", "CONFIRMED"] }, version: ID,
    warnings: { type: "array", maxItems: 1, items: { type: "object", required: ["code", "field", "count"], additionalProperties: false,
      properties: { code: { const: "DUPLICATE_DELIVERY_NOTE" }, field: { const: "supplierDeliveryNote" }, count: { type: "integer", minimum: 1, maximum: 5 } } } },
    replayed: { type: "boolean" }
  }
});

const validator = new RequestValidator({ config: { enabled: true, allErrors: false, coerceTypes: false, useDefaults: false,
  removeAdditional: false, maxErrors: 1, includeErrorDetailsInResponse: false } });
const VALIDATORS = {
  create: validator.compile({ body: GOODS_RECEIPT_CREATE_INPUT }, "Goods Receipt create body"),
  update: validator.compile({ body: GOODS_RECEIPT_UPDATE_INPUT }, "Goods Receipt update body"),
  cancel: validator.compile({ body: GOODS_RECEIPT_CANCEL_INPUT }, "Goods Receipt cancel body"),
  // §5.3：Confirm body 同 update 一樣（完整 replace＋confirm）。
  confirm: validator.compile({ body: GOODS_RECEIPT_UPDATE_INPUT }, "Goods Receipt confirm body")
};

/** 驗 body 同 `Idempotency-Key`＝`eventId`（§5.1）。`kind` 係 create、update、cancel 或者 confirm。 */
export function goodsReceiptCommand(req, kind) {
  const body = req.input.body;
  validated(VALIDATORS[kind], { body }, "body");
  if (req.get("Idempotency-Key") !== body.eventId) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "eventId" });
  return { claims: req.auth.claims, input: body,
    context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" } };
}

export function goodsReceiptService(services, logger) {
  const config = normalizePurchasingConfig(services.config.purchasing);
  const database = services.require("mysqldatabase"), time = services.require("time"), jwt = services.require("jwt");
  // Inventory issuer 用返現有 JWT 嘅 session／clock 限額（同 Inventory 高風險 handler 一樣），唔另訂。
  const posting = new GoodsReceiptPostingService({ database, logger, time, inventory: new InventoryPostingService({ database, logger, time }),
    auth: { sessionMaxAgeSeconds: jwt.sessionMaxAgeSeconds, clockToleranceSeconds: jwt.config.jwt.clockToleranceSeconds } });
  return new GoodsReceiptService({
    database, logger, time, config, sequences: new PurchasingSequenceService(), operations: new PurchasingOperationService(),
    audit: new PurchasingAuditService({ auditDetailMaxBytes: config.auditDetailMaxBytes }), posting
  });
}

// 收貨單最小 list／detail 回應（GoodsReceiptInquiryService；設計 §5.3 子集）。
const TEXT = { type: "string" }, NTEXT = { type: ["string", "null"] }, INT = { type: "integer", minimum: 0 }, NINT = { type: ["integer", "null"], minimum: 0 };
const BASE = { type: "string", pattern: "^[0-9]+$" }, FLAG = { type: "boolean" };
const HEADER_PROPERTIES = { id: ID, number: TEXT, status: { enum: ["DRAFT", "CONFIRMED", "PARTIALLY_REVERSED", "REVERSED", "CANCELLED"] }, version: ID,
  purchaseOrderId: ID, purchaseOrderNumber: TEXT, supplierId: ID, supplierCode: TEXT, supplierName: TEXT, businessReceiptDate: TEXT,
  supplierDeliveryNote: TEXT, totalReceivedBaseQuantity: BASE, hasOverReceipt: FLAG, hasExpiryOverride: FLAG, hasSkuException: FLAG, updatedAt: INT, confirmedAt: NINT };
const strict = (properties) => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties });
const GR_DETAIL = strict({ id: ID, detailNumber: ID, inputUomId: ID, inputUomCode: TEXT, receivedQuantity: TEXT, receivedBaseQuantity: BASE, warehouseId: ID,
  binId: ID, warehouseCode: TEXT, binCode: TEXT, lotNumber: TEXT, expiryDate: NTEXT, manufactureDate: NTEXT, stockStatus: TEXT, expiryOverrideReason: TEXT,
  inventoryMovementId: NINT });
const GR_LINE = strict({ id: ID, purchaseOrderLineId: ID, lineNumber: ID, skuId: ID, skuCode: TEXT, skuName: TEXT, receivedBaseQuantity: BASE,
  overReceivedBaseQuantity: BASE, overReceiptReason: TEXT, skuExceptionReason: TEXT, skuWarningCodes: { type: "array", items: TEXT },
  details: { type: "array", items: GR_DETAIL } });
export const GOODS_RECEIPT_LIST_RESPONSE = strict({ items: { type: "array", items: strict({ ...HEADER_PROPERTIES, currencyCode: TEXT }) }, total: INT, page: ID,
  pageSize: { type: "integer", minimum: 1, maximum: 100 } });
export const GOODS_RECEIPT_DETAIL_RESPONSE = strict({ ...HEADER_PROPERTIES, notes: TEXT, supplierStatusAtConfirm: TEXT, supplierExceptionReason: TEXT,
  createdByLabel: TEXT, updatedByLabel: TEXT, createdAt: INT, cancelledAt: NINT, cancelReason: TEXT,
  allowedActions: { type: "array", items: { enum: ["update", "cancel", "confirm"] } }, lines: { type: "array", items: GR_LINE } });
