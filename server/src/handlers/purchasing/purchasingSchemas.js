import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { normalizePurchasingConfig } from "../../modules/purchasing/normalizePurchasingConfig.js";
import { PurchaseOrderService } from "../../modules/purchasing/PurchaseOrderService.js";
import { PurchasingAuditService } from "../../modules/purchasing/PurchasingAuditService.js";
import { purchasingError } from "../../modules/purchasing/purchasingErrors.js";
import { PurchasingOperationService } from "../../modules/purchasing/PurchasingOperationService.js";
import { PurchasingSequenceService } from "../../modules/purchasing/PurchasingSequenceService.js";
import { BusinessMasterLookupProvider } from "../../modules/supplier/providers/BusinessMasterLookupProvider.js";
import { SupplierLookupService } from "../../modules/supplier/SupplierLookupService.js";

export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const OPTIONAL_ID = { type: ["integer", "null"], minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const DATE = { type: "string", format: "date" };
const OPTIONAL_DATE = { type: ["string", "null"], format: "date" };
export const PURCHASE_ORDER_ID_PARAMS = Object.freeze({ type: "object", required: ["id"], additionalProperties: false, properties: { id: ID } });
// 設計 §5.2：Draft 寫入只要 purchasing.mgmt（六個權限互不繼承，§6.1）。
export const PURCHASE_ORDER_WRITE_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["purchasing.mgmt"] } });

// 快照、factor、Base quantity、金額同 status 唔喺 properties，additionalProperties:false 會拒絕（§5.2）。
const line = (update) => ({
  type: "object", required: ["skuId", "purchaseSkuUomId", "orderedQuantity", "unitPrice"], additionalProperties: false,
  properties: {
    ...(update ? { id: ID } : {}), skuId: ID, purchaseSkuUomId: ID,
    orderedQuantity: { type: "string", pattern: "^\\d{1,14}(?:\\.\\d{1,6})?$" },
    unitPrice: { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" },
    zeroPriceReason: { type: "string", maxLength: 500 }, expectedDeliveryDate: OPTIONAL_DATE, lineNote: { type: "string", maxLength: 1000 }
  }
});
const input = (update) => ({
  type: "object", additionalProperties: false,
  required: ["eventId", ...(update ? ["version"] : []), "supplierId", "currencyCode", "orderDate", "buyerId", "lines"],
  properties: {
    // 只收細楷：Idempotency-Key 要同 eventId 逐字相同，Inventory provider 亦只收細楷。
    eventId: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    ...(update ? { version: ID } : {}), supplierId: ID, orderingAddressId: OPTIONAL_ID,
    currencyCode: { type: "string", pattern: "^[A-Z]{3}$" }, paymentTermId: OPTIONAL_ID, orderDate: DATE,
    expectedDeliveryDate: OPTIONAL_DATE, defaultReceivingWarehouseId: OPTIONAL_ID, buyerId: ID,
    supplierReference: { type: "string", maxLength: 190 }, notes: { type: "string", maxLength: 2000 },
    lines: { type: "array", minItems: 1, maxItems: 100, items: line(update) }
  }
});
export const PURCHASE_ORDER_CREATE_INPUT = Object.freeze(input(false));
export const PURCHASE_ORDER_UPDATE_INPUT = Object.freeze(input(true));

export const PURCHASE_ORDER_COMMAND_RESPONSE = Object.freeze({
  type: "object", required: ["id", "number", "status", "version", "warnings", "replayed"], additionalProperties: false,
  properties: {
    id: ID, number: { type: "string", pattern: "^PO-\\d{6}-\\d{6}$" }, status: { const: "DRAFT" }, version: ID,
    warnings: { type: "array", items: { type: "object", required: ["code"], additionalProperties: false,
      properties: { code: { enum: ["SUPPLIER_NOT_PURCHASABLE", "SKU_NOT_PURCHASABLE"] }, lineNumber: ID } } },
    replayed: { type: "boolean" }
  }
});

// 金額同數量係字串，唔可以畀框架 coerce；錯誤要係 §5.7 嘅 PURCHASING_INPUT_INVALID，所以喺 handler 自己驗（同 Sales 一樣）。
const validator = new RequestValidator({ config: { enabled: true, allErrors: false, coerceTypes: false, useDefaults: false,
  removeAdditional: false, maxErrors: 1, includeErrorDetailsInResponse: false } });
const validateCreate = validator.compile({ body: PURCHASE_ORDER_CREATE_INPUT }, "Purchase Order create body");
const validateUpdate = validator.compile({ body: PURCHASE_ORDER_UPDATE_INPUT }, "Purchase Order update body");

/** 驗 body 同 `Idempotency-Key`＝`eventId`（§5.1）；錯誤只帶欄位路徑（例如 `lines.0.unitPrice`），唔帶值。 */
export function purchaseOrderCommand(req, update) {
  const body = req.input.body;
  try { (update ? validateUpdate : validateCreate)({ body }); }
  catch (error) {
    if (error.code !== "REQUEST_VALIDATION_FAILED") throw error;
    const field = error.details?.[0]?.path?.replace(/^\//u, "").replaceAll("/", ".");
    throw purchasingError("PURCHASING_INPUT_INVALID", { field: field || "body" });
  }
  if (req.get("Idempotency-Key") !== body.eventId) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "eventId" });
  return { claims: req.auth.claims, input: body,
    context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" } };
}

/** 真 provider 接線（HD-015）：Supplier 用 Business Master 驗預設 Currency／Payment Term；Item 喺 service 入面用 transaction 連線讀。 */
export function purchaseOrderService(services, logger) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  const businessMaster = new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
  const config = normalizePurchasingConfig(services.config.purchasing);
  return new PurchaseOrderService({
    database, logger, time, businessMaster, config,
    suppliers: new SupplierLookupService({ database, logger, time, businessMaster: new BusinessMasterLookupProvider({
      provider: businessMaster, readiness: new BusinessMasterReadinessService({ database, checkerIds: ["purchasing"] }) }) }),
    sequences: new PurchasingSequenceService(), operations: new PurchasingOperationService(),
    audit: new PurchasingAuditService({ auditDetailMaxBytes: config.auditDetailMaxBytes })
  });
}
