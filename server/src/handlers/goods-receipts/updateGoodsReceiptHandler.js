import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import {
  GOODS_RECEIPT_COMMAND_RESPONSE, GOODS_RECEIPT_ID_PARAMS, GOODS_RECEIPT_WRITE_POLICY, goodsReceiptCommand, goodsReceiptService
} from "../purchasing/receivingSchemas.js";

/** DRAFT 先改得；完整 replace lines／details＋version（設計 §5.3、§8.5）。 */
export class UpdateGoodsReceiptHandler extends BaseRequestHandler {
  static handlerName = "updateGoodsReceipt";
  static api = { method: "POST", path: "/api/v1/goods-receipts/:id/update", description: "Replace a Goods Receipt Draft",
    authorizationPolicies: [GOODS_RECEIPT_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: GOODS_RECEIPT_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: GOODS_RECEIPT_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.receipts = goodsReceiptService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.receipts.update({ ...goodsReceiptCommand(req, "update"), goodsReceiptId: Number(req.input.params.id) }));
  }
}
