import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { EMPTY, purchasingInquiryService } from "../purchasing/purchasingSchemas.js";

const EVENT_ID = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" };
const SUMMARY = { type: "object", additionalProperties: false, properties: {
  id: { type: "integer", minimum: 1 }, number: { type: "string" }, status: { type: "string" }, version: { type: "integer", minimum: 1 },
  requirePoApproval: { type: "boolean" } } };
const RESPONSE = { type: "object", required: ["status", "resultType", "resultId", "resultSummary", "completedAt"], additionalProperties: false,
  properties: { status: { const: "COMPLETED" }, resultType: { enum: ["PO", "GR", "SETTING", "REVERSAL"] }, resultId: { type: "string" }, resultSummary: SUMMARY,
    completedAt: { type: "integer", minimum: 0 } } };

/**
 * COMMIT 結果不明（TRANSACTION_OUTCOME_UNKNOWN）時按原 eventId 查結果，唔好換 event 重送（設計 §2.7、§5.4；TASK-033）。
 * 只要已登入；原命令權限同「只限本人」喺 service 交易內驗，唔存在同冇權一樣 404。
 */
export class GetPurchasingOperationByEventHandler extends BaseRequestHandler {
  static handlerName = "getPurchasingOperationByEvent";
  static api = { method: "GET", path: "/api/v1/purchasing-operations/by-event/:eventId", description: "Look up a Purchasing operation result by eventId",
    authorizationPolicies: [{ name: "authenticated" }],
    requestSchema: { params: { type: "object", required: ["eventId"], additionalProperties: false, properties: { eventId: EVENT_ID } }, query: EMPTY, body: EMPTY },
    responseSchema: { 200: RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.inquiry = purchasingInquiryService(services, this.logger);
  }
  async execute(req) {
    return this.response(await this.inquiry.operation({ claims: req.auth.claims, eventId: req.input.params.eventId }));
  }
}
