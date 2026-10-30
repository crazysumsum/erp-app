import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {FulfillmentAllocationService} from "../../modules/fulfillment/FulfillmentAllocationService.js";
import {FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_ID_PARAMS} from "./fulfillmentInquirySchemas.js";
import {fulfillmentCandidateRequest} from "./getFulfillmentCandidatesHandler.js";
import {FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE} from "./fulfillmentReallocationCandidateSchemas.js";
export class GetFulfillmentReallocationCandidatesHandler extends BaseRequestHandler {
 static handlerName="getFulfillmentReallocationCandidates";
 static api={method:"GET",path:"/api/v1/fulfillments/:id/reallocation-candidates",description:"Read Inventory-owned release-aware Reallocation candidates",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],requestSchema:{params:FULFILLMENT_ID_PARAMS,query:{},body:FULFILLMENT_INQUIRY_EMPTY},responseSchema:{200:FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE}};
 constructor(services={}){super(services);this.allocations=new FulfillmentAllocationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.allocations.reallocationCandidates(String(req.input.params.id),fulfillmentCandidateRequest(req)));}
}
