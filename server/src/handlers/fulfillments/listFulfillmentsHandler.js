import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentInquiryService } from "../../modules/fulfillment/FulfillmentInquiryService.js";
import { FULFILLMENT_INQUIRY_EMPTY, FULFILLMENT_LIST_RESPONSE } from "./fulfillmentInquirySchemas.js";
import { fulfillmentListRequest } from "./fulfillmentInquiryRequests.js";
export class ListFulfillmentsHandler extends BaseRequestHandler {
  static handlerName="listFulfillments";
  static api={method:"GET",path:"/api/v1/fulfillments",description:"List current Fulfillment work",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:FULFILLMENT_INQUIRY_EMPTY,query:{},body:FULFILLMENT_INQUIRY_EMPTY},responseSchema:{200:FULFILLMENT_LIST_RESPONSE}};
  constructor(services={}){super(services);this.inquiry=new FulfillmentInquiryService({database:services.require("mysqldatabase")});}
  async execute(req){return this.response(await this.inquiry.list(fulfillmentListRequest(req)));}
}
