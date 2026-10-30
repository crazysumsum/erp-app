import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentAllocationService } from "../../modules/fulfillment/FulfillmentAllocationService.js";
import { normalizeFulfillmentAllocation } from "../../modules/fulfillment/fulfillmentAllocationCommand.js";
import { FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_DETAIL_RESPONSE,FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_CREATE_RESPONSE } from "./fulfillmentCreateSchemas.js";
const outcome={...FULFILLMENT_CREATE_RESPONSE.properties.outcome,properties:{...FULFILLMENT_CREATE_RESPONSE.properties.outcome.properties,status:{const:"PICKING"},version:{type:"integer",minimum:2,maximum:4294967295}}};
export const FULFILLMENT_ALLOCATION_RESPONSE={type:"object",additionalProperties:false,required:["outcome","fulfillment","salesOrder"],properties:{outcome,...FULFILLMENT_DETAIL_RESPONSE.properties}};
export class AllocateFulfillmentHandler extends BaseRequestHandler {
 static handlerName="allocateFulfillment";
 static api={method:"POST",jsonBodyLimitBytes:2097152,path:"/api/v1/fulfillments/:id/allocate",description:"Allocate the complete Draft Fulfillment",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:{}},responseSchema:{200:FULFILLMENT_ALLOCATION_RESPONSE}};
 constructor(services={}){super(services);this.allocations=new FulfillmentAllocationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.allocations.authorizeWrite();}
 async execute(req){return this.response(await this.allocations.allocate(String(req.input.params.id),normalizeFulfillmentAllocation(req.input.body)));}
}
