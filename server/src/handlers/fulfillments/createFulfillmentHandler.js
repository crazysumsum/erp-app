import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentService } from "../../modules/fulfillment/FulfillmentService.js";
import { FULFILLMENT_CREATE_EMPTY, FULFILLMENT_CREATE_RESPONSE, fulfillmentCreateRequest } from "./fulfillmentCreateSchemas.js";
export class CreateFulfillmentHandler extends BaseRequestHandler {
  static handlerName = "createFulfillment";
  static api = {method:"POST",path:"/api/v1/fulfillments/create",description:"Create a Draft Fulfillment",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_CREATE_EMPTY,query:FULFILLMENT_CREATE_EMPTY,body:{}},responseSchema:{201:FULFILLMENT_CREATE_RESPONSE}};
  constructor(services = {}) {
    super(services);
    this.fulfillments = new FulfillmentService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});
  }
  authorizeRequest() { return this.fulfillments.authorizeWrite(); }
  async execute(req) { return this.response(await this.fulfillments.create(fulfillmentCreateRequest(req)), {statusCode:201}); }
}
