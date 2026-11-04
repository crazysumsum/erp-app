import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { normalizePurchasingConfig } from "../../modules/purchasing/normalizePurchasingConfig.js";
import { PurchaseOrderService } from "../../modules/purchasing/PurchaseOrderService.js";
import { PurchasingAuditService } from "../../modules/purchasing/PurchasingAuditService.js";
import { PurchasingInquiryService } from "../../modules/purchasing/PurchasingInquiryService.js";
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
export const PURCHASE_ORDER_READ_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["purchasing.view"] } });

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

const EVENT_ID = input(false).properties.eventId;
export const PURCHASE_ORDER_COPY_INPUT = Object.freeze({ type: "object", required: ["eventId"], additionalProperties: false, properties: { eventId: EVENT_ID } });
// 審批人、status 都唔喺度，所以 client 送嚟一定被拒絕；審批開啟嘅欄位由 TASK-023 加。
export const PURCHASE_ORDER_SUBMIT_INPUT = Object.freeze({ type: "object", required: ["eventId", "version"], additionalProperties: false,
  properties: { eventId: EVENT_ID, version: ID } });

export const PURCHASE_ORDER_COMMAND_RESPONSE = Object.freeze({
  type: "object", required: ["id", "number", "status", "version", "warnings", "replayed"], additionalProperties: false,
  properties: {
    id: ID, number: { type: "string", pattern: "^PO-\\d{6}-\\d{6}$" }, status: { const: "DRAFT" }, version: ID,
    warnings: { type: "array", items: { type: "object", required: ["code"], additionalProperties: false,
      properties: { code: { enum: ["SUPPLIER_NOT_PURCHASABLE", "SKU_NOT_PURCHASABLE", "COPY_FIELD_CHANGED", "COPY_LINE_DROPPED"] }, lineNumber: ID,
        field: { type: "string" } } } },
    replayed: { type: "boolean" }
  }
});

const NUMBER = PURCHASE_ORDER_COMMAND_RESPONSE.properties.number;
export const PURCHASE_ORDER_SUBMIT_RESPONSE = Object.freeze({
  type: "object", required: ["id", "number", "status", "outcome", "version", "warnings", "replayed"], additionalProperties: false,
  properties: { id: ID, number: NUMBER, status: { const: "CONFIRMED" }, outcome: { const: "CONFIRMED" }, version: ID,
    warnings: { type: "array", maxItems: 0 }, replayed: { type: "boolean" } }
});

// 金額同數量係字串，唔可以畀框架 coerce；錯誤要係 §5.7 嘅 PURCHASING_INPUT_INVALID，所以喺 handler 自己驗（同 Sales 一樣）。
const validator = new RequestValidator({ config: { enabled: true, allErrors: false, coerceTypes: false, useDefaults: false,
  removeAdditional: false, maxErrors: 1, includeErrorDetailsInResponse: false } });
const validateCreate = validator.compile({ body: PURCHASE_ORDER_CREATE_INPUT }, "Purchase Order create body");
const validateUpdate = validator.compile({ body: PURCHASE_ORDER_UPDATE_INPUT }, "Purchase Order update body");
const validateCopy = validator.compile({ body: PURCHASE_ORDER_COPY_INPUT }, "Purchase Order copy body");
const validateSubmit = validator.compile({ body: PURCHASE_ORDER_SUBMIT_INPUT }, "Purchase Order submit body");

/** 錯誤只帶欄位路徑（例如 `lines.0.unitPrice`），唔帶值。 */
function validated(validate, request, fallback) {
  try { validate(request); }
  catch (error) {
    if (error.code !== "REQUEST_VALIDATION_FAILED") throw error;
    const field = error.details?.[0]?.path?.replace(/^\//u, "").replaceAll("/", ".");
    throw purchasingError("PURCHASING_INPUT_INVALID", { field: field || fallback });
  }
}

/** 驗 body 同 `Idempotency-Key`＝`eventId`（§5.1）。`kind` 係 create、update、copy 或者 submit。 */
export function purchaseOrderCommand(req, kind) {
  const body = req.input.body;
  validated({ create: validateCreate, update: validateUpdate, copy: validateCopy, submit: validateSubmit }[kind], { body }, "body");
  if (req.get("Idempotency-Key") !== body.eventId) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "eventId" });
  return { claims: req.auth.claims, input: body,
    context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" } };
}

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "CONFIRMED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED", "CANCELLED"];
export const PURCHASE_ORDER_LIST_QUERY = Object.freeze({
  type: "object", additionalProperties: false,
  properties: {
    page: ID, pageSize: { type: "integer", minimum: 1, maximum: 100 }, q: { type: "string", maxLength: 190 },
    sortBy: { enum: ["updatedAt", "number", "supplierName", "orderDate", "expectedDeliveryDate", "status", "totalAmount"] }, descending: { type: "boolean" },
    status: { anyOf: [{ enum: STATUSES }, { type: "array", minItems: 1, maxItems: STATUSES.length, items: { enum: STATUSES } }] },
    supplierId: ID, buyerId: ID, skuId: ID, currencyCode: { type: "string", pattern: "^[A-Z]{3}$" }, hasOutstanding: { type: "boolean" },
    orderDateFrom: DATE, orderDateTo: DATE, expectedDeliveryDateFrom: DATE, expectedDeliveryDateTo: DATE
  }
});
// Query string 全部係字串，所以呢個 validator 要 coerce；body 嗰個唔可以。
const queryValidator = new RequestValidator({ config: { enabled: true, allErrors: false, coerceTypes: true, useDefaults: false,
  removeAdditional: false, maxErrors: 1, includeErrorDetailsInResponse: false } });
const validateList = queryValidator.compile({ query: PURCHASE_ORDER_LIST_QUERY }, "Purchase Order list query");

export function purchaseOrderListRequest(req) {
  const request = { query: structuredClone(req.input.query) };
  validated(validateList, request, "query");
  return { claims: req.auth.claims, input: request.input.query };
}

const object = (properties) => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties });
const TEXT = { type: "string" }, TIME = { type: "integer", minimum: 0 }, NULLABLE_TIME = { type: ["integer", "null"], minimum: 0 };
const NULLABLE_TEXT = { type: ["string", "null"] }, NULLABLE_DATE = { type: ["string", "null"] };
const AMOUNT = { type: "string", pattern: "^\\d+(?:\\.\\d{1,4})?$" }, BASE_QUANTITY = { type: "string", pattern: "^\\d+$" };
const ACTIONS = { type: "array", uniqueItems: true, items: { enum: ["edit", "submit", "copy"] } };
const HEADER = {
  id: ID, number: { type: "string", pattern: "^PO-\\d{6}-\\d{6}$" }, status: { enum: STATUSES }, version: ID, supplierId: ID, supplierCode: TEXT, supplierName: TEXT,
  currencyCode: TEXT, orderDate: TEXT, expectedDeliveryDate: NULLABLE_DATE, buyerId: OPTIONAL_ID, buyerLabel: TEXT, supplierReference: TEXT, totalAmount: AMOUNT,
  hasOutstanding: { type: "boolean" }, createdAt: TIME, updatedAt: TIME, allowedActions: ACTIONS
};
export const PURCHASE_ORDER_LIST_RESPONSE = Object.freeze(object({
  items: { type: "array", maxItems: 100, items: object({ ...HEADER, lineCount: { type: "integer", minimum: 1, maximum: 100 }, orderedBaseQuantity: BASE_QUANTITY,
    netReceivedBaseQuantity: BASE_QUANTITY, outstandingBaseQuantity: BASE_QUANTITY, closedRemainingBaseQuantity: BASE_QUANTITY,
    risks: { type: "array", uniqueItems: true, items: { enum: ["OVERDUE", "OVER_RECEIVED", "ZERO_PRICE", "INACTIVE_MASTER"] } } }) },
  total: { type: "integer", minimum: 0 }, page: ID, pageSize: { type: "integer", minimum: 1, maximum: 100 }
}));
const ADDRESS = object(Object.fromEntries(["addressLine1", "addressLine2", "addressLine3", "city", "stateRegion", "postalCode", "countryCode", "phone"]
  .map((field) => [field, NULLABLE_TEXT])));
const PAYMENT_TERM = object({ code: TEXT, name: TEXT, calculationType: TEXT, dueDays: { type: ["integer", "null"] } });
const PO_LINE = object({
  id: ID, lineNumber: ID, skuId: ID, skuCode: TEXT, skuName: TEXT, trackingPolicy: TEXT, inventoryTracked: { type: "boolean" },
  minimumReceiptLifeDays: { type: ["integer", "null"] }, baseUomId: ID, baseUomCode: TEXT, purchaseSkuUomId: ID, purchaseUomCode: TEXT, uomToBaseFactor: ID,
  supplierItemCode: TEXT, orderedQuantity: TEXT, orderedBaseQuantity: BASE_QUANTITY, unitPrice: TEXT, lineAmount: AMOUNT, zeroPriceReason: TEXT,
  expectedDeliveryDate: NULLABLE_DATE, lineNote: TEXT, grossReceivedBaseQuantity: BASE_QUANTITY, reversedBaseQuantity: BASE_QUANTITY,
  netReceivedBaseQuantity: BASE_QUANTITY, outstandingBaseQuantity: BASE_QUANTITY, overReceivedBaseQuantity: BASE_QUANTITY,
  closedRemainingBaseQuantity: BASE_QUANTITY, closeReason: TEXT, version: ID
});
export const PURCHASE_ORDER_DETAIL_RESPONSE = Object.freeze(object({
  ...HEADER, orderingAddressId: OPTIONAL_ID, orderingAddress: { anyOf: [{ type: "null" }, ADDRESS] }, currencyName: TEXT,
  currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, paymentTermId: OPTIONAL_ID, paymentTerm: { anyOf: [{ type: "null" }, PAYMENT_TERM] },
  defaultReceivingWarehouseId: OPTIONAL_ID, defaultWarehouseCode: TEXT, notes: TEXT, subtotalAmount: AMOUNT, hasConfirmedReceipt: { type: "boolean" },
  createdByLabel: TEXT, updatedByLabel: TEXT, confirmedAt: NULLABLE_TIME, closedAt: NULLABLE_TIME, cancelledAt: NULLABLE_TIME,
  lines: { type: "array", minItems: 1, maxItems: 100, items: PO_LINE },
  currentMasterDifferences: object({
    supplier: { anyOf: [{ type: "null" }, object({ supplierCode: TEXT, supplierName: TEXT, status: TEXT })] },
    lines: { type: "array", maxItems: 100, items: object({ lineId: ID, skuId: ID, skuCode: TEXT, skuName: TEXT, skuStatus: TEXT, itemStatus: TEXT }) }
  })
}));

export function purchasingInquiryService(services, logger) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  return new PurchasingInquiryService({ database, logger, time, suppliers: new SupplierLookupService({ database, logger, time }) });
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
