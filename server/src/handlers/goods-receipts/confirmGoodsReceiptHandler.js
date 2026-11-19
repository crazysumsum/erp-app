import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY } from "../purchasing/purchasingSchemas.js";
import {
  GOODS_RECEIPT_COMMAND_RESPONSE, GOODS_RECEIPT_CONFIRM_PARAMS, GOODS_RECEIPT_WRITE_POLICY, goodsReceiptCommand, goodsReceiptService
} from "../purchasing/receivingSchemas.js";

/**
 * 完整 replace＋確認，全有或全無 Inventory posting（設計 §3.5、§5.3；TASK-032）。Inventory 嘅一次性 capsule 要由呢個真實 request 發行，
 * 所以 service 收 `req`。Operation lookup 同 timeout recovery 屬 TASK-033；喺嗰之前結果不明只可以用原 event 重送取回結果。
 */
export class ConfirmGoodsReceiptHandler extends BaseRequestHandler {
  static handlerName = "confirmGoodsReceipt";
  static api = { method: "POST", path: "/api/v1/goods-receipts/:id/confirm", description: "Confirm a Goods Receipt and post it to Inventory",
    authorizationPolicies: [GOODS_RECEIPT_WRITE_POLICY], idempotency: { enabled: true },
    requestSchema: { params: GOODS_RECEIPT_CONFIRM_PARAMS, query: EMPTY, body: {} }, responseSchema: { 200: GOODS_RECEIPT_COMMAND_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.receipts = goodsReceiptService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.receipts.confirm({ ...goodsReceiptCommand(req, "confirm"), goodsReceiptId: Number(req.input.params.id), req }));
  }
}
