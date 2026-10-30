import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentAllocationService } from "../../modules/fulfillment/FulfillmentAllocationService.js";
import { normalizeFulfillmentReallocation } from "../../modules/fulfillment/fulfillmentReallocationCommand.js";
import { FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_ALLOCATION_RESPONSE } from "./allocateFulfillmentHandler.js";
const response={...FULFILLMENT_ALLOCATION_RESPONSE,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties,outcome:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome,properties:{...FULFILLMENT_ALLOCATION_RESPONSE.properties.outcome.properties,version:{type:"integer",minimum:3,maximum:4294967295}}}}};
export class ReallocateFulfillmentHandler extends BaseRequestHandler {
 static handlerName="reallocateFulfillment";
 static api={method:"POST",jsonBodyLimitBytes:2097152,path:"/api/v1/fulfillments/:id/reallocate",description:"Atomically replace all unpicked Fulfillment Allocations",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],idempotency:{enabled:true},requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:{}},responseSchema:{200:response}};
 constructor(services={}){super(services);this.allocations=new FulfillmentAllocationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(){return this.allocations.authorizeWrite();}
 async execute(req){return this.response(await this.allocations.reallocate(String(req.input.params.id),normalizeFulfillmentReallocation(req.input.body)));}
}
