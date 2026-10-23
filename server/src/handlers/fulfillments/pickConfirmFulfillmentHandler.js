import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentPickingService } from "../../modules/fulfillment/FulfillmentPickingService.js";
import { normalizeFulfillmentPick } from "../../modules/fulfillment/fulfillmentPickingCommand.js";
import { FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_ALLOCATION_RESPONSE } from "./allocateFulfillmentHandler.js";
const response={...FULFILLMENT_ALLOCATION_RESPONSE,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties,outcome:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome.properties,status:{const:"PICKED"},version:{type:"integer",minimum:3,maximum:4294967295}}}}};
export class PickConfirmFulfillmentHandler extends BaseRequestHandler {
 static handlerName="pickConfirmFulfillment";
 static api={method:"POST",path:"/api/v1/fulfillments/:id/pick-confirm",description:"Confirm the exact complete Fulfillment pick and release short quantities",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:{}},responseSchema:{200:response}};
 constructor(services={}){super(services);this.picking=new FulfillmentPickingService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.picking.authorizeWrite();}
 async execute(req){return this.response(await this.picking.confirmPick(String(req.input.params.id),normalizeFulfillmentPick(req.input.body)));}
}
