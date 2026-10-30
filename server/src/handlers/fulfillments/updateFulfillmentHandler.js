import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentService } from "../../modules/fulfillment/FulfillmentService.js";
import { normalizeFulfillmentUpdate } from "../../modules/fulfillment/fulfillmentUpdateCommand.js";
import { FULFILLMENT_INQUIRY_EMPTY, FULFILLMENT_DETAIL_RESPONSE, FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_CREATE_RESPONSE } from "./fulfillmentCreateSchemas.js";
const outcome={...FULFILLMENT_CREATE_RESPONSE.properties.outcome,properties:{...FULFILLMENT_CREATE_RESPONSE.properties.outcome.properties,version:{type:"integer",minimum:1,maximum:4294967295}}};
export const FULFILLMENT_UPDATE_RESPONSE={type:"object",additionalProperties:false,required:["outcome","fulfillment","salesOrder"],properties:{outcome,...FULFILLMENT_DETAIL_RESPONSE.properties}};
export class UpdateFulfillmentHandler extends BaseRequestHandler {
  static handlerName="updateFulfillment";
  static api={method:"POST",path:"/api/v1/fulfillments/:id/update",description:"Replace Draft Fulfillment lines",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:{}},responseSchema:{200:FULFILLMENT_UPDATE_RESPONSE}};
  constructor(services={}){super(services);this.fulfillments=new FulfillmentService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
  authorizeRequest(){return this.fulfillments.authorizeWrite();}
  async execute(req){return this.response(await this.fulfillments.update(String(req.input.params.id),normalizeFulfillmentUpdate(req.input.body)));}
}
