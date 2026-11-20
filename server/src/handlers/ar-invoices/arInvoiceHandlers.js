import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import {
  AR_INVOICE_POLICY, AR_VIEW_POLICY, EMPTY, ID_PARAMS, INVOICE_COMMAND_RESPONSE, INVOICE_DETAIL_RESPONSE, INVOICE_LIST_QUERY, INVOICE_LIST_RESPONSE,
  arCommand, arInquiryService, arInvoiceService
} from "../ar/arSchemas.js";

const BASE = "/api/v1/ar-invoices";
// 命令一律 jwt／ar.invoice.mgmt；出貨狀態、防重開票、版本及金額由 service 在交易內驗。
const command = (path, description, params = ID_PARAMS) => ({ method: "POST", path: `${BASE}${path}`, description, authorizationPolicies: [AR_INVOICE_POLICY],
  idempotency: { enabled: true }, requestSchema: { params, query: EMPTY, body: {} }, responseSchema: { 200: INVOICE_COMMAND_RESPONSE } });

class InquiryHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.inquiry = arInquiryService(services); }
}
class InvoiceHandler extends BaseRequestHandler {
  constructor(services = {}) { super(services); this.invoices = arInvoiceService(services); }
  target(req) { return { ...arCommand(req), invoiceId: Number(req.input.params.id) }; }
}

export class ListArInvoicesHandler extends InquiryHandler {
  static handlerName = "listArInvoices";
  static api = { method: "GET", path: BASE, description: "List AR invoices", authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: EMPTY, query: INVOICE_LIST_QUERY, body: EMPTY }, responseSchema: { 200: INVOICE_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.inquiry.listInvoices({ claims: req.auth.claims, query: req.input.query })); }
}

export class GetArInvoiceHandler extends InquiryHandler {
  static handlerName = "getArInvoice";
  static api = { method: "GET", path: `${BASE}/:id`, description: "Read an AR invoice with its lines and allocations", authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: ID_PARAMS, query: EMPTY, body: EMPTY }, responseSchema: { 200: INVOICE_DETAIL_RESPONSE } };
  async execute(req) { return this.response(await this.inquiry.getInvoice({ claims: req.auth.claims, id: Number(req.input.params.id) })); }
}

export class CreateArInvoiceHandler extends InvoiceHandler {
  static handlerName = "createArInvoice";
  static api = command("", "Create a Draft AR invoice from shipped shipments of one customer and currency", EMPTY);
  async execute(req) { return this.response(await this.invoices.create(arCommand(req))); }
}

export class ConfirmArInvoiceHandler extends InvoiceHandler {
  static handlerName = "confirmArInvoice";
  static api = command("/:id/confirm", "Confirm a Draft AR invoice and assign its number");
  async execute(req) { return this.response(await this.invoices.confirm(this.target(req))); }
}

export class CancelArInvoiceHandler extends InvoiceHandler {
  static handlerName = "cancelArInvoice";
  static api = command("/:id/cancel", "Cancel a Draft AR invoice and release its shipments");
  async execute(req) { return this.response(await this.invoices.cancel(this.target(req))); }
}

export class VoidArInvoiceHandler extends InvoiceHandler {
  static handlerName = "voidArInvoice";
  static api = command("/:id/void", "Void a Confirmed AR invoice that has no active allocation and release its shipments");
  async execute(req) { return this.response(await this.invoices.void(this.target(req))); }
}
