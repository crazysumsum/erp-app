import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AR_OPENING_POLICY, EMPTY, INVOICE_COMMAND_RESPONSE, arCommand, arInvoiceService } from "../ar/arSchemas.js";

export class CreateArOpeningInvoiceHandler extends BaseRequestHandler {
  static handlerName = "createArOpeningInvoice";
  static api = {
    method: "POST",
    path: "/api/v1/ar-opening-invoices",
    description: "Register and number an opening AR invoice",
    authorizationPolicies: [AR_OPENING_POLICY],
    idempotency: { enabled: true },
    requestSchema: { params: EMPTY, query: EMPTY, body: {} },
    responseSchema: { 200: INVOICE_COMMAND_RESPONSE }
  };

  constructor(services = {}) { super(services); this.invoices = arInvoiceService(services); }
  async execute(req) { return this.response(await this.invoices.registerOpening(arCommand(req))); }
}
