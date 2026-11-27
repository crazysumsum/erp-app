import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  AP_INVOICE_POLICY, AP_VIEW_POLICY, EMPTY, ID_PARAMS, INVOICE_COMMAND_RESPONSE, INVOICE_DETAIL_RESPONSE,
  INVOICE_LIST_QUERY, INVOICE_LIST_RESPONSE, apCommand, apInquiryService, apInvoiceService
} from "../accounts-payable/apSchemas.js";

const base = "/api/v1/ap-invoices";
const read = (path, description, query, response, params = EMPTY) => ({
  method: "GET", path: base + path, description, authorizationPolicies: [AP_VIEW_POLICY],
  requestSchema: { params, query, body: EMPTY }, responseSchema: { 200: response }
});
const command = (path, description, params = ID_PARAMS) => ({
  method: "POST", path: base + path, description, authorizationPolicies: [AP_INVOICE_POLICY],
  idempotency: { enabled: true }, requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: INVOICE_COMMAND_RESPONSE }
});

class InquiryHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.inquiry = apInquiryService(services); }
}
class InvoiceHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.invoices = apInvoiceService(services); }
  target(req) { return { ...apCommand(req), invoiceId: Number(req.input.params.id) }; }
}

export class ListApInvoicesHandler extends InquiryHandler {
  static handlerName = "listApInvoices";
  static api = read("", "List AP invoices", INVOICE_LIST_QUERY, INVOICE_LIST_RESPONSE);
  async execute(req) { return this.response(await this.inquiry.listInvoices({ claims: req.auth.claims, query: req.input.query })); }
}

export class GetApInvoiceHandler extends InquiryHandler {
  static handlerName = "getApInvoice";
  static api = read("/:id", "Read AP invoice and its lines and allocations", EMPTY, INVOICE_DETAIL_RESPONSE, ID_PARAMS);
  async execute(req) { return this.response(await this.inquiry.getInvoice({ claims: req.auth.claims, id: Number(req.input.params.id) })); }
}

export class CreateApInvoiceHandler extends InvoiceHandler {
  static handlerName = "createApInvoice";
  static api = command("", "Create an AP invoice draft", EMPTY);
  async execute(req) { return this.response(await this.invoices.create(apCommand(req))); }
}

export class UpdateApInvoiceHandler extends InvoiceHandler {
  static handlerName = "updateApInvoice";
  static api = command("/:id/update", "Update an AP invoice draft");
  async execute(req) { return this.response(await this.invoices.update(this.target(req))); }
}

export class ConfirmApInvoiceHandler extends InvoiceHandler {
  static handlerName = "confirmApInvoice";
  static api = command("/:id/confirm", "Confirm an AP invoice and issue its internal number");
  async execute(req) { return this.response(await this.invoices.confirm(this.target(req))); }
}

export class CancelApInvoiceHandler extends InvoiceHandler {
  static handlerName = "cancelApInvoice";
  static api = command("/:id/cancel", "Cancel an AP invoice draft and release its receipt reservations");
  async execute(req) { return this.response(await this.invoices.cancel(this.target(req))); }
}

export class VoidApInvoiceHandler extends InvoiceHandler {
  static handlerName = "voidApInvoice";
  static api = command("/:id/void", "Void an AP invoice without active allocations");
  async execute(req) { return this.response(await this.invoices.void(this.target(req))); }
}
