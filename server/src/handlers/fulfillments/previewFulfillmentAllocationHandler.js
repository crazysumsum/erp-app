import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {FulfillmentAllocationService} from "../../modules/fulfillment/FulfillmentAllocationService.js";
import {FULFILLMENT_ID_PARAMS,FULFILLMENT_INQUIRY_EMPTY} from "./fulfillmentInquirySchemas.js";
import {FULFILLMENT_ALLOCATION_PREVIEW_REQUEST,FULFILLMENT_ALLOCATION_PREVIEW_RESPONSE} from "./fulfillmentAllocationPreviewSchemas.js";
export class PreviewFulfillmentAllocationHandler extends BaseRequestHandler {
 static handlerName="previewFulfillmentAllocation";
 static api={method:"POST",path:"/api/v1/fulfillments/:id/allocation-preview",jsonBodyLimitBytes:2097152,description:"Read Inventory-owned assessment of the actual Allocation choices",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.operation"]}}],requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:FULFILLMENT_ALLOCATION_PREVIEW_REQUEST},responseSchema:{200:FULFILLMENT_ALLOCATION_PREVIEW_RESPONSE}};
 constructor(services={}){super(services);this.allocations=new FulfillmentAllocationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req){return this.response(await this.allocations.preview(String(req.input.params.id),req.input.body));}
}
