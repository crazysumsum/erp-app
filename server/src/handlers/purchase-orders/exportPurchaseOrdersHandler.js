import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY, PURCHASE_ORDER_READ_POLICY, purchaseOrderListRequest, purchasingInquiryService } from "../purchasing/purchasingSchemas.js";

export class ExportPurchaseOrdersHandler extends BaseRequestHandler {
  static handlerName = "exportPurchaseOrders";
  static api = {
    method: "GET",
    path: "/api/v1/purchase-orders/export",
    description: "Export filtered purchase orders as CSV",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY],
    download: { enabled: true },
    requestSchema: { params: EMPTY, query: {}, body: EMPTY },
    responseSchema: { 200: { type: "object", additionalProperties: true } }
  };

  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }

  async execute(req) {
    const content = await this.inquiry.exportPurchaseOrdersCsv({
      ...purchaseOrderListRequest(req, { exportOnly: true }),
      context: { requestId: req.requestId ?? "", correlationId: req.correlationId ?? "", ip: req.ip ?? "" }
    });
    return this.file({ buffer: Buffer.from(content, "utf8"), fileName: "purchase-orders.csv", contentType: "text/csv; charset=utf-8" });
  }
}
