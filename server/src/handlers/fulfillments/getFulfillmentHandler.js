import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentInquiryService } from "../../modules/fulfillment/FulfillmentInquiryService.js";
import { FULFILLMENT_INQUIRY_EMPTY, FULFILLMENT_DETAIL_RESPONSE, FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { fulfillmentDetailRequest } from "./fulfillmentInquiryRequests.js";
export class GetFulfillmentHandler extends BaseRequestHandler {
  static handlerName="getFulfillment";
  static api={method:"GET",path:"/api/v1/fulfillments/:id",description:"Read current Fulfillment detail",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view"]}}],requestSchema:{params:FULFILLMENT_ID_PARAMS,query:{},body:FULFILLMENT_INQUIRY_EMPTY},responseSchema:{200:FULFILLMENT_DETAIL_RESPONSE}};
  constructor(services={}){super(services);this.inquiry=new FulfillmentInquiryService({database:services.require("mysqldatabase")});}
  async execute(req){return this.response(await this.inquiry.detail(String(req.input.params.id),fulfillmentDetailRequest(req)));}
}
