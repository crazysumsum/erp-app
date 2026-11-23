import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { AR_VIEW_POLICY, EMPTY, INVOICED_SHIPMENTS_QUERY, INVOICED_SHIPMENTS_RESPONSE, arInquiryService } from "../ar/arSchemas.js";

/** 所問的出貨之中已在有效發票上的；「由出貨建立發票」頁用來排除已開票的出貨。 */
export class ListArInvoicedShipmentsHandler extends BaseRequestHandler {
  static handlerName = "listArInvoicedShipments";
  static api = { method: "GET", path: "/api/v1/ar-invoiced-shipments", description: "List which of the given shipments are on an active AR invoice",
    authorizationPolicies: [AR_VIEW_POLICY], requestSchema: { params: EMPTY, query: INVOICED_SHIPMENTS_QUERY, body: EMPTY }, responseSchema: { 200: INVOICED_SHIPMENTS_RESPONSE } };
  constructor(services = {}) { super(services); this.inquiry = arInquiryService(services); }
  async execute(req) { return this.response(await this.inquiry.invoicedShipments({ shipmentIds: req.input.query.shipmentIds })); }
}
