import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { getArInvoicePrint } from "../../modules/ar/getArInvoicePrint.js";
import { AR_VIEW_POLICY, EMPTY, ID_PARAMS, INVOICE_PRINT_RESPONSE } from "../ar/arSchemas.js";

export class GetArInvoicePrintHandler extends BaseRequestHandler {
  static handlerName = "getArInvoicePrint";
  static api = {
    method: "GET", path: "/api/v1/ar-invoices/:id/print", description: "Read an issued AR invoice for printing",
    authorizationPolicies: [AR_VIEW_POLICY],
    requestSchema: { params: ID_PARAMS, query: EMPTY, body: EMPTY }, responseSchema: { 200: INVOICE_PRINT_RESPONSE }
  };

  constructor(services = {}) {
    super(services);
    this.database = services.require("mysqldatabase");
    this.company = services.config.company;
  }

  async execute(req, res) {
    res.setHeader("Cache-Control", "no-store");
    return this.response(await getArInvoicePrint({ database: this.database, company: this.company, id: Number(req.input.params.id) }));
  }
}
