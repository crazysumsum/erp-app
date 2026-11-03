import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentOperationInquiryService } from "../../modules/fulfillment/FulfillmentOperationInquiryService.js";
import { FULFILLMENT_OPERATION_PARAMS,FULFILLMENT_OPERATION_EMPTY,FULFILLMENT_OPERATION_RESPONSE } from "./fulfillmentOperationSchemas.js";
export class FulfillmentOperationLookupHandler extends BaseRequestHandler {
 static handlerName="fulfillmentOperationLookup";
 static api={method:"GET",path:"/api/v1/fulfillment-operations/by-event/:eventId",description:"Read the original actor's visible Fulfillment operation",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:FULFILLMENT_OPERATION_PARAMS,query:FULFILLMENT_OPERATION_EMPTY,body:FULFILLMENT_OPERATION_EMPTY},responseSchema:{200:FULFILLMENT_OPERATION_RESPONSE}};
 constructor(services={}){super(services);this.inquiry=new FulfillmentOperationInquiryService({database:services.require("mysqldatabase"),time:services.require("time")});}
 async execute(req){return this.response(await this.inquiry.lookup(req.input.params.eventId));}
}
