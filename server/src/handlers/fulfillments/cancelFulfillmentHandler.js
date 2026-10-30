import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentCancellationService } from "../../modules/fulfillment/FulfillmentCancellationService.js";
import { normalizeFulfillmentCancel } from "../../modules/fulfillment/fulfillmentCancelCommand.js";
import { FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_ALLOCATION_RESPONSE } from "./allocateFulfillmentHandler.js";
const response={...FULFILLMENT_ALLOCATION_RESPONSE,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties,outcome:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome.properties,status:{const:"CANCELLED"},version:{type:"integer",minimum:2,maximum:4294967295}}}}};
export class CancelFulfillmentHandler extends BaseRequestHandler {
 static handlerName="cancelFulfillment";
 static api={method:"POST",path:"/api/v1/fulfillments/:id/cancel",description:"Cancel unshipped Fulfillment work and release remaining allocations and Claims",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:{}},responseSchema:{200:response}};
 constructor(services={}){super(services);this.picking=new FulfillmentCancellationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.picking.authorizeWrite();}
 async execute(req){return this.response(await this.picking.cancel(String(req.input.params.id),normalizeFulfillmentCancel(req.input.body)));}
}
