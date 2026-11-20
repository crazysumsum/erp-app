import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import {
  GOODS_RECEIPT_COMMAND_RESPONSE, GOODS_RECEIPT_ID_PARAMS, GOODS_RECEIPT_WRITE_POLICY, goodsReceiptCommand, goodsReceiptService
} from "../purchasing/receivingSchemas.js";

/** DRAFT 先取消得；原因＋version，保留 GR Number 同資料（設計 §5.3、§8.5）。 */
export class CancelGoodsReceiptHandler extends BaseRequestHandler {
  static handlerName = "cancelGoodsReceipt";
  static api = { method: "POST", path: "/api/v1/goods-receipts/:id/cancel", description: "Cancel a Goods Receipt Draft",
    authorizationPolicies: [GOODS_RECEIPT_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: GOODS_RECEIPT_ID_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: GOODS_RECEIPT_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.receipts = goodsReceiptService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.receipts.cancel({ ...goodsReceiptCommand(req, "cancel"), goodsReceiptId: Number(req.input.params.id) }));
  }
}
