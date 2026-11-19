import { ArCommandRunner } from "../../modules/ar/arCommand.js";
import { arError } from "../../modules/ar/arErrors.js";
import { ArInquiryService } from "../../modules/ar/ArInquiryService.js";
import { ArInvoiceService } from "../../modules/ar/ArInvoiceService.js";
import { ArReceiptService, PAYMENT_METHODS } from "../../modules/ar/ArReceiptService.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../../modules/businessMaster/BusinessMasterRepository.js";
import { CustomerLookupService } from "../../modules/customer/CustomerLookupService.js";
import { readInvoiceSourcesInTransaction } from "../../modules/fulfillment/readInvoiceSourcesInTransaction.js";

// 三個權限互不繼承：查看、發票管理、收款及核銷管理。
export const AR_VIEW_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ar.view"] } });
export const AR_INVOICE_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ar.invoice.mgmt"] } });
export const AR_RECEIPT_POLICY = Object.freeze({ name: "hasPermission", options: { permissions: ["ar.receipt.mgmt"] } });

const object = (properties, required = Object.keys(properties)) => ({ type: "object", required, additionalProperties: false, properties });
export const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });
const ID = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const TEXT = { type: "string" }, NULLABLE_TEXT = { type: ["string", "null"] }, TIME = { type: "integer", minimum: 0 }, NULLABLE_TIME = { type: ["integer", "null"], minimum: 0 };
const AMOUNT = { type: "string", pattern: "^\\d+\\.\\d{4}$" }, DATE = { type: "string", format: "date" }, CURRENCY = { type: "string", pattern: "^[A-Z]{3}$" };
const PAGE = { page: ID, pageSize: { type: "integer", minimum: 1, maximum: 100 } };
const RECEIPT_STATUSES = ["DRAFT", "CONFIRMED", "CANCELLED", "VOID"];
const actions = (...names) => ({ type: "array", uniqueItems: true, items: { enum: names } });

export const ID_PARAMS = Object.freeze(object({ id: ID }));
export const ALLOCATION_PARAMS = Object.freeze(object({ id: ID, allocationId: ID }));
// Query string 全部是字串，由框架按 schema 轉型；body 的金額是字串，不交給框架轉型，由 service 嚴格驗證。
export const RECEIPT_LIST_QUERY = Object.freeze(object({ ...PAGE, status: { enum: RECEIPT_STATUSES }, customerId: ID, currencyCode: CURRENCY,
  receiptDateFrom: DATE, receiptDateTo: DATE, q: { type: "string", minLength: 1, maxLength: 190 } }, []));
export const AGING_QUERY = Object.freeze(object({ customerId: ID, currencyCode: CURRENCY }, []));

const RECEIPT_SUMMARY = {
  id: ID, number: NULLABLE_TEXT, status: { enum: RECEIPT_STATUSES }, version: ID, customerId: ID, customerCode: TEXT, customerName: TEXT, currencyCode: CURRENCY,
  currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, receiptDate: TEXT, amount: AMOUNT, allocatedAmount: AMOUNT, availableAmount: AMOUNT,
  paymentMethod: { enum: PAYMENT_METHODS }, reference: TEXT, createdAt: TIME, updatedAt: TIME, allowedActions: actions("confirm", "cancel", "allocate", "void")
};
export const RECEIPT_LIST_RESPONSE = Object.freeze(object({ items: { type: "array", maxItems: 100, items: object(RECEIPT_SUMMARY) },
  total: { type: "integer", minimum: 0 }, ...PAGE }));
export const RECEIPT_DETAIL_RESPONSE = Object.freeze(object({
  ...RECEIPT_SUMMARY, notes: TEXT, voidReason: TEXT, createdByLabel: TEXT, confirmedByLabel: TEXT, confirmedAt: NULLABLE_TIME, voidedByLabel: TEXT, voidedAt: NULLABLE_TIME,
  allocations: { type: "array", items: object({ id: ID, invoiceId: ID, invoiceNumber: NULLABLE_TEXT, invoiceDate: TEXT, dueDate: TEXT, invoiceTotalAmount: AMOUNT,
    invoiceOutstandingAmount: AMOUNT, amount: AMOUNT, status: { enum: ["ACTIVE", "UNAPPLIED"] }, createdByLabel: TEXT, createdAt: TIME, unappliedByLabel: TEXT,
    unappliedAt: NULLABLE_TIME, allowedActions: actions("unapply") }) }
}));
// 命令回應：最小結果加 replayed；核銷及解除另回收款的最新金額。
const COMMAND = { id: ID, number: NULLABLE_TEXT, status: { enum: RECEIPT_STATUSES }, version: ID, replayed: { type: "boolean" } };
export const RECEIPT_COMMAND_RESPONSE = Object.freeze(object(COMMAND));
export const ALLOCATION_COMMAND_RESPONSE = Object.freeze(object({ ...COMMAND, allocatedAmount: AMOUNT, availableAmount: AMOUNT,
  allocationIds: { type: "array", items: ID }, allocationId: ID }, [...Object.keys(COMMAND), "allocatedAmount", "availableAmount"]));

const INVOICE_STATUSES = ["DRAFT", "CONFIRMED", "VOID", "CANCELLED"], QUANTITY = { type: "string", pattern: "^\\d+$" };
export const INVOICE_LIST_QUERY = Object.freeze(object({ ...PAGE, status: { enum: INVOICE_STATUSES }, customerId: ID, currencyCode: CURRENCY,
  invoiceDateFrom: DATE, invoiceDateTo: DATE, outstandingOnly: { type: "boolean" }, q: { type: "string", minLength: 1, maxLength: 190 } }, []));
// 逗號分隔的出貨 ID，最多 100 個。
export const INVOICED_SHIPMENTS_QUERY = Object.freeze(object({ shipmentIds: { type: "string", pattern: "^[1-9]\\d{0,15}(,[1-9]\\d{0,15}){0,99}$" } }));
const INVOICE_SUMMARY = {
  id: ID, number: NULLABLE_TEXT, status: { enum: INVOICE_STATUSES }, version: ID, customerId: ID, customerCode: TEXT, customerName: TEXT, currencyCode: CURRENCY,
  currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, invoiceDate: TEXT, dueDate: TEXT, totalAmount: AMOUNT, allocatedAmount: AMOUNT,
  outstandingAmount: AMOUNT, createdAt: TIME, updatedAt: TIME, allowedActions: actions("confirm", "cancel", "void")
};
export const INVOICE_LIST_RESPONSE = Object.freeze(object({ items: { type: "array", maxItems: 100, items: object(INVOICE_SUMMARY) },
  total: { type: "integer", minimum: 0 }, ...PAGE }));
export const INVOICE_DETAIL_RESPONSE = Object.freeze(object({
  ...INVOICE_SUMMARY, paymentTermCode: TEXT, paymentTermName: TEXT, dueDateOverridden: { type: "boolean" }, dueDateReason: TEXT, notes: TEXT, voidReason: TEXT,
  createdByLabel: TEXT, confirmedByLabel: TEXT, confirmedAt: NULLABLE_TIME, voidedByLabel: TEXT, voidedAt: NULLABLE_TIME,
  lines: { type: "array", items: object({ id: ID, lineNo: ID, shipmentId: ID, shipmentLineId: ID, salesOrderId: ID, salesOrderLineId: ID, skuCode: TEXT, skuName: TEXT,
    baseUomCode: TEXT, quantity: QUANTITY, unitPrice: AMOUNT, lineAmount: AMOUNT }) },
  allocations: { type: "array", items: object({ id: ID, receiptId: ID, receiptNumber: NULLABLE_TEXT, receiptDate: TEXT, amount: AMOUNT,
    status: { enum: ["ACTIVE", "UNAPPLIED"] }, createdAt: TIME }) }
}));
export const INVOICE_COMMAND_RESPONSE = Object.freeze(object({ id: ID, number: NULLABLE_TEXT, status: { enum: INVOICE_STATUSES }, version: ID, totalAmount: AMOUNT,
  replayed: { type: "boolean" } }, ["id", "number", "status", "version", "replayed"]));
export const INVOICED_SHIPMENTS_RESPONSE = Object.freeze(object({ items: { type: "array", maxItems: 100,
  items: object({ shipmentId: ID, invoiceId: ID, invoiceNumber: NULLABLE_TEXT, invoiceStatus: { enum: ["DRAFT", "CONFIRMED"] } }) } }));

const BUCKETS = { notDue: AMOUNT, days1To30: AMOUNT, days31To60: AMOUNT, days61To90: AMOUNT, over90: AMOUNT, total: AMOUNT };
export const AGING_RESPONSE = Object.freeze(object({
  asOfDate: TEXT,
  items: { type: "array", items: object({ customerId: ID, customerCode: TEXT, customerName: TEXT, currencyCode: CURRENCY,
    currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, invoiceCount: ID, ...BUCKETS }) },
  totals: { type: "array", items: object({ currencyCode: CURRENCY, invoiceCount: ID, ...BUCKETS }) }
}));

/** 命令的共同輸入：`Idempotency-Key` 必須與 body 的 `eventId` 逐字相同，重送才會回到同一個操作。 */
export function arCommand(req) {
  const body = req.input.body;
  if (!body || typeof body !== "object" || req.get("Idempotency-Key") !== body.eventId) throw arError("AR_INPUT_INVALID", { field: "eventId" });
  return { claims: req.auth.claims, input: body, context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" } };
}

/** 客戶查詢綁在呼叫方的交易連線上：一個請求同一時間只佔一條連線。 */
const customers = (executor) => new CustomerLookupService({ database: executor });

export function arReceiptService(services) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  return new ArReceiptService({ commands: new ArCommandRunner({ database, time }), time, customers,
    businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }) });
}

/** 發票來源只經 Fulfillment 的 reader；AR 不查 Sales 或 Fulfillment 的表。 */
export function arInvoiceService(services) {
  const database = services.require("mysqldatabase"), time = services.require("time");
  return new ArInvoiceService({ commands: new ArCommandRunner({ database, time }), time, readInvoiceSources: readInvoiceSourcesInTransaction,
    customers, businessMaster: new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() }) });
}

export function arInquiryService(services) {
  return new ArInquiryService({ database: services.require("mysqldatabase"), time: services.require("time") });
}
