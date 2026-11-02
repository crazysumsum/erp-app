import {RequestValidator} from "../../framework/validation/requestValidator.js";
import {salesError} from "../../modules/sales/salesErrors.js";
import {EMPTY,SALES_ORDER_READ_POLICY,SALES_ORDER_ID_PARAMS,SALES_ORDER_LIST_QUERY,SALES_CONFIRMATION_INPUT,salesActorClaims} from "../sales/salesSchemas.js";
export {EMPTY,SALES_ORDER_READ_POLICY,SALES_ORDER_ID_PARAMS,salesActorClaims};
const ID={type:"integer",minimum:1,maximum:Number.MAX_SAFE_INTEGER},TIME={type:"integer",minimum:0},nullable=schema=>({anyOf:[schema,{type:"null"}]}),object=properties=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const filters={type:"object",additionalProperties:false,properties:Object.fromEntries(Object.entries(SALES_ORDER_LIST_QUERY.properties).filter(([key])=>!["page","pageSize"].includes(key)))},scope={enum:["ACTIVE","ARCHIVE"]};
export const SALES_EXPORT_INPUT=object({eventId:SALES_CONFIRMATION_INPUT.properties.eventId,scope,filters});
export const SALES_EXPORT_SUMMARY=object({id:ID,scope,filters,status:{enum:["QUEUED","PROCESSING","COMPLETED","FAILED","EXPIRED"]},rowCount:{type:"integer",minimum:0,maximum:250000},errorCode:{type:"string",maxLength:80},createdAt:TIME,startedAt:nullable(TIME),completedAt:nullable(TIME),expiresAt:nullable(TIME)});
export const SALES_EXPORT_JOBS_QUERY={type:"object",additionalProperties:false,properties:{page:ID,pageSize:{...ID,maximum:100}}},SALES_EXPORT_LIST=object({items:{type:"array",maxItems:100,items:SALES_EXPORT_SUMMARY},total:TIME,page:ID,pageSize:{...ID,maximum:100}});
const validator=new RequestValidator({config:{enabled:true,allErrors:true,coerceTypes:true,useDefaults:false,removeAdditional:false,maxErrors:20,includeErrorDetailsInResponse:false}}),list=validator.compile({query:SALES_EXPORT_JOBS_QUERY},"Sales Export list");
export function salesExportListRequest(req){const request={query:structuredClone(req.input.query)};try{list(request);}catch(error){if(error.code==="REQUEST_VALIDATION_FAILED")throw salesError("SALES_INPUT_INVALID");throw error;}return {claims:salesActorClaims(req),input:request.input.query,signal:req.requestTimeout?.signal};}
