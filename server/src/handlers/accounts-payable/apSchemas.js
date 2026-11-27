import { ApCommandRunner } from "../../modules/accounts-payable/apCommand.js";
import { apError } from "../../modules/accounts-payable/apErrors.js";
import { ApInquiryService } from "../../modules/accounts-payable/ApInquiryService.js";
import { ApInvoiceService } from "../../modules/accounts-payable/ApInvoiceService.js";
import { ApPaymentService, PAYMENT_METHODS } from "../../modules/accounts-payable/ApPaymentService.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { SupplierLookupService } from "../../modules/supplier/SupplierLookupService.js";
import { readSupplierInvoiceSourcesInTransaction } from "../../modules/purchasing/readSupplierInvoiceSourcesInTransaction.js";

export const AP_VIEW_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ap.view"] } });
export const AP_PAYMENT_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ap.payment.mgmt"] } });
export const AP_INVOICE_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ap.invoice.mgmt"] } });

const object = (properties, required = Object.keys(properties)) => ({ type: "object", required, additionalProperties: false, properties });
export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const TEXT = { type: "string" }, NULLABLE_TEXT = { type: ["string", "null"] }, TIME = { type: "integer", minimum: 0 }, NULLABLE_TIME = { type: ["integer", "null"], minimum: 0 };
const AMOUNT = { type: "string", pattern: "^\\d+\\.\\d{4}$" }, DATE = { type: "string", format: "date" }, CURRENCY = { type: "string", pattern: "^[A-Z]{3}$" };
const PAGE = { page: ID, pageSize: { type: "integer", minimum: 1, maximum: 100 } };
const PAYMENT_STATUSES = ["DRAFT", "CONFIRMED", "CANCELLED", "VOID"];
const INVOICE_STATUS = { enum: ["DRAFT", "CONFIRMED", "CANCELLED", "VOID"] };
const actions = (...names) => ({ type: "array", uniqueItems: true, items: { enum: names } });

export const ID_PARAMS = Object.freeze(object({ id: ID }));
export const ALLOCATION_PARAMS = Object.freeze(object({ id: ID, allocationId: ID }));
// Query string 全部是字串，由框架按 schema 轉型；body 的金額是字串，不交給框架轉型，由 service 嚴格驗證。
export const PAYMENT_LIST_QUERY = Object.freeze(object({ ...PAGE, status: { enum: PAYMENT_STATUSES }, supplierId: ID, currencyCode: CURRENCY,
  paymentDateFrom: DATE, paymentDateTo: DATE, q: { type: "string", minLength: 1, maxLength: 190 } }, []));
export const AGING_QUERY = Object.freeze(object({ supplierId: ID, currencyCode: CURRENCY }, []));

const PAYMENT_SUMMARY = {
  id: ID, number: NULLABLE_TEXT, status: { enum: PAYMENT_STATUSES }, version: ID, supplierId: ID, supplierCode: TEXT, supplierName: TEXT, currencyCode: CURRENCY,
  currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, paymentDate: TEXT, amount: AMOUNT, allocatedAmount: AMOUNT, availableAmount: AMOUNT,
  paymentMethod: { enum: PAYMENT_METHODS }, reference: TEXT, createdAt: TIME, updatedAt: TIME, allowedActions: actions("confirm", "cancel", "allocate", "void")
};
export const PAYMENT_LIST_RESPONSE = Object.freeze(object({ items: { type: "array", maxItems: 100, items: object(PAYMENT_SUMMARY) },
  total: { type: "integer", minimum: 0 }, ...PAGE }));
export const PAYMENT_DETAIL_RESPONSE = Object.freeze(object({
  ...PAYMENT_SUMMARY, notes: TEXT, voidReason: TEXT, createdByLabel: TEXT, confirmedByLabel: TEXT, confirmedAt: NULLABLE_TIME, voidedByLabel: TEXT, voidedAt: NULLABLE_TIME,
  allocations: { type: "array", items: object({ id: ID, invoiceId: ID, invoiceNumber: NULLABLE_TEXT, invoiceDate: TEXT, dueDate: TEXT, invoiceTotalAmount: AMOUNT,
    invoiceOutstandingAmount: AMOUNT, amount: AMOUNT, status: { enum: ["ACTIVE", "UNAPPLIED"] }, createdByLabel: TEXT, createdAt: TIME, unappliedByLabel: TEXT,
    unappliedAt: NULLABLE_TIME, allowedActions: actions("unapply") }) }
}));
// 命令回應：最小結果加 replayed；核銷及解除另回付款的最新金額。
const COMMAND = { id: ID, number: NULLABLE_TEXT, status: { enum: PAYMENT_STATUSES }, version: ID, replayed: { type: "boolean" } };
export const PAYMENT_COMMAND_RESPONSE = Object.freeze(object(COMMAND));
export const ALLOCATION_COMMAND_RESPONSE = Object.freeze(object({ ...COMMAND, allocatedAmount: AMOUNT, availableAmount: AMOUNT,
  allocationIds: { type: "array", items: ID }, allocationId: ID }, [...Object.keys(COMMAND), "allocatedAmount", "availableAmount"]));

const SOURCE_ID = { type: "string", pattern: "^[1-9]\\d{0,19}$" };
const NULLABLE_SOURCE_ID = { ...SOURCE_ID, type: ["string", "null"] };
const NULLABLE_AMOUNT = { ...AMOUNT, type: ["string", "null"] };
const INVOICE_SUMMARY = {
  id: ID, number: NULLABLE_TEXT, status: INVOICE_STATUS, version: ID, supplierId: ID, supplierCode: TEXT, supplierName: TEXT,
  currencyCode: CURRENCY, currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, supplierInvoiceNumber: TEXT,
  invoiceDate: DATE, dueDate: DATE, supplierTotalAmount: NULLABLE_AMOUNT, totalAmount: AMOUNT, allocatedAmount: AMOUNT,
  outstandingAmount: AMOUNT, createdAt: TIME, updatedAt: TIME, allowedActions: actions("update", "confirm", "cancel", "void")
};
export const INVOICE_LIST_QUERY = Object.freeze(object({ ...PAGE, supplierId: ID, currencyCode: CURRENCY, status: INVOICE_STATUS,
  invoiceDateFrom: DATE, invoiceDateTo: DATE, outstandingOnly: { type: "boolean" }, q: { type: "string", minLength: 1, maxLength: 190 } }, []));
export const INVOICE_LIST_RESPONSE = Object.freeze(object({ items: { type: "array", maxItems: 100, items: object(INVOICE_SUMMARY) },
  total: { type: "integer", minimum: 0 }, ...PAGE }));
export const INVOICE_DETAIL_RESPONSE = Object.freeze(object({
  ...INVOICE_SUMMARY, paymentTermCode: TEXT, paymentTermName: TEXT, dueDateOverridden: { type: "boolean" }, dueDateReason: TEXT, noPoReason: TEXT,
  notes: TEXT, voidReason: TEXT, createdByLabel: TEXT, confirmedByLabel: TEXT, confirmedAt: NULLABLE_TIME, voidedByLabel: TEXT, voidedAt: NULLABLE_TIME,
  lines: { type: "array", items: object({ id: ID, lineNo: ID, lineType: { enum: ["RECEIPT", "EXPENSE"] }, goodsReceiptId: NULLABLE_SOURCE_ID,
    goodsReceiptLineId: NULLABLE_SOURCE_ID, goodsReceiptNumber: TEXT, purchaseOrderId: NULLABLE_SOURCE_ID, purchaseOrderLineId: NULLABLE_SOURCE_ID,
    purchaseOrderNumber: TEXT, skuCode: TEXT, skuName: TEXT, baseUomCode: TEXT, purchaseUomCode: TEXT, toBaseFactor: ID,
    quantity: { type: "string", pattern: "^\\d+$" }, poUnitPrice: AMOUNT, poLineAmount: AMOUNT, invoiceUnitPrice: NULLABLE_AMOUNT,
    lineAmount: AMOUNT, amountOverrideReason: TEXT, description: TEXT }) },
  allocations: { type: "array", items: object({ id: ID, paymentId: ID, paymentNumber: NULLABLE_TEXT, paymentDate: DATE, amount: AMOUNT,
    status: { enum: ["ACTIVE", "UNAPPLIED"] }, createdAt: TIME }) }
}));
export const INVOICE_COMMAND_RESPONSE = Object.freeze(object({ ...COMMAND, status: INVOICE_STATUS, totalAmount: AMOUNT }));
export const INVOICED_RECEIPTS_QUERY = Object.freeze(object({ goodsReceiptIds: { type: "string", pattern: "^[1-9]\\d{0,19}(,[1-9]\\d{0,19}){0,99}$" } }));
export const INVOICED_RECEIPTS_RESPONSE = Object.freeze(object({ items: { type: "array", items: object({
  goodsReceiptId: SOURCE_ID, invoiceId: ID, invoiceNumber: NULLABLE_TEXT, invoiceStatus: { enum: ["DRAFT", "CONFIRMED"] }
}) } }));

const BUCKETS = { notDue: AMOUNT, days1To30: AMOUNT, days31To60: AMOUNT, days61To90: AMOUNT, over90: AMOUNT, total: AMOUNT };
export const AGING_RESPONSE = Object.freeze(object({
  asOfDate: TEXT,
  items: { type: "array", items: object({ supplierId: ID, supplierCode: TEXT, supplierName: TEXT, currencyCode: CURRENCY,
    currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, invoiceCount: ID, ...BUCKETS }) },
  totals: { type: "array", items: object({ currencyCode: CURRENCY, invoiceCount: ID, ...BUCKETS }) }
}));

/** 命令的共同輸入：`Idempotency-Key` 必須與 body 的 `eventId` 逐字相同，重送才會回到同一個操作。 */
export function apCommand(req) {
  const body = req.input.body;
  if (!body || typeof body !== "object" || req.get("Idempotency-Key") !== body.eventId) throw apError("AP_INPUT_INVALID", { field: "eventId" });
  return { claims: req.auth.claims, input: body, context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" } };
}

export function apPaymentService(services) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  return new ApPaymentService({
    commands: new ApCommandRunner({ database, time }),
    suppliers: new SupplierLookupService({ database, logger: services.require("logging").logger, time }),
    businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }),
    time
  });
}

export function apInvoiceService(services) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  return new ApInvoiceService({
    commands: new ApCommandRunner({ database, time }),
    suppliers: new SupplierLookupService({ database, logger: services.require("logging").logger, time }),
    businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }),
    time,
    readSources: readSupplierInvoiceSourcesInTransaction
  });
}

export function apInquiryService(services) {
  return new ApInquiryService({ database: services.require("mysqldatabase"), time: services.require("time") });
}
