import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { GoodsReceiptInquiryService } from "../../modules/purchasing/GoodsReceiptInquiryService.js";
import { EMPTY, PURCHASE_ORDER_READ_POLICY } from "../purchasing/purchasingSchemas.js";
import { GOODS_RECEIPT_LIST_RESPONSE } from "../purchasing/receivingSchemas.js";

/** 收貨單列表：page、pageSize（≤100）、status、purchaseOrderId；query 喺 service 驗（設計 §5.3 子集）。 */
export class ListGoodsReceiptsHandler extends BaseRequestHandler {
  static handlerName = "listGoodsReceipts";
  static api = { method: "GET", path: "/api/v1/goods-receipts", description: "List Goods Receipts",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY], requestSchema: { params: EMPTY, query: {}, body: EMPTY },
    responseSchema: { 200: GOODS_RECEIPT_LIST_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = new GoodsReceiptInquiryService({ database: services.require("mysqldatabase") });
  }
  async execute(req) {
    return this.response(await this.inquiry.list({ claims: req.auth.claims, query: req.input.query ?? {} }));
  }
}
