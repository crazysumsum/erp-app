import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import { GOODS_RECEIPT_COMMAND_RESPONSE, GOODS_RECEIPT_WRITE_POLICY, goodsReceiptCommand, goodsReceiptService } from "../purchasing/receivingSchemas.js";

/** 從單一 Confirmed／Partially Received PO 建 GR Draft＋GR Number（設計 §5.3）；唔會將 Outstanding 變成已收。 */
export class CreateGoodsReceiptHandler extends BaseRequestHandler {
  static handlerName = "createGoodsReceipt";
  static api = { method: "POST", path: "/api/v1/goods-receipts/create", description: "Create a Goods Receipt Draft from one Purchase Order",
    authorizationPolicies: [GOODS_RECEIPT_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: EMPTY, query: EMPTY, body: {} }, responseSchema: { 201: GOODS_RECEIPT_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.receipts = goodsReceiptService(services, this.logger);
  }
  async execute(req) { return this.response(await this.receipts.create(goodsReceiptCommand(req, "create")), { statusCode: 201 }); }
}
