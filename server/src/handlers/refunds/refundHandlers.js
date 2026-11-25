import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { PAYMENT_METHODS } from "../../modules/ar/ArReceiptService.js";
import { RefundInquiryService } from "../../modules/refunds/RefundInquiryService.js";
import { refundError } from "../../modules/refunds/refundErrors.js";
import { customerRefundService, supplierRefundService } from "../../modules/refunds/refundServices.js";
import { REFUND_STATES } from "../../modules/refunds/refundTypes.js";
import { AMOUNT, AR_VIEW_POLICY, CURRENCY, DATE, EMPTY, ID, ID_PARAMS, NULLABLE_TEXT, NULLABLE_TIME, PAGE, TEXT, TIME,
  actions, object } from "../ar/arSchemas.js";
import { AP_VIEW_POLICY } from "../accounts-payable/apSchemas.js";

const STATES = { enum: REFUND_STATES };
const IDENTITY = { id: ID, number: NULLABLE_TEXT, status: STATES, version: ID, amount: AMOUNT };
const RESULT = object({ ...IDENTITY, replayed: { type: "boolean" } });
const SUMMARY = {
  ...IDENTITY, creditNoteId: ID, creditNoteNumber: NULLABLE_TEXT, partyName: TEXT, currencyCode: CURRENCY,
  currencyDecimalPlaces: { type: "integer", minimum: 0, maximum: 4 }, refundDate: DATE,
  paymentMethod: { enum: PAYMENT_METHODS }, reference: TEXT
};
const DETAIL = {
  notes: TEXT, voidReason: TEXT, createdByLabel: TEXT, confirmedByLabel: TEXT, voidedByLabel: TEXT,
  createdAt: TIME, confirmedAt: NULLABLE_TIME, voidedAt: NULLABLE_TIME, allowedActions: actions("confirm", "cancel", "void")
};
const LIST_QUERY = object({ ...PAGE, page: { ...PAGE.page, maximum: 1_000_000 }, creditNoteId: ID, status: STATES }, []);
const CUSTOMER = {
  kind: "customer", base: "/api/v1/ar-refunds", party: "customerId", read: AR_VIEW_POLICY,
  write: { name: "hasPermission", options: { permissions: ["ar.refund.mgmt"] } }, service: customerRefundService
};
const SUPPLIER = {
  kind: "supplier", base: "/api/v1/ap-supplier-refunds", party: "supplierId", read: AP_VIEW_POLICY,
  write: { name: "hasPermission", options: { permissions: ["ap.refund.mgmt"] } }, service: supplierRefundService
};

function readHandler(name, side, list = false) {
  const summary = { ...SUMMARY, [side.party]: ID };
  const response = list
    ? object({ items: { type: "array", items: object(summary), maxItems: 100 }, total: { type: "integer", minimum: 0 }, ...PAGE })
    : object({ ...summary, ...DETAIL });

  return class extends BaseRequestHandler {
    static handlerName = name;
    static api = {
      method: "GET", path: list ? side.base : side.base + "/:id", description: list ? "List refund records" : "Read a refund record",
      authType: "jwt", authorizationPolicies: [side.read],
      requestSchema: { params: list ? EMPTY : ID_PARAMS, query: list ? LIST_QUERY : EMPTY, body: EMPTY },
      responseSchema: { 200: response }
    };

    constructor(services) {
      super(services);
      this.inquiry = new RefundInquiryService({ database: services.require("mysqldatabase"), kind: side.kind });
    }

    async execute(req) {
      if (list) return this.response(await this.inquiry.list(req.input.query));
      return this.response(await this.inquiry.get(req.input.params.id, req.auth.claims.permissions ?? []));
    }
  };
}

function writeHandler(name, side, action) {
  const create = action === "create";
  return class extends BaseRequestHandler {
    static handlerName = name;
    static api = {
      method: "POST", path: create ? side.base : `${side.base}/:id/${action}`,
      description: `${action[0].toUpperCase()}${action.slice(1)} a refund record`, authType: "jwt", authorizationPolicies: [side.write],
      idempotency: { enabled: true },
      requestSchema: { params: create ? EMPTY : ID_PARAMS, query: EMPTY, body: {} },
      responseSchema: { 200: RESULT }
    };

    constructor(services) {
      super(services);
      this.refunds = side.service({ database: services.require("mysqldatabase"), time: services.require("time") });
    }

    async execute(req) {
      const input = req.input.body;
      if (!input?.eventId || req.get("Idempotency-Key") !== input.eventId) throw refundError("REFUND_INPUT_INVALID", { field: "eventId" });
      const context = { requestId: req.requestId, correlationId: req.correlationId, ip: req.ip };
      const result = await this.refunds[action]({ claims: req.auth.claims, refundId: req.input.params.id, input, context });
      return this.response(result);
    }
  };
}

export const ListArRefundsHandler = readHandler("listArRefunds", CUSTOMER, true);
export const GetArRefundHandler = readHandler("getArRefund", CUSTOMER);
export const CreateArRefundHandler = writeHandler("createArRefund", CUSTOMER, "create");
export const ConfirmArRefundHandler = writeHandler("confirmArRefund", CUSTOMER, "confirm");
export const CancelArRefundHandler = writeHandler("cancelArRefund", CUSTOMER, "cancel");
export const VoidArRefundHandler = writeHandler("voidArRefund", CUSTOMER, "void");
export const ListApSupplierRefundsHandler = readHandler("listApSupplierRefunds", SUPPLIER, true);
export const GetApSupplierRefundHandler = readHandler("getApSupplierRefund", SUPPLIER);
export const CreateApSupplierRefundHandler = writeHandler("createApSupplierRefund", SUPPLIER, "create");
export const ConfirmApSupplierRefundHandler = writeHandler("confirmApSupplierRefund", SUPPLIER, "confirm");
export const CancelApSupplierRefundHandler = writeHandler("cancelApSupplierRefund", SUPPLIER, "cancel");
export const VoidApSupplierRefundHandler = writeHandler("voidApSupplierRefund", SUPPLIER, "void");
