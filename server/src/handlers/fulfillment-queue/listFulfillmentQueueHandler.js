import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentQueueService } from "../../modules/fulfillment/FulfillmentQueueService.js";
import { fulfillmentQueueRequest, FULFILLMENT_QUEUE_EMPTY, FULFILLMENT_QUEUE_RESPONSE } from "./fulfillmentQueueSchemas.js";
export class ListFulfillmentQueueHandler extends BaseRequestHandler {
  static handlerName = "listFulfillmentQueue";
  static api = { method: "GET", path: "/api/v1/fulfillment-queue", description: "List available Fulfillment work", authorizationPolicies: [{ name: "hasPermission", options: { permissions: ["fulfillment.view"] } }],
    requestSchema: { params: FULFILLMENT_QUEUE_EMPTY, query: {}, body: FULFILLMENT_QUEUE_EMPTY }, responseSchema: { 200: FULFILLMENT_QUEUE_RESPONSE } };
  constructor(services = {}) {
    super(services);
    this.queue = new FulfillmentQueueService({ database: services.require("mysqldatabase"), logger: this.logger });
  }
  async execute(req) { return this.response(await this.queue.list(fulfillmentQueueRequest(req))); }
}
