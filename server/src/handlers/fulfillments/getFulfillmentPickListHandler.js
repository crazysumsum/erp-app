import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {FulfillmentPrintService} from "../../modules/fulfillment/FulfillmentPrintService.js";
import {FULFILLMENT_ID_PARAMS,FULFILLMENT_INQUIRY_EMPTY} from "./fulfillmentInquirySchemas.js";
import {FULFILLMENT_PICK_LIST_RESPONSE} from "./fulfillmentPrintSchemas.js";
export class GetFulfillmentPickListHandler extends BaseRequestHandler{
 static handlerName="getFulfillmentPickList";
 static api={method:"GET",path:"/api/v1/fulfillments/:id/pick-list",description:"Read the current protected Pick List and record a technical print audit",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:FULFILLMENT_ID_PARAMS,query:FULFILLMENT_INQUIRY_EMPTY,body:FULFILLMENT_INQUIRY_EMPTY},responseSchema:{200:FULFILLMENT_PICK_LIST_RESPONSE}};
 constructor(services={}){super(services);this.print=new FulfillmentPrintService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 async execute(req,res){const result=await this.print.pickList(String(req.input.params.id));res.setHeader("Cache-Control","private, no-store");res.setHeader("Pragma","no-cache");return this.response(result);}
}
