import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  ALLOCATION_COMMAND_RESPONSE, ALLOCATION_PARAMS, AP_PAYMENT_POLICY, AP_VIEW_POLICY, EMPTY, ID_PARAMS, PAYMENT_COMMAND_RESPONSE, PAYMENT_DETAIL_RESPONSE,
  PAYMENT_LIST_QUERY, PAYMENT_LIST_RESPONSE, apCommand, apInquiryService, apPaymentService
} from "../accounts-payable/apSchemas.js";

const BASE = "/api/v1/ap-payments";
const read = (path, description, query, response, params = EMPTY) => ({ method: "GET", path: `${BASE}${path}`, description, authorizationPolicies: [AP_VIEW_POLICY],
  requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response } });
// 命令一律 jwt／ap.payment.mgmt；狀態、版本及金額由 service 在交易內驗。
const command = (path, description, response = PAYMENT_COMMAND_RESPONSE, params = ID_PARAMS) => ({ method: "POST", path: `${BASE}${path}`, description,
  authorizationPolicies: [AP_PAYMENT_POLICY], idempotency: { enabled: true }, requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: response } });

class InquiryHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.inquiry = apInquiryService(services); }
}
class PaymentHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.payments = apPaymentService(services); }
  target(req) { return { ...apCommand(req), paymentId: Number(req.input.params.id) }; }
}

export class ListApPaymentsHandler extends InquiryHandler {
  static handlerName = "listApPayments";
  static api = read("", "List AP payments", PAYMENT_LIST_QUERY, PAYMENT_LIST_RESPONSE);
  async execute(req) { return this.response(await this.inquiry.listPayments({ claims: req.auth.claims, query: req.input.query })); }
}

export class GetApPaymentHandler extends InquiryHandler {
  static handlerName = "getApPayment";
  static api = read("/:id", "Read an AP payment with its allocations", EMPTY, PAYMENT_DETAIL_RESPONSE, ID_PARAMS);
  async execute(req) { return this.response(await this.inquiry.getPayment({ claims: req.auth.claims, id: Number(req.input.params.id) })); }
}

export class CreateApPaymentHandler extends PaymentHandler {
  static handlerName = "createApPayment";
  static api = command("", "Create a Draft AP payment", PAYMENT_COMMAND_RESPONSE, EMPTY);
  async execute(req) { return this.response(await this.payments.create(apCommand(req))); }
}

export class ConfirmApPaymentHandler extends PaymentHandler {
  static handlerName = "confirmApPayment";
  static api = command("/:id/confirm", "Confirm a Draft AP payment and assign its number");
  async execute(req) { return this.response(await this.payments.confirm(this.target(req))); }
}

export class CancelApPaymentHandler extends PaymentHandler {
  static handlerName = "cancelApPayment";
  static api = command("/:id/cancel", "Cancel a Draft AP payment");
  async execute(req) { return this.response(await this.payments.cancel(this.target(req))); }
}

export class VoidApPaymentHandler extends PaymentHandler {
  static handlerName = "voidApPayment";
  static api = command("/:id/void", "Void a Confirmed AP payment that has no active allocation");
  async execute(req) { return this.response(await this.payments.void(this.target(req))); }
}

export class AllocateApPaymentHandler extends PaymentHandler {
  static handlerName = "allocateApPayment";
  static api = command("/:id/allocations", "Allocate a Confirmed AP payment to one or more Confirmed invoices", ALLOCATION_COMMAND_RESPONSE);
  async execute(req) { return this.response(await this.payments.allocate(this.target(req))); }
}

export class UnapplyApPaymentAllocationHandler extends PaymentHandler {
  static handlerName = "unapplyApPaymentAllocation";
  static api = command("/:id/allocations/:allocationId/unapply", "Unapply one allocation of an AP payment", ALLOCATION_COMMAND_RESPONSE, ALLOCATION_PARAMS);
  async execute(req) { return this.response(await this.payments.unapply({ ...this.target(req), allocationId: Number(req.input.params.allocationId) })); }
}
