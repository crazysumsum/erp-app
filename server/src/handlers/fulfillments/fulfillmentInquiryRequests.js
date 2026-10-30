import { RequestValidator } from "../../framework/validation/requestValidator.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";
import { normalizeFulfillmentListQuery } from "../../modules/fulfillment/fulfillmentListQuery.js";
const id={type:"integer",minimum:1,maximum:Number.MAX_SAFE_INTEGER},time={type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const listQuery={type:"object",additionalProperties:false,properties:{sortBy:{enum:["lastBusinessUpdatedAt","createdAt","updatedAt","fulfillmentNumber","id"]},descending:{type:"boolean"},view:{enum:["active","myRecent","exceptions","finalized"]},q:{type:"string",maxLength:190},salesOrderId:id,customerId:id,warehouseId:id,status:{enum:["DRAFT","PICKING","PICKED","SHIPPED","CANCELLED","REVERSED"]},hasShortPick:{type:"boolean"},createdFrom:time,createdTo:time,pickedFrom:time,pickedTo:time,page:id,pageSize:{type:"integer",minimum:1,maximum:100},cursor:{type:"string",maxLength:2048,pattern:"^[A-Za-z0-9_-]+$"}}};
const detailQuery={type:"object",additionalProperties:false,properties:{allocationAfterId:{type:"string",pattern:"^(0|[1-9][0-9]{0,15})$",maxLength:16},historyBeforeSequence:{type:"integer",minimum:1,maximum:4294967296}}};
const validator=new RequestValidator({config:{enabled:true,allErrors:true,coerceTypes:true,useDefaults:false,removeAdditional:false,maxErrors:20,includeErrorDetailsInResponse:false}});
const list=validator.compile({query:listQuery},"Fulfillment list"),detail=validator.compile({query:detailQuery},"Fulfillment detail");
function query(req,validate){const request={query:structuredClone(req.input.query)};try{validate(request);}catch(error){if(error.code==="REQUEST_VALIDATION_FAILED")throw fulfillmentError("FULFILLMENT_INPUT_INVALID");throw error;}return request.input.query;}
export function fulfillmentListRequest(req){const input=query(req,list);normalizeFulfillmentListQuery(input);return input;}
export const fulfillmentDetailRequest=req=>query(req,detail);
