import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { GoodsReceiptInquiryService } from "../../modules/purchasing/GoodsReceiptInquiryService.js";
import { EMPTY, PURCHASE_ORDER_READ_POLICY } from "../purchasing/purchasingSchemas.js";
import { GOODS_RECEIPT_DETAIL_RESPONSE, GOODS_RECEIPT_ID_PARAMS } from "../purchasing/receivingSchemas.js";

/** 收貨單詳情：表頭、lines、details（含 Inventory movement）及 allowedActions（設計 §5.3 子集；reversal 屬之後 Task）。 */
export class GetGoodsReceiptHandler extends BaseRequestHandler {
  static handlerName = "getGoodsReceipt";
  static api = { method: "GET", path: "/api/v1/goods-receipts/:id", description: "Read a Goods Receipt",
    authorizationPolicies: [PURCHASE_ORDER_READ_POLICY], requestSchema: { params: GOODS_RECEIPT_ID_PARAMS, query: EMPTY, body: EMPTY },
    responseSchema: { 200: GOODS_RECEIPT_DETAIL_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = new GoodsReceiptInquiryService({ database: services.require("mysqldatabase") });
  }
  async execute(req) {
    return this.response(await this.inquiry.get({ claims: req.auth.claims, id: Number(req.input.params.id) }));
  }
}
