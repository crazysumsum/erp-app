import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { FulfillmentAllocationService,normalizeFulfillmentCandidateQuery } from "../../modules/fulfillment/FulfillmentAllocationService.js";
import { FULFILLMENT_INQUIRY_EMPTY,FULFILLMENT_ID_PARAMS } from "./fulfillmentInquirySchemas.js";
import { FULFILLMENT_CANDIDATE_RESPONSE } from "./fulfillmentCandidateSchemas.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";
export function fulfillmentCandidateRequest(req) {
  const input=req.input.query;
  if(!input||Object.keys(input).some(key=>!["version","page"].includes(key)))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  const result={};for(const [key,value] of Object.entries(input)){
    if(typeof value!=="string"||! /^[1-9][0-9]*$/u.test(value))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");result[key]=Number(value);
  }
  return normalizeFulfillmentCandidateQuery(result);
}
export class GetFulfillmentCandidatesHandler extends BaseRequestHandler {
  static handlerName="getFulfillmentCandidates";
  static api={method:"GET",path:"/api/v1/fulfillments/:id/allocation-candidates",description:"Read Inventory-owned batch allocation recommendations",authorizationPolicies:[{name:"hasPermission",options:{permissions:["fulfillment.view","fulfillment.operation"]}}],requestSchema:{params:FULFILLMENT_ID_PARAMS,query:{},body:FULFILLMENT_INQUIRY_EMPTY},responseSchema:{200:FULFILLMENT_CANDIDATE_RESPONSE}};
  constructor(services={}){super(services);this.allocations=new FulfillmentAllocationService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
  async execute(req){return this.response(await this.allocations.candidates(String(req.input.params.id),fulfillmentCandidateRequest(req)));}
}
